package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/glcert/glcert/internal/logger"
	"golang.org/x/crypto/pbkdf2"
)

type CryptoService struct {
	DataDir string
	gcm     cipher.AEAD
	enabled bool
}

func NewCryptoService(dataDir string) *CryptoService {
	return &CryptoService{DataDir: dataDir}
}

func (s *CryptoService) IsEnabled() bool {
	return s.enabled
}

func (s *CryptoService) GetPassphrasePath() string {
	return filepath.Join(s.DataDir, "encryption.key")
}

func (s *CryptoService) HasPassphrase() bool {
	_, err := os.Stat(s.GetPassphrasePath())
	return err == nil
}

func (s *CryptoService) deriveKey(password string, salt []byte) []byte {
	return pbkdf2.Key([]byte(password), salt, 100000, 32, sha256.New)
}

func (s *CryptoService) SavePassphrase(passphrase string, adminPassword string) error {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return fmt.Errorf("generate salt: %w", err)
	}

	key := s.deriveKey(adminPassword, salt)

	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return fmt.Errorf("generate nonce: %w", err)
	}

	encrypted := gcm.Seal(nonce, nonce, []byte(passphrase), nil)

	data := make([]byte, 0, len(salt)+len(encrypted))
	data = append(data, salt...)
	data = append(data, encrypted...)

	encoded := base64.StdEncoding.EncodeToString(data)

	if err := os.WriteFile(s.GetPassphrasePath(), []byte(encoded), 0600); err != nil {
		return fmt.Errorf("write passphrase file: %w", err)
	}

	s.gcm = gcm
	s.enabled = true
	return nil
}

func (s *CryptoService) LoadPassphrase(adminPassword string) error {
	encoded, err := os.ReadFile(s.GetPassphrasePath())
	if err != nil {
		return fmt.Errorf("read passphrase file: %w", err)
	}

	data, err := base64.StdEncoding.DecodeString(string(encoded))
	if err != nil {
		return fmt.Errorf("decode passphrase file: %w", err)
	}

	if len(data) < 16 {
		return fmt.Errorf("invalid passphrase file")
	}

	salt := data[:16]
	encrypted := data[16:]

	key := s.deriveKey(adminPassword, salt)

	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(encrypted) < nonceSize {
		return fmt.Errorf("invalid encrypted data")
	}

	nonce, ciphertext := encrypted[:nonceSize], encrypted[nonceSize:]
	passphrase, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return fmt.Errorf("decrypt passphrase: %w", err)
	}

	_ = passphrase

	s.gcm = gcm
	s.enabled = true
	logger.Debugf("Crypto passphrase loaded successfully")
	return nil
}

func (s *CryptoService) ChangeAdminPassword(oldPassword, newPassword string) error {
	encoded, err := os.ReadFile(s.GetPassphrasePath())
	if err != nil {
		return fmt.Errorf("read passphrase file: %w", err)
	}

	data, err := base64.StdEncoding.DecodeString(string(encoded))
	if err != nil {
		return fmt.Errorf("decode passphrase file: %w", err)
	}

	if len(data) < 16 {
		return fmt.Errorf("invalid passphrase file")
	}

	salt := data[:16]
	encrypted := data[16:]

	key := s.deriveKey(oldPassword, salt)

	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Errorf("create cipher: %w", err)
	}

	oldGcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := oldGcm.NonceSize()
	if len(encrypted) < nonceSize {
		return fmt.Errorf("invalid encrypted data")
	}

	nonce, ciphertext := encrypted[:nonceSize], encrypted[nonceSize:]
	passphrase, err := oldGcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return fmt.Errorf("decrypt passphrase: %w", err)
	}

	return s.SavePassphrase(string(passphrase), newPassword)
}

func (s *CryptoService) Encrypt(data []byte) ([]byte, error) {
	if !s.enabled || s.gcm == nil {
		return data, nil
	}

	nonce := make([]byte, s.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}

	ciphertext := s.gcm.Seal(nonce, nonce, data, nil)
	return ciphertext, nil
}

func (s *CryptoService) Decrypt(data []byte) ([]byte, error) {
	if !s.enabled || s.gcm == nil {
		return data, nil
	}

	nonceSize := s.gcm.NonceSize()
	if len(data) < nonceSize {
		return nil, fmt.Errorf("invalid encrypted data")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := s.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}

	return plaintext, nil
}

func (s *CryptoService) Reset() {
	s.gcm = nil
	s.enabled = false
}
