package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/glcert/glcert/internal/models"
	"github.com/glcert/glcert/internal/services"
	"github.com/go-chi/chi/v5"
)

type UserHandler struct {
	auth *services.AuthService
}

func NewUserHandler(auth *services.AuthService) *UserHandler {
	return &UserHandler{auth: auth}
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
		if err := h.auth.UpdateUserRole(userID, req.Role); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
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

	if err := h.auth.DeleteUser(userID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

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
