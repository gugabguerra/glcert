package services

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image/png"
	"strings"
	"sync"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

type TOTPService struct {
	db     *sql.DB
	crypto *CryptoService

	// pending holds the secret and backup codes issued by GenerateSecret
	// until the user confirms them, so enabling never trusts client values.
	mu      sync.Mutex
	pending map[string]pendingSetup
}

type pendingSetup struct {
	secret  string
	codes   []string
	expires time.Time
}

const setupLifetime = 15 * time.Minute

func NewTOTPService(db *sql.DB, crypto *CryptoService) *TOTPService {
	return &TOTPService{db: db, crypto: crypto, pending: map[string]pendingSetup{}}
}

type TOTPSetupResult struct {
	Secret    string   `json:"secret"`
	ImageData string   `json:"imageData"`
	Codes     []string `json:"codes"`
}

func (s *TOTPService) GenerateSecret(userID, email string) (*TOTPSetupResult, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "GLCert",
		AccountName: email,
		SecretSize:  20,
		Period:      30,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
	if err != nil {
		return nil, fmt.Errorf("generate TOTP key: %w", err)
	}

	img, err := key.Image(256, 256)
	if err != nil {
		return nil, fmt.Errorf("generate QR image: %w", err)
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encode QR PNG: %w", err)
	}

	codes, err := s.GenerateBackupCodes()
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	for id, p := range s.pending {
		if time.Now().After(p.expires) {
			delete(s.pending, id)
		}
	}
	s.pending[userID] = pendingSetup{secret: key.Secret(), codes: codes, expires: time.Now().Add(setupLifetime)}
	s.mu.Unlock()

	return &TOTPSetupResult{
		Secret:    key.Secret(),
		ImageData: base64.StdEncoding.EncodeToString(buf.Bytes()),
		Codes:     codes,
	}, nil
}

// ConfirmSetup enables TOTP with the secret and backup codes GenerateSecret
// issued to this user, once code proves the authenticator holds the secret.
func (s *TOTPService) ConfirmSetup(userID, code string) error {
	s.mu.Lock()
	p, ok := s.pending[userID]
	s.mu.Unlock()
	if !ok || time.Now().After(p.expires) {
		return ErrNoPendingSetup
	}
	if !totp.Validate(code, p.secret) {
		return ErrInvalidCode
	}
	if err := s.EnableTOTP(userID, p.secret, p.codes); err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.pending, userID)
	s.mu.Unlock()
	return nil
}

var (
	ErrNoPendingSetup = errors.New("no two-factor setup in progress; start again")
	ErrInvalidCode    = errors.New("invalid TOTP code")
)

func (s *TOTPService) EnableTOTP(userID, secret string, codes []string) error {
	encrypted, err := s.crypto.Encrypt([]byte(secret))
	if err != nil {
		return fmt.Errorf("encrypt TOTP secret: %w", err)
	}

	_, err = s.db.Exec("UPDATE users SET totp_secret = ?, totp_enabled = TRUE WHERE id = ?", encrypted, userID)
	if err != nil {
		return fmt.Errorf("save TOTP secret: %w", err)
	}

	return s.replaceBackupCodes(userID, codes)
}

// IssueBackupCodes gives the user a fresh set of backup codes and returns
// them in the clear, once. Any earlier set stops working.
func (s *TOTPService) IssueBackupCodes(userID string) ([]string, error) {
	codes, err := s.GenerateBackupCodes()
	if err != nil {
		return nil, err
	}
	if err := s.replaceBackupCodes(userID, codes); err != nil {
		return nil, err
	}
	return codes, nil
}

// HasBackupCodes reports whether the user still holds an unused backup code.
func (s *TOTPService) HasBackupCodes(userID string) bool {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM backup_codes WHERE user_id = ? AND used = FALSE", userID).Scan(&n)
	return err == nil && n > 0
}

// replaceBackupCodes swaps the user's backup codes for a new set in one
// transaction, so an old set never stays valid next to the new one.
func (s *TOTPService) replaceBackupCodes(userID string, codes []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("save backup codes: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM backup_codes WHERE user_id = ?", userID); err != nil {
		return fmt.Errorf("delete backup codes: %w", err)
	}
	for _, code := range codes {
		hash := sha256.Sum256([]byte(strings.ToLower(code)))
		if _, err := tx.Exec("INSERT INTO backup_codes (user_id, code_hash) VALUES (?, ?)", userID, hex.EncodeToString(hash[:])); err != nil {
			return fmt.Errorf("save backup code: %w", err)
		}
	}
	return tx.Commit()
}

// DisableTOTP turns the authenticator app off. Backup codes go with it unless
// a passkey still protects the account and needs them as its recovery path.
func (s *TOTPService) DisableTOTP(userID string) error {
	_, err := s.db.Exec("UPDATE users SET totp_secret = NULL, totp_enabled = FALSE WHERE id = ?", userID)
	if err != nil {
		return fmt.Errorf("disable TOTP: %w", err)
	}

	_, err = s.db.Exec(`DELETE FROM backup_codes WHERE user_id = ?
		AND NOT EXISTS (SELECT 1 FROM passkeys WHERE passkeys.user_id = backup_codes.user_id)`, userID)
	if err != nil {
		return fmt.Errorf("delete backup codes: %w", err)
	}

	return nil
}

func (s *TOTPService) IsEnabled(userID string) bool {
	var enabled bool
	err := s.db.QueryRow("SELECT totp_enabled FROM users WHERE id = ?", userID).Scan(&enabled)
	return err == nil && enabled
}

func (s *TOTPService) ValidateCode(userID, code string) bool {
	var encrypted []byte
	err := s.db.QueryRow("SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = TRUE", userID).Scan(&encrypted)
	if err != nil {
		return false
	}

	secretBytes, err := s.crypto.Decrypt(encrypted)
	if err != nil {
		return false
	}

	return totp.Validate(code, string(secretBytes))
}

func (s *TOTPService) ValidateBackupCode(userID, code string) bool {
	code = strings.ToLower(code)
	hash := sha256.Sum256([]byte(code))
	hashHex := hex.EncodeToString(hash[:])

	// One statement, so a code can only ever be spent once.
	res, err := s.db.Exec("UPDATE backup_codes SET used = TRUE WHERE user_id = ? AND code_hash = ? AND used = FALSE", userID, hashHex)
	if err != nil {
		return false
	}
	n, err := res.RowsAffected()
	return err == nil && n > 0
}

func (s *TOTPService) GetBackupCodes(userID string) ([]string, error) {
	rows, err := s.db.Query("SELECT code_hash FROM backup_codes WHERE user_id = ? AND used = FALSE", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var codes []string
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			return nil, err
		}
		codes = append(codes, hash)
	}
	return codes, rows.Err()
}

func (s *TOTPService) GenerateBackupCodes() ([]string, error) {
	codes := make([]string, 10)
	for i := range codes {
		b := make([]byte, 5)
		if _, err := rand.Read(b); err != nil {
			return nil, fmt.Errorf("generate backup code: %w", err)
		}
		codes[i] = hex.EncodeToString(b)
	}
	return codes, nil
}

func (s *TOTPService) CleanupPendingSessions() {
	s.db.Exec("DELETE FROM pending_sessions WHERE expires_at <= ?", time.Now())
}
