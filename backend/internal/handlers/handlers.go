package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/glcert/glcert/internal/models"
)

type Handler struct {
	db *sql.DB
}

func New(db *sql.DB) *Handler {
	return &Handler{db: db}
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

type DashboardStats struct {
	CACount         int `json:"caCount"`
	CertificateCount int `json:"certificateCount"`
	ExpiringSoon    int `json:"expiringSoon"`
	Expired         int `json:"expired"`
}

func (h *Handler) GetDashboardStats(w http.ResponseWriter, r *http.Request) {
	var stats DashboardStats

	h.db.QueryRow("SELECT COUNT(*) FROM certificate_authorities").Scan(&stats.CACount)
	h.db.QueryRow("SELECT COUNT(*) FROM certificates").Scan(&stats.CertificateCount)

	thirtyDays := time.Now().AddDate(0, 0, 30)
	now := time.Now()

	h.db.QueryRow(`
		SELECT COUNT(*) FROM certificate_versions cv
		JOIN certificates c ON cv.certificate_id = c.id
		WHERE cv.version = c.current_version
			AND cv.expires_at > ? AND cv.expires_at <= ?
	`, now, thirtyDays).Scan(&stats.ExpiringSoon)

	h.db.QueryRow(`
		SELECT COUNT(*) FROM certificate_versions cv
		JOIN certificates c ON cv.certificate_id = c.id
		WHERE cv.version = c.current_version
			AND cv.expires_at <= ?
	`, now).Scan(&stats.Expired)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	var s models.Settings
	err := h.db.QueryRow(`
		SELECT id, organization, country, state, city, email,
			default_key_algorithm, default_rsa_key_size, default_ecdsa_curve,
			default_validity_days, notifications_enabled, notification_webhook_url,
			notification_threshold_days, created_at, updated_at
		FROM settings WHERE id = 1
	`).Scan(
		&s.ID, &s.Organization, &s.Country, &s.State, &s.City, &s.Email,
		&s.DefaultKeyAlgorithm, &s.DefaultRSAKeySize, &s.DefaultECDSACurve,
		&s.DefaultValidityDays, &s.NotificationsEnabled, &s.NotificationWebhookURL,
		&s.NotificationThresholdDays, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s)
}

func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var s models.Settings
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	_, err := h.db.Exec(`
		UPDATE settings SET
			organization = ?,
			country = ?,
			state = ?,
			city = ?,
			email = ?,
			default_key_algorithm = ?,
			default_rsa_key_size = ?,
			default_ecdsa_curve = ?,
			default_validity_days = ?,
			notifications_enabled = ?,
			notification_webhook_url = ?,
			notification_threshold_days = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = 1
	`,
		s.Organization, s.Country, s.State, s.City, s.Email,
		s.DefaultKeyAlgorithm, s.DefaultRSAKeySize, s.DefaultECDSACurve,
		s.DefaultValidityDays, s.NotificationsEnabled, s.NotificationWebhookURL,
		s.NotificationThresholdDays,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s)
}
