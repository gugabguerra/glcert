package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gugabguerra/glcert/internal/services"
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

// recordAudit writes an audit_log row attributed to the requesting user (if
// any). Callers pass only identifiers and names in details — never secrets,
// passwords, tokens, key material or other user-typed free text.
func recordAudit(db *sql.DB, r *http.Request, action, entityType, entityID, details string) {
	userID := GetUserID(r.Context())
	recordAuditAs(db, userID, actorEmail(db, userID), action, entityType, entityID, details)
}

// recordAuditAs is recordAudit for callers that resolved the actor up front,
// e.g. because the operation removes the user row.
func recordAuditAs(db *sql.DB, userID, userEmail, action, entityType, entityID, details string) {
	services.NewAuditService(db).Log(userID, userEmail, action, entityType, entityID, details)
}

func actorEmail(db *sql.DB, userID string) string {
	if userID == "" {
		return ""
	}
	var email string
	_ = db.QueryRow("SELECT email FROM users WHERE id = ?", userID).Scan(&email)
	return email
}
