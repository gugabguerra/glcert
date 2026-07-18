package services

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	db *sql.DB
}

func NewAuthService(db *sql.DB) *AuthService {
	return &AuthService{db: db}
}

type SetupInput struct {
	Username            string
	Password            string
	EncryptionPassphrase string
	Organization        string
	Country             string
	State               string
	City                string
	Email               string
}

func (s *AuthService) IsSetupComplete() bool {
	var complete bool
	err := s.db.QueryRow("SELECT setup_complete FROM settings WHERE id = 1").Scan(&complete)
	if err != nil {
		return false
	}
	return complete
}

func (s *AuthService) CompleteSetup(input SetupInput) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}

	_, err = s.db.Exec(`
		INSERT INTO admin (id, username, password_hash) VALUES (1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET username = ?, password_hash = ?
	`, input.Username, string(hash), input.Username, string(hash))
	if err != nil {
		return "", fmt.Errorf("save admin: %w", err)
	}

	_, err = s.db.Exec(`
		UPDATE settings SET
			setup_complete = TRUE,
			organization = ?,
			country = ?,
			state = ?,
			city = ?,
			email = ?
		WHERE id = 1
	`, input.Organization, input.Country, input.State, input.City, input.Email)
	if err != nil {
		return "", fmt.Errorf("save settings: %w", err)
	}

	token, err := s.generateToken()
	if err != nil {
		return "", err
	}

	expires := time.Now().Add(24 * time.Hour)
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			expires_at DATETIME NOT NULL
		)
	`)
	if err != nil {
		return "", err
	}

	_, err = s.db.Exec("INSERT INTO sessions (token, expires_at) VALUES (?, ?)", token, expires)
	if err != nil {
		return "", fmt.Errorf("save session: %w", err)
	}

	return token, nil
}

func (s *AuthService) Login(username, password string) (string, error) {
	var storedHash string
	err := s.db.QueryRow("SELECT password_hash FROM admin WHERE id = 1").Scan(&storedHash)
	if err != nil {
		return "", fmt.Errorf("admin not found")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password)); err != nil {
		return "", fmt.Errorf("invalid credentials")
	}

	token, err := s.generateToken()
	if err != nil {
		return "", err
	}

	expires := time.Now().Add(24 * time.Hour)
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			expires_at DATETIME NOT NULL
		)
	`)
	if err != nil {
		return "", err
	}

	_, err = s.db.Exec("INSERT INTO sessions (token, expires_at) VALUES (?, ?)", token, expires)
	if err != nil {
		return "", fmt.Errorf("save session: %w", err)
	}

	return token, nil
}

func (s *AuthService) ChangePassword(currentPassword, newPassword string) error {
	var storedHash string
	err := s.db.QueryRow("SELECT password_hash FROM admin WHERE id = 1").Scan(&storedHash)
	if err != nil {
		return fmt.Errorf("admin not found")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(currentPassword)); err != nil {
		return fmt.Errorf("invalid current password")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	_, err = s.db.Exec("UPDATE admin SET password_hash = ? WHERE id = 1", string(hash))
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	return nil
}

func (s *AuthService) ValidateSession(token string) bool {
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM sessions WHERE token = ? AND expires_at > ?", token, time.Now()).Scan(&count)
	if err != nil {
		return false
	}
	return count > 0
}

func (s *AuthService) Logout(token string) {
	s.db.Exec("DELETE FROM sessions WHERE token = ?", token)
}

func (s *AuthService) CleanupSessions() {
	s.db.Exec("DELETE FROM sessions WHERE expires_at <= ?", time.Now())
}

func (s *AuthService) generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return hex.EncodeToString(b), nil
}
