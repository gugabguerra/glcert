package services

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/glcert/glcert/internal/logger"
	"github.com/glcert/glcert/internal/models"
	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	db *sql.DB
}

func NewAuthService(db *sql.DB) *AuthService {
	return &AuthService{db: db}
}

func (s *AuthService) DB() *sql.DB {
	return s.db
}

type SetupInput struct {
	Email                string
	Password             string
	EncryptionPassphrase string
	Organization         string
	Country              string
	State                string
	City                 string
}

func (s *AuthService) IsSetupComplete() bool {
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return false
	}
	return count > 0
}

func (s *AuthService) CompleteSetup(input SetupInput) (string, string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return "", "", fmt.Errorf("hash password: %w", err)
	}

	var userID string
	err = s.db.QueryRow("SELECT LOWER(HEX(RANDOMBLOB(4)) || '-' || HEX(RANDOMBLOB(2)) || '-4' || SUBSTR(HEX(RANDOMBLOB(2)),2) || '-' || HEX(RANDOMBLOB(2)) || '-' || HEX(RANDOMBLOB(6)))").Scan(&userID)
	if err != nil {
		return "", "", fmt.Errorf("generate user ID: %w", err)
	}

	// Atomically create the first (admin) user. The NOT EXISTS guard makes
	// concurrent setup attempts safe: only one request can ever create the
	// initial admin account.
	res, err := s.db.Exec(`
		INSERT INTO users (id, email, password_hash, role)
		SELECT ?, ?, ?, 'admin'
		WHERE NOT EXISTS (SELECT 1 FROM users)
	`, userID, input.Email, string(hash))
	if err != nil {
		return "", "", fmt.Errorf("save user: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil || rows == 0 {
		return "", "", fmt.Errorf("setup already completed")
	}

	_, err = s.db.Exec(`
		UPDATE settings SET
			organization = ?,
			country = ?,
			state = ?,
			city = ?,
			email = ?
		WHERE id = 1
	`, input.Organization, input.Country, input.State, input.City, input.Email)
	if err != nil {
		return "", "", fmt.Errorf("save settings: %w", err)
	}

	token, err := s.generateToken()
	if err != nil {
		return "", "", err
	}

	expires := time.Now().Add(24 * time.Hour)
	_, err = s.db.Exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, userID, expires)
	if err != nil {
		return "", "", fmt.Errorf("save session: %w", err)
	}

	return token, userID, nil
}

type LoginResult struct {
	Token       string
	UserID      string
	Role        string
	TOTPEnabled bool
}

func (s *AuthService) Login(email, password string) (LoginResult, error) {
	var userID, storedHash, role string
	err := s.db.QueryRow("SELECT id, password_hash, role FROM users WHERE email = ?", email).Scan(&userID, &storedHash, &role)
	if err != nil {
		// Log the same generic message as a password mismatch so logs cannot
		// be used to enumerate registered email addresses.
		logger.Errorf("Login failed for email=%q", email)
		return LoginResult{}, fmt.Errorf("invalid credentials")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password)); err != nil {
		logger.Errorf("Login failed for email=%q", email)
		return LoginResult{}, fmt.Errorf("invalid credentials")
	}

	var totpEnabled bool
	s.db.QueryRow("SELECT totp_enabled FROM users WHERE id = ?", userID).Scan(&totpEnabled)

	if totpEnabled {
		pendingToken, err := s.generatePendingToken()
		if err != nil {
			return LoginResult{}, err
		}

		expires := time.Now().Add(5 * time.Minute)
		_, err = s.db.Exec("INSERT INTO pending_sessions (token, user_id, expires_at) VALUES (?, ?, ?)", pendingToken, userID, expires)
		if err != nil {
			return LoginResult{}, fmt.Errorf("save pending session: %w", err)
		}

		return LoginResult{Token: pendingToken, UserID: userID, Role: role, TOTPEnabled: true}, nil
	}

	token, err := s.generateToken()
	if err != nil {
		return LoginResult{}, err
	}

	expires := time.Now().Add(24 * time.Hour)
	_, err = s.db.Exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, userID, expires)
	if err != nil {
		return LoginResult{}, fmt.Errorf("save session: %w", err)
	}

	return LoginResult{Token: token, UserID: userID, Role: role, TOTPEnabled: false}, nil
}

func (s *AuthService) ValidatePendingToken(token string) (bool, string) {
	var userID string
	err := s.db.QueryRow("SELECT user_id FROM pending_sessions WHERE token = ? AND expires_at > ?", token, time.Now()).Scan(&userID)
	if err != nil {
		return false, ""
	}
	return true, userID
}

func (s *AuthService) DeletePendingToken(token string) {
	s.db.Exec("DELETE FROM pending_sessions WHERE token = ?", token)
}

func (s *AuthService) CompletePendingLogin(pendingToken string) (string, string, error) {
	valid, userID := s.ValidatePendingToken(pendingToken)
	if !valid {
		return "", "", fmt.Errorf("invalid or expired pending session")
	}

	token, err := s.generateToken()
	if err != nil {
		return "", "", err
	}

	expires := time.Now().Add(24 * time.Hour)
	_, err = s.db.Exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, userID, expires)
	if err != nil {
		return "", "", fmt.Errorf("save session: %w", err)
	}

	s.DeletePendingToken(pendingToken)
	return token, userID, nil
}

func (s *AuthService) generatePendingToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate pending token: %w", err)
	}
	return "totp_pending_" + hex.EncodeToString(b), nil
}

func (s *AuthService) ChangePassword(userID, currentPassword, newPassword string) error {
	var storedHash string
	err := s.db.QueryRow("SELECT password_hash FROM users WHERE id = ?", userID).Scan(&storedHash)
	if err != nil {
		return fmt.Errorf("user not found")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(currentPassword)); err != nil {
		return fmt.Errorf("invalid current password")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	_, err = s.db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", string(hash), userID)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	s.InvalidateUserSessions(userID)

	return nil
}

// InvalidateUserSessions revokes every active session for a user, so a
// password change (self, admin reset, or forgotten-password reset) forces a
// fresh login and drops any sessions an attacker may already hold.
func (s *AuthService) InvalidateUserSessions(userID string) {
	s.db.Exec("DELETE FROM sessions WHERE user_id = ?", userID)
	s.db.Exec("DELETE FROM pending_sessions WHERE user_id = ?", userID)
}

func (s *AuthService) ValidatePassword(userID, password string) bool {
	var storedHash string
	err := s.db.QueryRow("SELECT password_hash FROM users WHERE id = ?", userID).Scan(&storedHash)
	if err != nil {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password)) == nil
}

func (s *AuthService) ValidateSession(token string) (bool, string) {
	var userID string
	err := s.db.QueryRow("SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?", token, time.Now()).Scan(&userID)
	if err != nil {
		return false, ""
	}
	return true, userID
}

func (s *AuthService) GetSessionUser(token string) (string, string, error) {
	var userID, role string
	err := s.db.QueryRow(`
		SELECT u.id, u.role FROM sessions s
		JOIN users u ON s.user_id = u.id
		WHERE s.token = ? AND s.expires_at > ?
	`, token, time.Now()).Scan(&userID, &role)
	if err != nil {
		return "", "", err
	}
	return userID, role, nil
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

func (s *AuthService) GetUserByID(userID string) (*models.User, error) {
	var user models.User
	err := s.db.QueryRow("SELECT id, name, email, role, totp_enabled, created_at FROM users WHERE id = ?", userID).Scan(
		&user.ID, &user.Name, &user.Email, &user.Role, &user.TOTPEnabled, &user.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *AuthService) GetUserEmail(userID string) (string, error) {
	var email string
	err := s.db.QueryRow("SELECT email FROM users WHERE id = ?", userID).Scan(&email)
	return email, err
}

func (s *AuthService) GetUserRole(userID string) (string, error) {
	var role string
	err := s.db.QueryRow("SELECT role FROM users WHERE id = ?", userID).Scan(&role)
	return role, err
}

func (s *AuthService) GenerateResetToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *AuthService) SaveResetToken(userID, token string) error {
	expires := time.Now().Add(15 * time.Minute)
	_, err := s.db.Exec("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)", userID, token, expires)
	return err
}

func (s *AuthService) ValidateResetToken(token string) (bool, string) {
	var userID string
	err := s.db.QueryRow(
		"SELECT user_id FROM password_resets WHERE token = ? AND expires_at > ?",
		token, time.Now(),
	).Scan(&userID)
	if err != nil {
		return false, ""
	}
	return true, userID
}

func (s *AuthService) ResetPassword(token, newPassword string) error {
	valid, userID := s.ValidateResetToken(token)
	if !valid {
		return fmt.Errorf("invalid or expired reset token")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	_, err = s.db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", string(hash), userID)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	_, err = s.db.Exec("DELETE FROM password_resets WHERE token = ?", token)
	if err != nil {
		return err
	}

	s.InvalidateUserSessions(userID)
	return nil
}

// --- User Management (admin only) ---

func (s *AuthService) CreateUser(name, email, password, role string) (*models.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	var userID string
	err = s.db.QueryRow("SELECT LOWER(HEX(RANDOMBLOB(4)) || '-' || HEX(RANDOMBLOB(2)) || '-4' || SUBSTR(HEX(RANDOMBLOB(2)),2) || '-' || HEX(RANDOMBLOB(2)) || '-' || HEX(RANDOMBLOB(6)))").Scan(&userID)
	if err != nil {
		return nil, fmt.Errorf("generate user ID: %w", err)
	}

	_, err = s.db.Exec("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
		userID, name, email, string(hash), role)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	return s.GetUserByID(userID)
}

func (s *AuthService) ListUsers() ([]models.User, error) {
	rows, err := s.db.Query("SELECT id, name, email, role, totp_enabled, created_at FROM users ORDER BY created_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.TOTPEnabled, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *AuthService) UpdateUserRole(userID, role string) error {
	_, err := s.db.Exec("UPDATE users SET role = ? WHERE id = ?", role, userID)
	return err
}

func (s *AuthService) DeleteUser(userID string) error {
	// Check if this is the last admin
	var adminCount int
	s.db.QueryRow("SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&adminCount)
	if adminCount <= 1 {
		var currentRole string
		s.db.QueryRow("SELECT role FROM users WHERE id = ?", userID).Scan(&currentRole)
		if currentRole == "admin" {
			return fmt.Errorf("cannot delete the last admin user")
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	tx.Exec("DELETE FROM sessions WHERE user_id = ?", userID)
	tx.Exec("DELETE FROM pending_sessions WHERE user_id = ?", userID)
	tx.Exec("DELETE FROM backup_codes WHERE user_id = ?", userID)
	tx.Exec("DELETE FROM ca_permissions WHERE user_id = ?", userID)
	tx.Exec("DELETE FROM password_resets WHERE user_id = ?", userID)
	_, err = tx.Exec("DELETE FROM users WHERE id = ?", userID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (s *AuthService) AdminResetPassword(userID, newPassword string) error {
	var exists int
	s.db.QueryRow("SELECT COUNT(*) FROM users WHERE id = ?", userID).Scan(&exists)
	if exists == 0 {
		return fmt.Errorf("user not found")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	_, err = s.db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", string(hash), userID)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	s.InvalidateUserSessions(userID)

	return nil
}

func (s *AuthService) UpdateUserName(userID, name string) error {
	_, err := s.db.Exec("UPDATE users SET name = ? WHERE id = ?", name, userID)
	return err
}

// --- CA Permissions ---

func (s *AuthService) UserHasCAAccess(userID, caID string) bool {
	// Admins have access to everything
	role, err := s.GetUserRole(userID)
	if err == nil && role == "admin" {
		return true
	}

	// Walk the parent_ca_id chain
	var currentID string
	err = s.db.QueryRow("SELECT id FROM certificate_authorities WHERE id = ?", caID).Scan(&currentID)
	if err != nil {
		return false
	}

	for currentID != "" {
		var count int
		s.db.QueryRow("SELECT COUNT(*) FROM ca_permissions WHERE user_id = ? AND ca_id = ?", userID, currentID).Scan(&count)
		if count > 0 {
			return true
		}
		var parentID sql.NullString
		s.db.QueryRow("SELECT parent_ca_id FROM certificate_authorities WHERE id = ?", currentID).Scan(&parentID)
		if !parentID.Valid || parentID.String == "" {
			break
		}
		currentID = parentID.String
	}
	return false
}

func (s *AuthService) GetCAPermissions(caID string) ([]string, error) {
	rows, err := s.db.Query("SELECT user_id FROM ca_permissions WHERE ca_id = ?", caID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *AuthService) SetCAPermissions(caID string, userIDs []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	tx.Exec("DELETE FROM ca_permissions WHERE ca_id = ?", caID)
	for _, uid := range userIDs {
		tx.Exec("INSERT INTO ca_permissions (ca_id, user_id) VALUES (?, ?)", caID, uid)
	}
	return tx.Commit()
}

func (s *AuthService) GetAccessibleCAIDs(userID string) ([]string, error) {
	role, err := s.GetUserRole(userID)
	if err != nil {
		return nil, err
	}
	if role == "admin" {
		return nil, nil // nil means no filter
	}

	rows, err := s.db.Query(`
		SELECT DISTINCT ca_id FROM ca_permissions WHERE user_id = ?
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
