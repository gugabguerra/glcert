package services

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/nicholas-fedor/shoutrrr"
)

type NotificationService struct {
	db    *sql.DB
	email *EmailService
}

type expiringItem struct {
	Name      string
	Type      string
	ExpiresAt time.Time
	DaysLeft  int
}

func NewNotificationService(db *sql.DB, email *EmailService) *NotificationService {
	return &NotificationService{db: db, email: email}
}

func (s *NotificationService) CheckAndNotify() {
	var enabled bool
	var webhookURL string
	var thresholdDays int

	err := s.db.QueryRow(
		"SELECT notifications_enabled, notification_webhook_url, notification_threshold_days FROM settings WHERE id = 1",
	).Scan(&enabled, &webhookURL, &thresholdDays)
	if err != nil {
		logger.Errorf("Failed to read notification settings: %v", err)
		return
	}

	if !enabled || webhookURL == "" {
		return
	}

	threshold := time.Now().AddDate(0, 0, thresholdDays)

	var certs []expiringItem
	var cas []expiringItem

	rows, err := s.db.Query(`
		SELECT c.name, c.type, cv.expires_at
		FROM certificate_versions cv
		JOIN certificates c ON cv.certificate_id = c.id
		WHERE cv.version = c.current_version
		  AND cv.expires_at > ?
		  AND cv.expires_at <= ?
		  AND (c.last_notified_at IS NULL OR c.last_notified_at < datetime('now', '-1 day'))
	`, time.Now(), threshold)
	if err != nil {
		logger.Errorf("Failed to query expiring certificates: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var item expiringItem
		if err := rows.Scan(&item.Name, &item.Type, &item.ExpiresAt); err != nil {
			continue
		}
		item.DaysLeft = int(time.Until(item.ExpiresAt).Hours() / 24)
		certs = append(certs, item)
	}

	rows2, err := s.db.Query(`
		SELECT name, expires_at
		FROM certificate_authorities
		WHERE expires_at > ?
		  AND expires_at <= ?
		  AND (last_notified_at IS NULL OR last_notified_at < datetime('now', '-1 day'))
	`, time.Now(), threshold)
	if err != nil {
		logger.Errorf("Failed to query expiring CAs: %v", err)
		return
	}
	defer rows2.Close()

	for rows2.Next() {
		var item expiringItem
		item.Type = "CA"
		if err := rows2.Scan(&item.Name, &item.ExpiresAt); err != nil {
			continue
		}
		item.DaysLeft = int(time.Until(item.ExpiresAt).Hours() / 24)
		cas = append(cas, item)
	}

	if len(certs) == 0 && len(cas) == 0 {
		return
	}

	msg := s.buildMessage(certs, cas)

	err = shoutrrr.Send(webhookURL, msg)
	if err != nil {
		logger.Errorf("Notification send error: %v", err)
		return
	}

	now := time.Now().Format(time.RFC3339)
	for _, c := range certs {
		s.db.Exec("UPDATE certificates SET last_notified_at = ? WHERE name = ? AND type = ?", now, c.Name, c.Type)
	}
	for _, ca := range cas {
		s.db.Exec("UPDATE certificate_authorities SET last_notified_at = ? WHERE name = ?", now, ca.Name)
	}

	logger.Infof("Sent alert: %d certificates, %d CAs expiring", len(certs), len(cas))

	// Send email notifications if enabled
	var emailEnabled bool
	var adminEmail string
	s.db.QueryRow("SELECT email_notifications_enabled FROM settings WHERE id = 1").Scan(&emailEnabled)
	if emailEnabled && s.email != nil {
		emailErr := s.db.QueryRow("SELECT email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").Scan(&adminEmail)
		if emailErr == nil && adminEmail != "" {
			if err := s.email.SendExpirationAlertEmail(adminEmail, certs, cas); err != nil {
				logger.Errorf("Failed to send expiration email: %v", err)
			} else {
				logger.Infof("Sent expiration email to %s", adminEmail)
			}
		}
	}
}

func (s *NotificationService) SendTestNotification(webhookURL string) error {
	msg := "GLCert Test Notification\n\nThis is a test message from your GLCert instance. If you see this, your webhook is configured correctly."
	return shoutrrr.Send(webhookURL, msg)
}

func (s *NotificationService) SendTestEmail(email string) error {
	return s.email.SendTestEmail(email)
}

func (s *NotificationService) buildMessage(certs, cas []expiringItem) string {
	msg := "**GLCert — Certificate Expiration Alert**\n\n"

	if len(certs) > 0 {
		msg += "**Certificates expiring soon:**\n"
		for _, c := range certs {
			msg += fmt.Sprintf("• %s (%s) — expires %s (in %d days)\n", c.Name, c.Type, c.ExpiresAt.Format("2006-01-02"), c.DaysLeft)
		}
	}

	if len(cas) > 0 {
		if len(certs) > 0 {
			msg += "\n"
		}
		msg += "**CAs expiring soon:**\n"
		for _, ca := range cas {
			msg += fmt.Sprintf("• %s — expires %s (in %d days)\n", ca.Name, ca.ExpiresAt.Format("2006-01-02"), ca.DaysLeft)
		}
	}

	return msg
}
