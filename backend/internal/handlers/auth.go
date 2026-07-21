package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/glcert/glcert/internal/services"
)

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
	var req SetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" || req.EncryptionPassphrase == "" {
		http.Error(w, "email, password, and encryptionPassphrase are required", http.StatusBadRequest)
		return
	}

	token, err := h.auth.CompleteSetup(services.SetupInput{
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
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

	log.Printf("[LOGIN DEBUG] HasPassphrase=%v", h.crypto.HasPassphrase())
	if h.crypto.HasPassphrase() {
		if err := h.crypto.LoadPassphrase(req.Password); err != nil {
			log.Printf("[LOGIN DEBUG] LoadPassphrase failed: %v", err)
			http.Error(w, "failed to load encryption passphrase", http.StatusInternalServerError)
			return
		}
	}

	log.Printf("[LOGIN DEBUG] TOTPEnabled=%v, returning partialToken", result.TOTPEnabled)
	if result.TOTPEnabled {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"partialToken": result.Token,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": result.Token})
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

	if err := h.auth.ChangePassword(req.CurrentPassword, req.NewPassword); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	if h.crypto.HasPassphrase() {
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

	adminEmail, err := h.auth.GetAdminEmail()
	if err != nil || adminEmail != req.Email {
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

	h.auth.SaveResetToken(token)

	resetURL := fmt.Sprintf("%s/reset-password?token=%s", "http://"+r.Host, token)
	h.email.SendPasswordResetEmail(adminEmail, resetURL)

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

	if h.crypto.HasPassphrase() {
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
