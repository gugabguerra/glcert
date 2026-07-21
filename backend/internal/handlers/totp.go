package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/pquerna/otp/totp"
	"github.com/glcert/glcert/internal/services"
)

type TOTPHandler struct {
	totp *services.TOTPService
	auth *services.AuthService
}

func NewTOTPHandler(totp *services.TOTPService, auth *services.AuthService) *TOTPHandler {
	return &TOTPHandler{totp: totp, auth: auth}
}

func (h *TOTPHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{
		"enabled": h.totp.IsEnabled(),
	})
}

func (h *TOTPHandler) Setup(w http.ResponseWriter, r *http.Request) {
	email, err := h.auth.GetAdminEmail()
	if err != nil {
		http.Error(w, "admin not found", http.StatusInternalServerError)
		return
	}

	result, err := h.totp.GenerateSecret(email)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

type VerifySetupRequest struct {
	Secret string   `json:"secret"`
	Code   string   `json:"code"`
	Codes  []string `json:"codes"`
}

func (h *TOTPHandler) VerifySetup(w http.ResponseWriter, r *http.Request) {
	var req VerifySetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Code == "" || req.Secret == "" {
		http.Error(w, "code and secret are required", http.StatusBadRequest)
		return
	}

	if !totp.Validate(req.Code, req.Secret) {
		http.Error(w, "invalid TOTP code", http.StatusBadRequest)
		return
	}

	if err := h.totp.EnableTOTP(req.Secret, req.Codes); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

type VerifyRequest struct {
	PartialToken string `json:"partialToken"`
	Code         string `json:"code"`
}

func (h *TOTPHandler) Verify(w http.ResponseWriter, r *http.Request) {
	var req VerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.PartialToken == "" || req.Code == "" {
		http.Error(w, "partialToken and code are required", http.StatusBadRequest)
		return
	}

	if !strings.HasPrefix(req.PartialToken, "totp_pending_") {
		http.Error(w, "invalid partial token", http.StatusBadRequest)
		return
	}

	log.Printf("[TOTP VERIFY DEBUG] code_len=%d, partialToken prefix=%s", len(req.Code), req.PartialToken[:16])
	valid := false
	if len(req.Code) >= 8 {
		valid = h.totp.ValidateBackupCode(req.Code)
		log.Printf("[TOTP VERIFY DEBUG] backup code validation: %v", valid)
	} else {
		valid = h.totp.ValidateCode(req.Code)
		log.Printf("[TOTP VERIFY DEBUG] TOTP code validation: %v", valid)
	}

	if !valid {
		http.Error(w, "invalid code", http.StatusUnauthorized)
		return
	}

	token, err := h.auth.CompletePendingLogin(req.PartialToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

type DisableRequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

func (h *TOTPHandler) Disable(w http.ResponseWriter, r *http.Request) {
	var req DisableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Password == "" || req.Code == "" {
		http.Error(w, "password and code are required", http.StatusBadRequest)
		return
	}

	if !h.auth.ValidatePassword(req.Password) {
		http.Error(w, "invalid password", http.StatusUnauthorized)
		return
	}

	if !h.totp.ValidateCode(req.Code) {
		http.Error(w, "invalid TOTP code", http.StatusUnauthorized)
		return
	}

	if err := h.totp.DisableTOTP(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
