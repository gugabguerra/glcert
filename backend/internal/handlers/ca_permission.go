package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/glcert/glcert/internal/services"
	"github.com/go-chi/chi/v5"
)

type CAPermissionHandler struct {
	auth *services.AuthService
}

func NewCAPermissionHandler(auth *services.AuthService) *CAPermissionHandler {
	return &CAPermissionHandler{auth: auth}
}

func (h *CAPermissionHandler) Get(w http.ResponseWriter, r *http.Request) {
	caID := chi.URLParam(r, "id")
	userIDs, err := h.auth.GetCAPermissions(caID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if userIDs == nil {
		userIDs = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"caId":    caID,
		"userIds": userIDs,
	})
}

func (h *CAPermissionHandler) Set(w http.ResponseWriter, r *http.Request) {
	caID := chi.URLParam(r, "id")
	var req struct {
		UserIDs []string `json:"userIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.auth.SetCAPermissions(caID, req.UserIDs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
