package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/gugabguerra/glcert/internal/services"
)

type AuthHandler struct {
	auth   *services.AuthService
	crypto *services.CryptoService
	email  *services.EmailService
	totp   *services.TOTPService
	// publicURL is the configured origin reset links are built from; the
	// Host header is never trusted for them.
	publicURL string
}

func NewAuthHandler(auth *services.AuthService, crypto *services.CryptoService, email *services.EmailService, totp *services.TOTPService, publicURL string) *AuthHandler {
	return &AuthHandler{auth: auth, crypto: crypto, email: email, totp: totp, publicURL: publicURL}
}

type SetupRequest struct {
	Password             string `json:"password"`
	EncryptionPassphrase string `json:"encryptionPassphrase"`
	Organization         string `json:"organization"`
	Country              string `json:"country"`
	State                string `json:"state"`
	City                 string `json:"city"`
	Email                string `json:"email"`
}

func (h *AuthHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{
		"setupComplete": h.auth.IsSetupComplete(),
	})
}

func (h *AuthHandler) Setup(w http.ResponseWriter, r *http.Request) {
	if h.auth.IsSetupComplete() {
		http.Error(w, "setup already completed", http.StatusForbidden)
		return
	}

	var req SetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" || req.EncryptionPassphrase == "" {
		http.Error(w, "email, password, and encryptionPassphrase are required", http.StatusBadRequest)
		return
	}

	token, userID, err := h.auth.CompleteSetup(services.SetupInput{
		Email:                req.Email,
		Password:             req.Password,
		EncryptionPassphrase: req.EncryptionPassphrase,
		Organization:         req.Organization,
		Country:              req.Country,
		State:                req.State,
		City:                 req.City,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := h.crypto.SavePassphrase(req.EncryptionPassphrase, userID, req.Password); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	user, _ := h.auth.GetUserByID(userID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user":  user,
	})
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" {
		http.Error(w, "email and password are required", http.StatusBadRequest)
		return
	}

	result, err := h.auth.Login(req.Email, req.Password)
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	// Unlock before the second-factor step: the TOTP secret itself is
	// encrypted, and only the password can open the key.
	if result.Role == "admin" {
		unlockForAdmin(h.auth.DB(), h.crypto, result.UserID, req.Password)
	}

	if len(result.SecondFactors) > 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"partialToken": result.Token,
			"methods":      result.SecondFactors,
		})
		return
	}

	user, _ := h.auth.GetUserByID(result.UserID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": result.Token,
		"user":  user,
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	token := extractToken(r)
	if token != "" {
		h.auth.Logout(token)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.CurrentPassword == "" || req.NewPassword == "" {
		http.Error(w, "currentPassword and newPassword are required", http.StatusBadRequest)
		return
	}

	if req.CurrentPassword == req.NewPassword {
		http.Error(w, "new password must differ from current password", http.StatusBadRequest)
		return
	}

	userID := GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.auth.ChangePassword(userID, req.CurrentPassword, req.NewPassword); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	if role := GetUserRole(r.Context()); role == "admin" {
		if !h.crypto.IsEnabled() {
			unlockForAdmin(h.auth.DB(), h.crypto, userID, req.CurrentPassword)
		}
		syncAdminKey(h.crypto, userID, role, req.NewPassword)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}

	// Look up user by email
	var userID string
	err := h.auth.DB().QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
	if err != nil {
		// Don't reveal whether user exists
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}

	token, err := h.auth.GenerateResetToken()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}

	if h.publicURL == "" {
		logger.Warnf("Password reset requested, but no email sent: PUBLIC_URL is not set")
	} else {
		h.auth.SaveResetToken(userID, token)
		h.email.SendPasswordResetEmail(req.Email, h.publicURL+"/reset-password?token="+token)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Token == "" || req.Password == "" {
		http.Error(w, "token and password are required", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 6 {
		http.Error(w, "password must be at least 6 characters", http.StatusBadRequest)
		return
	}

	userID, err := h.auth.ResetPassword(req.Token, req.Password)
	if err != nil {
		http.Error(w, "invalid or expired token", http.StatusBadRequest)
		return
	}
	role, _ := h.auth.GetUserRole(userID)
	syncAdminKey(h.crypto, userID, role, req.Password)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// UnlockEncryption is the recovery path when no admin's key copy opens (for
// example the only admin reset a forgotten password while the server was
// locked). The setup encryption passphrase unlocks the key, and the caller's
// copy is rewritten under their current password.
func (h *AuthHandler) UnlockEncryption(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Passphrase string `json:"passphrase"`
		Password   string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Passphrase == "" || req.Password == "" {
		http.Error(w, "passphrase and password are required", http.StatusBadRequest)
		return
	}
	userID := GetUserID(r.Context())
	// 403, not 401: the client treats 401 as an expired session.
	if !h.auth.ValidatePassword(userID, req.Password) {
		http.Error(w, "wrong password", http.StatusForbidden)
		return
	}
	if err := h.crypto.UnlockWithPassphrase(req.Passphrase); err != nil {
		http.Error(w, "wrong encryption passphrase", http.StatusForbidden)
		return
	}
	if err := h.crypto.SetWrap(userID, req.Password); err != nil {
		logger.Errorf("store encryption key copy: %v", err)
		http.Error(w, "unlocked, but the key copy could not be saved", http.StatusInternalServerError)
		return
	}
	recordAudit(h.auth.DB(), r, "encryption.unlock", "settings", "", "Encryption unlocked with the passphrase")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// unlockForAdmin opens the encryption key at an admin sign-in. A v1 key file
// is migrated on the spot, and a missing or stale copy is replaced when the
// service is already unlocked. A failure never blocks the sign-in: encrypted
// operations stay locked instead (fail closed).
func unlockForAdmin(db *sql.DB, crypto *services.CryptoService, userID, password string) {
	if !crypto.HasPassphrase() {
		return
	}
	err := crypto.Unlock(userID, password)
	if errors.Is(err, services.ErrLegacyKeyFile) {
		_, err = crypto.MigrateV1(db, userID, password)
	}
	if err == nil {
		return
	}
	if crypto.IsEnabled() {
		syncAdminKey(crypto, userID, "admin", password)
		return
	}
	logger.Warnf("Admin sign-in left encryption locked: %v", err)
}

// syncAdminKey keeps an admin's copy of the encryption passphrase in step with
// their password; other roles hold none. While the service is locked it does
// nothing: the admin re-enrolls at the next sign-in after any admin unlocks.
func syncAdminKey(crypto *services.CryptoService, userID, role, password string) {
	if role != "admin" || !crypto.IsEnabled() {
		return
	}
	if err := crypto.SetWrap(userID, password); err != nil {
		logger.Errorf("Store encryption key copy: %v", err)
	}
}

func extractToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}
