package services

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/gugabguerra/glcert/internal/logger"
	"golang.org/x/crypto/pbkdf2"
)

// Key scheme (v2). The encryption passphrase chosen at setup is the root
// secret: the data key is PBKDF2(passphrase, salt). Each admin holds a copy of
// the passphrase wrapped with a key derived from their own password, so a
// password change only rewraps that admin's copy and existing data stays
// readable. Version 1 files (a single wrap whose wrapping key doubled as the
// data key) are converted by MigrateV1.

const keyFileVersion = 2

// keyCheck is sealed with the data key so a passphrase can be verified
// without touching real data.
var keyCheck = []byte("glcert-key-check")

var (
	// ErrLegacyKeyFile means encryption.key is still in the v1 format.
	ErrLegacyKeyFile = errors.New("encryption key file uses the v1 format")
	// ErrNoWrap means the admin holds no copy of the passphrase.
	ErrNoWrap = errors.New("no encryption key copy for this account")
)

type keyFile struct {
	Version int               `json:"version"`
	Salt    []byte            `json:"salt"`
	Check   []byte            `json:"check"`
	Wraps   map[string][]byte `json:"wraps"`
}

type CryptoService struct {
	DataDir string

	fileMu     sync.Mutex // serialises read-modify-write of the key file
	mu         sync.RWMutex
	gcm        cipher.AEAD
	passphrase string
	enabled    bool
}

func NewCryptoService(dataDir string) *CryptoService {
	return &CryptoService{DataDir: dataDir}
}

func (s *CryptoService) IsEnabled() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.enabled
}

func (s *CryptoService) GetPassphrasePath() string {
	return filepath.Join(s.DataDir, "encryption.key")
}

func (s *CryptoService) HasPassphrase() bool {
	_, err := os.Stat(s.GetPassphrasePath())
	return err == nil
}

func (s *CryptoService) deriveKey(secret string, salt []byte) []byte {
	return pbkdf2.Key([]byte(secret), salt, 100000, 32, sha256.New)
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}
	return cipher.NewGCM(block)
}

func seal(gcm cipher.AEAD, plaintext []byte) ([]byte, error) {
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

func open(gcm cipher.AEAD, data []byte) ([]byte, error) {
	if len(data) < gcm.NonceSize() {
		return nil, fmt.Errorf("invalid encrypted data")
	}
	nonce, ciphertext := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ciphertext, nil)
}

func randomSalt() ([]byte, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, fmt.Errorf("generate salt: %w", err)
	}
	return salt, nil
}

// wrap seals the passphrase under a key derived from password: salt|nonce|ct.
func (s *CryptoService) wrap(password, passphrase string) ([]byte, error) {
	salt, err := randomSalt()
	if err != nil {
		return nil, err
	}
	gcm, err := newGCM(s.deriveKey(password, salt))
	if err != nil {
		return nil, err
	}
	sealed, err := seal(gcm, []byte(passphrase))
	if err != nil {
		return nil, err
	}
	return append(salt, sealed...), nil
}

func (s *CryptoService) unwrap(password string, wrapped []byte) (string, error) {
	if len(wrapped) < 16 {
		return "", fmt.Errorf("invalid key copy")
	}
	gcm, err := newGCM(s.deriveKey(password, wrapped[:16]))
	if err != nil {
		return "", err
	}
	passphrase, err := open(gcm, wrapped[16:])
	if err != nil {
		return "", fmt.Errorf("unwrap passphrase: %w", err)
	}
	return string(passphrase), nil
}

func (s *CryptoService) readKeyFile() (*keyFile, error) {
	raw, err := os.ReadFile(s.GetPassphrasePath())
	if err != nil {
		return nil, fmt.Errorf("read key file: %w", err)
	}
	raw = bytes.TrimSpace(raw)
	if !bytes.HasPrefix(raw, []byte("{")) {
		return nil, ErrLegacyKeyFile
	}
	var kf keyFile
	if err := json.Unmarshal(raw, &kf); err != nil {
		return nil, fmt.Errorf("decode key file: %w", err)
	}
	if kf.Version != keyFileVersion {
		return nil, fmt.Errorf("unsupported key file version %d", kf.Version)
	}
	if kf.Wraps == nil {
		kf.Wraps = map[string][]byte{}
	}
	return &kf, nil
}

// writeKeyFile replaces encryption.key atomically so a crash never leaves a
// truncated file behind.
func (s *CryptoService) writeKeyFile(kf *keyFile) error {
	data, err := json.Marshal(kf)
	if err != nil {
		return fmt.Errorf("encode key file: %w", err)
	}
	return writeFileAtomic(s.GetPassphrasePath(), data, 0600)
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("replace %s: %w", filepath.Base(path), err)
	}
	return nil
}

// activate derives the data key from the passphrase, verifies it against the
// key check and unlocks the service.
func (s *CryptoService) activate(kf *keyFile, passphrase string) error {
	gcm, err := newGCM(s.deriveKey(passphrase, kf.Salt))
	if err != nil {
		return err
	}
	check, err := open(gcm, kf.Check)
	if err != nil || !bytes.Equal(check, keyCheck) {
		return fmt.Errorf("wrong encryption passphrase")
	}
	s.mu.Lock()
	s.gcm, s.passphrase, s.enabled = gcm, passphrase, true
	s.mu.Unlock()
	return nil
}

// SavePassphrase creates a new key file at setup, with one copy of the
// passphrase for the first admin, and unlocks the service.
func (s *CryptoService) SavePassphrase(passphrase, userID, password string) error {
	s.fileMu.Lock()
	defer s.fileMu.Unlock()
	salt, err := randomSalt()
	if err != nil {
		return err
	}
	gcm, err := newGCM(s.deriveKey(passphrase, salt))
	if err != nil {
		return err
	}
	check, err := seal(gcm, keyCheck)
	if err != nil {
		return err
	}
	wrapped, err := s.wrap(password, passphrase)
	if err != nil {
		return err
	}
	kf := &keyFile{Version: keyFileVersion, Salt: salt, Check: check, Wraps: map[string][]byte{userID: wrapped}}
	if err := s.writeKeyFile(kf); err != nil {
		return err
	}
	return s.activate(kf, passphrase)
}

// Unlock opens the admin's copy of the passphrase with their password.
func (s *CryptoService) Unlock(userID, password string) error {
	kf, err := s.readKeyFile()
	if err != nil {
		return err
	}
	wrapped, ok := kf.Wraps[userID]
	if !ok {
		return ErrNoWrap
	}
	passphrase, err := s.unwrap(password, wrapped)
	if err != nil {
		return err
	}
	if err := s.activate(kf, passphrase); err != nil {
		return err
	}
	logger.Debugf("Crypto passphrase loaded successfully")
	return nil
}

// UnlockWithPassphrase is the recovery path when no admin copy opens, for
// example after a forgotten-password reset while the server was locked.
func (s *CryptoService) UnlockWithPassphrase(passphrase string) error {
	kf, err := s.readKeyFile()
	if err != nil {
		return err
	}
	return s.activate(kf, passphrase)
}

// SetWrap stores (or replaces) an admin's copy of the passphrase under their
// password. The service must be unlocked.
func (s *CryptoService) SetWrap(userID, password string) error {
	s.mu.RLock()
	passphrase := s.passphrase
	s.mu.RUnlock()
	if passphrase == "" {
		return fmt.Errorf("encryption is locked")
	}
	s.fileMu.Lock()
	defer s.fileMu.Unlock()
	kf, err := s.readKeyFile()
	if err != nil {
		return err
	}
	wrapped, err := s.wrap(password, passphrase)
	if err != nil {
		return err
	}
	kf.Wraps[userID] = wrapped
	return s.writeKeyFile(kf)
}

// RemoveWrap drops an account's copy, e.g. when it is deleted or demoted.
func (s *CryptoService) RemoveWrap(userID string) error {
	if !s.HasPassphrase() {
		return nil
	}
	s.fileMu.Lock()
	defer s.fileMu.Unlock()
	kf, err := s.readKeyFile()
	if err != nil {
		return err
	}
	if _, ok := kf.Wraps[userID]; !ok {
		return nil
	}
	delete(kf.Wraps, userID)
	return s.writeKeyFile(kf)
}

func (s *CryptoService) Encrypt(data []byte) ([]byte, error) {
	s.mu.RLock()
	gcm := s.gcm
	s.mu.RUnlock()
	if gcm == nil {
		if s.HasPassphrase() {
			// Encryption is configured but the passphrase has not been
			// unlocked yet. Refuse rather than persist plaintext secrets.
			return nil, errLocked
		}
		return data, nil
	}
	return seal(gcm, data)
}

func (s *CryptoService) Decrypt(data []byte) ([]byte, error) {
	s.mu.RLock()
	gcm := s.gcm
	s.mu.RUnlock()
	if gcm == nil {
		if s.HasPassphrase() {
			return nil, errLocked
		}
		return data, nil
	}
	plaintext, err := open(gcm, data)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}
	return plaintext, nil
}

var errLocked = errors.New("encryption is locked; an admin must sign in, or unlock it with the encryption passphrase")

func (s *CryptoService) Reset() {
	s.mu.Lock()
	s.gcm, s.passphrase, s.enabled = nil, "", false
	s.mu.Unlock()
}
