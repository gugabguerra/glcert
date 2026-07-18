package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/glcert/glcert/internal/services"
)

type AuthHandler struct {
	auth   *services.AuthService
	crypto *services.CryptoService
}

func NewAuthHandler(auth *services.AuthService, crypto *services.CryptoService) *AuthHandler {
	return &AuthHandler{auth: auth, crypto: crypto}
}

type SetupRequest struct {
	Username             string `json:"username"`
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

	if req.Username == "" || req.Password == "" || req.EncryptionPassphrase == "" {
		http.Error(w, "username, password, and encryptionPassphrase are required", http.StatusBadRequest)
		return
	}

	token, err := h.auth.CompleteSetup(services.SetupInput{
		Username:             req.Username,
		Password:             req.Password,
		EncryptionPassphrase: req.EncryptionPassphrase,
		Organization:         req.Organization,
		Country:              req.Country,
		State:                req.State,
		City:                 req.City,
		Email:                req.Email,
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
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Username == "" || req.Password == "" {
		http.Error(w, "username and password are required", http.StatusBadRequest)
		return
	}

	token, err := h.auth.Login(req.Username, req.Password)
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	if h.crypto.HasPassphrase() {
		if err := h.crypto.LoadPassphrase(req.Password); err != nil {
			http.Error(w, "failed to load encryption passphrase", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
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

func extractToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}
