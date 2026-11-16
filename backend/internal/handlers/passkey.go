package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/gugabguerra/glcert/internal/services"
)

// PasskeyHandler manages a user's passkeys and checks one as the second
// sign-in factor.
type PasskeyHandler struct {
	passkeys *services.PasskeyService
	totp     *services.TOTPService
	auth     *services.AuthService
}

func NewPasskeyHandler(passkeys *services.PasskeyService, totp *services.TOTPService, auth *services.AuthService) *PasskeyHandler {
	return &PasskeyHandler{passkeys: passkeys, totp: totp, auth: auth}
}

// List returns the caller's passkeys, whether this server address can register
// new ones, and the origin they are accepted from.
func (h *PasskeyHandler) List(w http.ResponseWriter, r *http.Request) {
	passkeys, err := h.passkeys.List(GetUserID(r.Context()))
	if err != nil {
		logger.Errorf("list passkeys: %v", err)
		http.Error(w, "could not list passkeys", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{
		"available": h.passkeys.Available(),
		"origin":    h.passkeys.Origin(),
		"passkeys":  passkeys,
	})
}

func (h *PasskeyHandler) RegisterBegin(w http.ResponseWriter, r *http.Request) {
	options, err := h.passkeys.BeginRegistration(GetUserID(r.Context()))
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, options)
}

func (h *PasskeyHandler) RegisterFinish(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name       string          `json:"name"`
		Credential json.RawMessage `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Credential) == 0 {
		http.Error(w, "credential is required", http.StatusBadRequest)
		return
	}

	userID := GetUserID(r.Context())
	passkey, err := h.passkeys.FinishRegistration(userID, req.Name, req.Credential)
	if err != nil {
		h.fail(w, err)
		return
	}

	// A passkey can be lost with its device. An account with no unused backup
	// code gets a fresh set now, shown once, so there is always a way back in.
	resp := map[string]interface{}{"passkey": passkey}
	if !h.totp.HasBackupCodes(userID) {
		codes, err := h.totp.IssueBackupCodes(userID)
		if err != nil {
			logger.Errorf("issue backup codes: %v", err)
		} else {
			resp["backupCodes"] = codes
		}
	}
	writeJSON(w, resp)
}

// Remove deletes a passkey. It weakens the account, so it asks for the
// password again, like turning the authenticator app off does.
func (h *PasskeyHandler) Remove(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
		http.Error(w, "password is required", http.StatusBadRequest)
		return
	}

	userID := GetUserID(r.Context())
	// 403, not 401: the client treats 401 as an expired session.
	if !h.auth.ValidatePassword(userID, req.Password) {
		http.Error(w, "wrong password", http.StatusForbidden)
		return
	}
	if err := h.passkeys.Remove(userID, chi.URLParam(r, "id")); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

type passkeyLoginRequest struct {
	PartialToken string          `json:"partialToken"`
	Credential   json.RawMessage `json:"credential"`
}

// pendingUser resolves the account behind a pending sign-in token.
func (h *PasskeyHandler) pendingUser(w http.ResponseWriter, token string) (string, bool) {
	if !strings.HasPrefix(token, "totp_pending_") {
		http.Error(w, "invalid partial token", http.StatusBadRequest)
		return "", false
	}
	valid, userID := h.auth.ValidatePendingToken(token)
	if !valid {
		http.Error(w, "invalid pending token", http.StatusUnauthorized)
		return "", false
	}
	return userID, true
}

// LoginBegin issues a passkey challenge for a sign-in that already passed the
// password check.
func (h *PasskeyHandler) LoginBegin(w http.ResponseWriter, r *http.Request) {
	var req passkeyLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PartialToken == "" {
		http.Error(w, "partialToken is required", http.StatusBadRequest)
		return
	}
	userID, ok := h.pendingUser(w, req.PartialToken)
	if !ok {
		return
	}

	options, err := h.passkeys.BeginLogin(req.PartialToken, userID)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, options)
}

// LoginFinish verifies the passkey signature and turns the pending sign-in
// into a session.
func (h *PasskeyHandler) LoginFinish(w http.ResponseWriter, r *http.Request) {
	var req passkeyLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PartialToken == "" || len(req.Credential) == 0 {
		http.Error(w, "partialToken and credential are required", http.StatusBadRequest)
		return
	}
	userID, ok := h.pendingUser(w, req.PartialToken)
	if !ok {
		return
	}

	if err := h.passkeys.FinishLogin(req.PartialToken, userID, req.Credential); err != nil {
		// Counted like a wrong code: five failures burn the pending sign-in.
		h.auth.RecordPendingFailure(req.PartialToken)
		if errors.Is(err, services.ErrPasskeyRejected) || errors.Is(err, services.ErrNoPasskeyCeremony) {
			http.Error(w, "passkey verification failed", http.StatusUnauthorized)
			return
		}
		h.fail(w, err)
		return
	}

	token, _, err := h.auth.CompletePendingLogin(req.PartialToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	user, _ := h.auth.GetUserByID(userID)
	writeJSON(w, map[string]interface{}{
		"token": token,
		"user":  user,
	})
}

// fail maps a service error onto a status without leaking internals.
func (h *PasskeyHandler) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrPasskeysUnavailable):
		http.Error(w, err.Error(), http.StatusConflict)
	case errors.Is(err, services.ErrPasskeyNotFound):
		http.Error(w, err.Error(), http.StatusNotFound)
	case errors.Is(err, services.ErrPasskeyLimit),
		errors.Is(err, services.ErrNoPasskeyCeremony),
		errors.Is(err, services.ErrPasskeyRejected):
		http.Error(w, err.Error(), http.StatusBadRequest)
	default:
		logger.Errorf("passkey: %v", err)
		http.Error(w, "passkey request failed", http.StatusInternalServerError)
	}
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
