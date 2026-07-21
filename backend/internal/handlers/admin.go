package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/glcert/glcert/internal/logger"
	"github.com/glcert/glcert/internal/services"
)

type AdminHandler struct {
	db      *sql.DB
	dataDir string
	crypto  *services.CryptoService
}

func NewAdminHandler(db *sql.DB, dataDir string, crypto *services.CryptoService) *AdminHandler {
	return &AdminHandler{db: db, dataDir: dataDir, crypto: crypto}
}

func (h *AdminHandler) FactoryReset(w http.ResponseWriter, r *http.Request) {
	tx, err := h.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	tables := []string{"certificate_versions", "certificates", "certificate_authorities", "sessions", "pending_sessions", "backup_codes", "ca_permissions", "password_resets", "users", "audit_log"}
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
		default_validity_days = 365
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

	h.crypto.Reset()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
