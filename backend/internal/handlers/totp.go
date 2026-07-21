package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/glcert/glcert/internal/services"
	"github.com/pquerna/otp/totp"
)

type TOTPHandler struct {
	totp *services.TOTPService
	auth *services.AuthService
}

func NewTOTPHandler(totp *services.TOTPService, auth *services.AuthService) *TOTPHandler {
	return &TOTPHandler{totp: totp, auth: auth}
}

func (h *TOTPHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{
		"enabled": h.totp.IsEnabled(userID),
	})
}

func (h *TOTPHandler) Setup(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r.Context())
	email, err := h.auth.GetUserEmail(userID)
	if err != nil {
		http.Error(w, "user not found", http.StatusInternalServerError)
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

	userID := GetUserID(r.Context())
	if err := h.totp.EnableTOTP(userID, req.Secret, req.Codes); err != nil {
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

	// Resolve user from pending session
	valid, userID := h.auth.ValidatePendingToken(req.PartialToken)
	if !valid {
		http.Error(w, "invalid pending token", http.StatusUnauthorized)
		return
	}

	var codeValid bool
	if len(req.Code) >= 8 {
		codeValid = h.totp.ValidateBackupCode(userID, req.Code)
	} else {
		codeValid = h.totp.ValidateCode(userID, req.Code)
	}

	if !codeValid {
		http.Error(w, "invalid code", http.StatusUnauthorized)
		return
	}

	token, _, err := h.auth.CompletePendingLogin(req.PartialToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	user, _ := h.auth.GetUserByID(userID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user":  user,
	})
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

	userID := GetUserID(r.Context())
	if !h.auth.ValidatePassword(userID, req.Password) {
		http.Error(w, "invalid password", http.StatusUnauthorized)
		return
	}

	if !h.totp.ValidateCode(userID, req.Code) {
		http.Error(w, "invalid TOTP code", http.StatusUnauthorized)
		return
	}

	if err := h.totp.DisableTOTP(userID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
