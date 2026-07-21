package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/glcert/glcert/internal/logger"
	"github.com/glcert/glcert/internal/models"
	"github.com/glcert/glcert/internal/services"
)

type Handler struct {
	db     *sql.DB
	crypto *services.CryptoService
}

func New(db *sql.DB, crypto *services.CryptoService) *Handler {
	return &Handler{db: db, crypto: crypto}
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
			notification_threshold_days,
			COALESCE(smtp_host, '') as smtp_host,
			COALESCE(smtp_port, 587) as smtp_port,
			COALESCE(smtp_username, '') as smtp_username,
			COALESCE(smtp_from_email, '') as smtp_from_email,
			COALESCE(smtp_from_name, 'GLCert') as smtp_from_name,
			COALESCE(email_notifications_enabled, 0) as email_notifications_enabled,
			created_at, updated_at
		FROM settings WHERE id = 1
	`).Scan(
		&s.ID, &s.Organization, &s.Country, &s.State, &s.City, &s.Email,
		&s.DefaultKeyAlgorithm, &s.DefaultRSAKeySize, &s.DefaultECDSACurve,
		&s.DefaultValidityDays, &s.NotificationsEnabled, &s.NotificationWebhookURL,
		&s.NotificationThresholdDays,
		&s.SMTPHost, &s.SMTPPort, &s.SMTPUsername, &s.SMTPFromEmail, &s.SMTPFromName, &s.EmailNotificationsEnabled,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s)
}

func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		models.Settings
		SMTPPassword string `json:"smtpPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s := body.Settings

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
			smtp_host = ?,
			smtp_port = ?,
			smtp_username = ?,
			smtp_from_email = ?,
			smtp_from_name = ?,
			email_notifications_enabled = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = 1
	`,
		s.Organization, s.Country, s.State, s.City, s.Email,
		s.DefaultKeyAlgorithm, s.DefaultRSAKeySize, s.DefaultECDSACurve,
		s.DefaultValidityDays, s.NotificationsEnabled, s.NotificationWebhookURL,
		s.NotificationThresholdDays,
		s.SMTPHost, s.SMTPPort, s.SMTPUsername, s.SMTPFromEmail, s.SMTPFromName, s.EmailNotificationsEnabled,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if body.SMTPPassword != "" {
		if h.crypto.IsEnabled() {
			encrypted, err := h.crypto.Encrypt([]byte(body.SMTPPassword))
			if err == nil {
				h.db.Exec("UPDATE settings SET smtp_password = ? WHERE id = 1", string(encrypted))
			} else {
				logger.Errorf("Failed to encrypt SMTP password: %v", err)
			}
		} else {
			h.db.Exec("UPDATE settings SET smtp_password = ? WHERE id = 1", body.SMTPPassword)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s)
}
