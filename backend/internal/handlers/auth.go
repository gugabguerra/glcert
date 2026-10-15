package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/gugabguerra/glcert/internal/services"
)

// appBaseURL derives the externally reachable base URL for links embedded in
// emails (e.g. password reset). It honours X-Forwarded-Proto when present and
// validates the Host header so a poisoned or malformed Host cannot be used to
// craft phishing links or header-injection payloads.
func appBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	host := strings.TrimSpace(r.Host)
	if host == "" || strings.ContainsAny(host, "/\\\r\n") {
		return "http://localhost"
	}
	if u, err := url.Parse(scheme + "://" + host); err != nil || u.Host != host || u.Path != "" {
		return "http://localhost"
	}
	return scheme + "://" + host
}

type AuthHandler struct {
	auth   *services.AuthService
	crypto *services.CryptoService
	email  *services.EmailService
	totp   *services.TOTPService
}

func NewAuthHandler(auth *services.AuthService, crypto *services.CryptoService, email *services.EmailService, totp *services.TOTPService) *AuthHandler {
	return &AuthHandler{auth: auth, crypto: crypto, email: email, totp: totp}
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

	if err := h.crypto.SavePassphrase(req.EncryptionPassphrase, req.Password); err != nil {
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

	if h.crypto.HasPassphrase() && result.Role == "admin" {
		if err := h.crypto.LoadPassphrase(req.Password); err != nil {
			http.Error(w, "failed to load encryption passphrase", http.StatusInternalServerError)
			return
		}
	}

	if result.TOTPEnabled {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"partialToken": result.Token,
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

	if h.crypto.HasPassphrase() && GetUserRole(r.Context()) == "admin" {
		if err := h.crypto.ChangeAdminPassword(req.CurrentPassword, req.NewPassword); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := h.crypto.LoadPassphrase(req.NewPassword); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
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

	h.auth.SaveResetToken(userID, token)

	resetURL := fmt.Sprintf("%s/reset-password?token=%s", appBaseURL(r), token)
	h.email.SendPasswordResetEmail(req.Email, resetURL)

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

	if err := h.auth.ResetPassword(req.Token, req.Password); err != nil {
		http.Error(w, "invalid or expired token", http.StatusBadRequest)
		return
	}

	if h.crypto.HasPassphrase() && h.crypto.IsEnabled() {
		if err := h.crypto.LoadPassphrase(req.Password); err != nil {
			http.Error(w, "password updated but failed to load encryption", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func extractToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}
