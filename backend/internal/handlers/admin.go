package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/gugabguerra/glcert/internal/services"
)

type AdminHandler struct {
	db      *sql.DB
	dataDir string
	crypto  *services.CryptoService
	auth    *services.AuthService
}

func NewAdminHandler(db *sql.DB, dataDir string, crypto *services.CryptoService, auth *services.AuthService) *AdminHandler {
	return &AdminHandler{db: db, dataDir: dataDir, crypto: crypto, auth: auth}
}

func (h *AdminHandler) FactoryReset(w http.ResponseWriter, r *http.Request) {
	// The reset clears audit_log and users, so resolve the actor now and
	// write the factory_reset row after the commit: it becomes the first
	// entry of the fresh log.
	actorID := GetUserID(r.Context())
	email := actorEmail(h.db, actorID)

	// Erasing everything needs the admin's password, not just a session.
	// 403, not 401: the client treats 401 as an expired session.
	var req struct {
		Password string `json:"password"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Password == "" || !h.auth.ValidatePassword(actorID, req.Password) {
		http.Error(w, "wrong password", http.StatusForbidden)
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	tables := []string{"certificate_versions", "certificates", "certificate_authorities", "share_links", "sessions", "pending_sessions", "backup_codes", "ca_permissions", "password_resets", "users", "audit_log"}
	for _, table := range tables {
		if _, err := tx.Exec("DELETE FROM " + table); err != nil {
			logger.Errorf("Failed to clear table %s: %v", table, err)
		}
	}

	if _, err := tx.Exec(`UPDATE settings SET
		organization = '',
		country = '',
		state = '',
		city = '',
		email = '',
		default_key_algorithm = 'rsa',
		default_rsa_key_size = 2048,
		default_ecdsa_curve = 'P-256',
		default_validity_days = 365,
		smtp_password = ''
		WHERE id = 1`); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	os.RemoveAll(filepath.Join(h.dataDir, "certificates"))
	os.Remove(filepath.Join(h.dataDir, "encryption.key"))
	os.Remove(filepath.Join(h.dataDir, "encryption.key.v1"))

	h.crypto.Reset()
	recordAuditAs(h.db, actorID, email, "factory_reset", "", "", "All data erased")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
