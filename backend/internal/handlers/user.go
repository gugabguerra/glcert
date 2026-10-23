package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/gugabguerra/glcert/internal/models"
	"github.com/gugabguerra/glcert/internal/services"
)

type UserHandler struct {
	auth   *services.AuthService
	crypto *services.CryptoService
}

func NewUserHandler(auth *services.AuthService, crypto *services.CryptoService) *UserHandler {
	return &UserHandler{auth: auth, crypto: crypto}
}

func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	users, err := h.auth.ListUsers()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if users == nil {
		users = []models.User{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" || req.Role == "" {
		http.Error(w, "email, password, and role are required", http.StatusBadRequest)
		return
	}

	if req.Role != "admin" && req.Role != "operator" && req.Role != "viewer" {
		http.Error(w, "role must be admin, operator, or viewer", http.StatusBadRequest)
		return
	}

	user, err := h.auth.CreateUser(req.Name, req.Email, req.Password, req.Role)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	syncAdminKey(h.crypto, user.ID, user.Role, req.Password)
	recordAudit(h.auth.DB(), r, "user.create", "user", user.ID, fmt.Sprintf("%s (%s)", user.Email, user.Role))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(user)
}

func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	userID := chi.URLParam(r, "id")
	if userID == "" {
		http.Error(w, "user ID is required", http.StatusBadRequest)
		return
	}

	if req.Name != "" {
		h.auth.UpdateUserName(userID, req.Name)
	}

	if req.Role != "" {
		if req.Role != "admin" && req.Role != "operator" && req.Role != "viewer" {
			http.Error(w, "role must be admin, operator, or viewer", http.StatusBadRequest)
			return
		}
		oldRole, _ := h.auth.GetUserRole(userID)
		if err := h.auth.UpdateUserRole(userID, req.Role); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if oldRole == "admin" && req.Role != "admin" {
			if err := h.crypto.RemoveWrap(userID); err != nil {
				logger.Errorf("Remove encryption key copy: %v", err)
			}
		}
		if oldRole != req.Role {
			email, _ := h.auth.GetUserEmail(userID)
			recordAudit(h.auth.DB(), r, "user.role_change", "user", userID, fmt.Sprintf("%s: %s → %s", email, oldRole, req.Role))
		}
	}

	user, err := h.auth.GetUserByID(userID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (h *UserHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		http.Error(w, "user ID is required", http.StatusBadRequest)
		return
	}

	callerID := GetUserID(r.Context())
	if callerID == userID {
		http.Error(w, "cannot delete your own account", http.StatusBadRequest)
		return
	}

	email, _ := h.auth.GetUserEmail(userID)
	if err := h.auth.DeleteUser(userID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.crypto.RemoveWrap(userID); err != nil {
		logger.Errorf("Remove encryption key copy: %v", err)
	}
	recordAudit(h.auth.DB(), r, "user.delete", "user", userID, email)

	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		http.Error(w, "user ID is required", http.StatusBadRequest)
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if len(req.Password) < 6 {
		http.Error(w, "password must be at least 6 characters", http.StatusBadRequest)
		return
	}

	if err := h.auth.AdminResetPassword(userID, req.Password); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	role, _ := h.auth.GetUserRole(userID)
	syncAdminKey(h.crypto, userID, role, req.Password)
	email, _ := h.auth.GetUserEmail(userID)
	recordAudit(h.auth.DB(), r, "user.password_reset", "user", userID, email)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r.Context())
	user, err := h.auth.GetUserByID(userID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (h *UserHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r.Context())
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.auth.UpdateUserName(userID, req.Name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	user, _ := h.auth.GetUserByID(userID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}
