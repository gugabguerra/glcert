package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/gugabguerra/glcert/internal/services"
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
	db := h.auth.DB()
	var caName string
	_ = db.QueryRow("SELECT name FROM certificate_authorities WHERE id = ?", caID).Scan(&caName)
	recordAudit(db, r, "ca.permissions.update", "ca", caID, fmt.Sprintf("%s: %d user(s) granted", caName, len(req.UserIDs)))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
