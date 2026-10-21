package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/gugabguerra/glcert/internal/models"
	"github.com/gugabguerra/glcert/internal/services"
)

type Handler struct {
	db     *sql.DB
	crypto *services.CryptoService
	auth   *services.AuthService
}

func New(db *sql.DB, crypto *services.CryptoService, auth *services.AuthService) *Handler {
	return &Handler{db: db, crypto: crypto, auth: auth}
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

type DashboardStats struct {
	CACount          int `json:"caCount"`
	CertificateCount int `json:"certificateCount"`
	ExpiringSoon     int `json:"expiringSoon"`
	Expired          int `json:"expired"`
}

// dashboardScope returns SQL conditions restricting the dashboard counts to
// the CAs the user may access, mirroring the CA and certificate list
// handlers: CAs by id, certificates by issuing CA or unassigned. Admins get
// "1 = 1" (no filter). A permission lookup error is returned so the caller
// fails closed instead of reporting global totals.
func (h *Handler) dashboardScope(userID string) (caCond, certCond string, args []interface{}, err error) {
	if userID == "" {
		return "1 = 0", "1 = 0", nil, nil
	}
	ids, err := h.auth.GetAccessibleCAIDs(userID)
	if err != nil {
		return "", "", nil, err
	}
	if ids == nil {
		return "1 = 1", "1 = 1", nil, nil
	}
	if len(ids) == 0 {
		return "1 = 0", "c.certificate_authority_id IS NULL", nil, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?, ", len(ids)), ", ")
	args = make([]interface{}, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return "id IN (" + placeholders + ")",
		"(c.certificate_authority_id IN (" + placeholders + ") OR c.certificate_authority_id IS NULL)",
		args, nil
}

func (h *Handler) GetDashboardStats(w http.ResponseWriter, r *http.Request) {
	var stats DashboardStats

	caCond, certCond, args, err := h.dashboardScope(GetUserID(r.Context()))
	if err != nil {
		logger.Errorf("dashboard: resolve accessible CAs: %v", err)
		http.Error(w, "Failed to load dashboard", http.StatusInternalServerError)
		return
	}

	now := time.Now()
	thirtyDays := now.AddDate(0, 0, 30)

	queries := []struct {
		dest  *int
		query string
		args  []interface{}
	}{
		{&stats.CACount, "SELECT COUNT(*) FROM certificate_authorities WHERE " + caCond, args},
		{&stats.CertificateCount, "SELECT COUNT(*) FROM certificates c WHERE " + certCond, args},
		{&stats.ExpiringSoon, `
			SELECT COUNT(*) FROM certificate_versions cv
			JOIN certificates c ON cv.certificate_id = c.id
			WHERE cv.version = c.current_version
				AND cv.expires_at > ? AND cv.expires_at <= ?
				AND ` + certCond, append([]interface{}{now, thirtyDays}, args...)},
		{&stats.Expired, `
			SELECT COUNT(*) FROM certificate_versions cv
			JOIN certificates c ON cv.certificate_id = c.id
			WHERE cv.version = c.current_version
				AND cv.expires_at <= ?
				AND ` + certCond, append([]interface{}{now}, args...)},
	}
	for _, q := range queries {
		if err := h.db.QueryRow(q.query, q.args...).Scan(q.dest); err != nil {
			logger.Errorf("dashboard: count query: %v", err)
			http.Error(w, "Failed to load dashboard", http.StatusInternalServerError)
			return
		}
	}

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
	recordAudit(h.db, r, "settings.update", "settings", "1", "Settings updated")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s)
}
