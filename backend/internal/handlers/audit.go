package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/glcert/glcert/internal/services"
)

type AuditHandler struct {
	audit *services.AuditService
}

func NewAuditHandler(audit *services.AuditService) *AuditHandler {
	return &AuditHandler{audit: audit}
}

func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	actionFilter := r.URL.Query().Get("action")

	entries, total, err := h.audit.List(page, limit, actionFilter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if entries == nil {
		entries = []services.AuditEntry{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"entries": entries,
		"total":   total,
	})
}
