package services

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"image/png"
	"log"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

type TOTPService struct {
	db    *sql.DB
	crypto *CryptoService
}

func NewTOTPService(db *sql.DB, crypto *CryptoService) *TOTPService {
	return &TOTPService{db: db, crypto: crypto}
}

type TOTPSetupResult struct {
	Secret    string `json:"secret"`
	ImageData string `json:"imageData"`
	Codes     []string `json:"codes"`
}

func (s *TOTPService) GenerateSecret(email string) (*TOTPSetupResult, error) {
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

	return &TOTPSetupResult{
		Secret:    key.Secret(),
		ImageData: base64.StdEncoding.EncodeToString(buf.Bytes()),
		Codes:     codes,
	}, nil
}

func (s *TOTPService) EnableTOTP(secret string, codes []string) error {
	log.Printf("[TOTP ENABLE DEBUG] EnableTOTP called, secret len=%d, secret_hex=%x, gcm_enabled=%v", len(secret), secret, s.crypto.IsEnabled())
	encrypted, err := s.crypto.Encrypt([]byte(secret))
	if err != nil {
		return fmt.Errorf("encrypt TOTP secret: %w", err)
	}
	log.Printf("[TOTP ENABLE DEBUG] encrypted len=%d", len(encrypted))

	_, err = s.db.Exec("UPDATE admin SET totp_secret = ?, totp_enabled = TRUE WHERE id = 1", encrypted)
	if err != nil {
		return fmt.Errorf("save TOTP secret: %w", err)
	}

	for _, code := range codes {
		hash := sha256.Sum256([]byte(strings.ToLower(code)))
		hashHex := hex.EncodeToString(hash[:])
		_, err := s.db.Exec("INSERT INTO backup_codes (code_hash) VALUES (?)", hashHex)
		if err != nil {
			return fmt.Errorf("save backup code: %w", err)
		}
	}

	return nil
}

func (s *TOTPService) DisableTOTP() error {
	_, err := s.db.Exec("UPDATE admin SET totp_secret = NULL, totp_enabled = FALSE WHERE id = 1")
	if err != nil {
		return fmt.Errorf("disable TOTP: %w", err)
	}

	_, err = s.db.Exec("DELETE FROM backup_codes")
	if err != nil {
		return fmt.Errorf("delete backup codes: %w", err)
	}

	return nil
}

func (s *TOTPService) IsEnabled() bool {
	var enabled bool
	err := s.db.QueryRow("SELECT totp_enabled FROM admin WHERE id = 1").Scan(&enabled)
	return err == nil && enabled
}

func (s *TOTPService) ValidateCode(code string) bool {
	var encrypted []byte
	err := s.db.QueryRow("SELECT totp_secret FROM admin WHERE id = 1 AND totp_enabled = TRUE").Scan(&encrypted)
	if err != nil {
		log.Printf("[TOTP DEBUG] DB query failed: %v", err)
		return false
	}
	log.Printf("[TOTP DEBUG] DB query OK, encrypted len=%d, gcm_enabled=%v", len(encrypted), s.crypto.IsEnabled())

	secretBytes, err := s.crypto.Decrypt(encrypted)
	if err != nil {
		log.Printf("[TOTP DEBUG] Decrypt failed: %v", err)
		return false
	}
	secretStr := string(secretBytes)
	log.Printf("[TOTP DEBUG] Decrypt OK, secret len=%d, secret_hex=%x", len(secretStr), secretStr)

	now := time.Now()
	log.Printf("[TOTP DEBUG] server time=%d (unix), server_time_rfc3339=%s", now.Unix(), now.Format(time.RFC3339))
	log.Printf("[TOTP DEBUG] submitted code=%s", code)

	expected, err := totp.GenerateCode(secretStr, now)
	if err != nil {
		log.Printf("[TOTP DEBUG] GenerateCode error: %v", err)
	} else {
		log.Printf("[TOTP DEBUG] expected code for current time=%s", expected)
	}

	valid := totp.Validate(code, secretStr)
	log.Printf("[TOTP DEBUG] totp.Validate result=%v", valid)
	return valid
}

func (s *TOTPService) ValidateBackupCode(code string) bool {
	code = strings.ToLower(code)
	hash := sha256.Sum256([]byte(code))
	hashHex := hex.EncodeToString(hash[:])

	var id int
	err := s.db.QueryRow("SELECT id FROM backup_codes WHERE code_hash = ? AND used = FALSE", hashHex).Scan(&id)
	if err != nil {
		return false
	}

	s.db.Exec("UPDATE backup_codes SET used = TRUE WHERE id = ?", id)
	return true
}

func (s *TOTPService) GetBackupCodes() ([]string, error) {
	rows, err := s.db.Query("SELECT code_hash FROM backup_codes WHERE used = FALSE")
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
	return codes, nil
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
