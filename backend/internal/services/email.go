package services

import (
	"database/sql"
	"fmt"
	"net/smtp"
	"strings"
)

type EmailService struct {
	db     *sql.DB
	crypto *CryptoService
}

func NewEmailService(db *sql.DB, crypto *CryptoService) *EmailService {
	return &EmailService{db: db, crypto: crypto}
}

type smtpConfig struct {
	Host      string
	Port      int
	Username  string
	Password  string
	FromEmail string
	FromName  string
}

func (s *EmailService) getSMTPConfig() (*smtpConfig, error) {
	var cfg smtpConfig
	var encryptedPassword string
	err := s.db.QueryRow(
		"SELECT smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name FROM settings WHERE id = 1",
	).Scan(&cfg.Host, &cfg.Port, &cfg.Username, &encryptedPassword, &cfg.FromEmail, &cfg.FromName)
	if err != nil {
		return nil, err
	}

	if cfg.Host == "" {
		return nil, fmt.Errorf("SMTP not configured")
	}

	if encryptedPassword != "" {
		decrypted, err := s.crypto.Decrypt([]byte(encryptedPassword))
		if err != nil {
			return nil, fmt.Errorf("SMTP password unavailable: %w", err)
		}
		cfg.Password = string(decrypted)
	}

	return &cfg, nil
}

func (s *EmailService) SendEmail(to, subject, htmlBody string) error {
	cfg, err := s.getSMTPConfig()
	if err != nil {
		return err
	}

	from := cfg.FromEmail
	if cfg.FromName != "" {
		from = fmt.Sprintf("%s <%s>", cfg.FromName, cfg.FromEmail)
	}

	headers := make(map[string]string)
	headers["From"] = from
	headers["To"] = to
	headers["Subject"] = subject
	headers["MIME-Version"] = "1.0"
	headers["Content-Type"] = "text/html; charset=UTF-8"

	var msg strings.Builder
	for k, v := range headers {
		fmt.Fprintf(&msg, "%s: %s\r\n", k, v)
	}
	fmt.Fprintf(&msg, "\r\n%s", htmlBody)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)

	return smtp.SendMail(addr, auth, cfg.FromEmail, []string{to}, []byte(msg.String()))
}

func (s *EmailService) SendPasswordResetEmail(to, resetURL string) error {
	subject := "GLCert — Password Reset"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #0d9488;">GLCert — Password Reset</h2>
    <p>You requested a password reset for your GLCert admin account.</p>
    <p>Click the link below to set a new password. This link expires in 15 minutes.</p>
    <p style="margin: 20px 0;">
        <a href="%s" style="background-color: #0d9488; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Reset Password</a>
    </p>
    <p style="color: #666; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
</body>
</html>`, resetURL)
	return s.SendEmail(to, subject, body)
}

func (s *EmailService) SendExpirationAlertEmail(to string, certs, cas []expiringItem) error {
	subject := "GLCert — Certificate Expiration Alert"

	var certRows string
	for _, c := range certs {
		certRows += fmt.Sprintf("<tr><td>%s</td><td>%s</td><td>%s</td><td>%d days</td></tr>",
			c.Name, c.Type, c.ExpiresAt.Format("2006-01-02"), c.DaysLeft)
	}

	var caRows string
	for _, ca := range cas {
		caRows += fmt.Sprintf("<tr><td>%s</td><td>%s</td><td>%d days</td></tr>",
			ca.Name, ca.ExpiresAt.Format("2006-01-02"), ca.DaysLeft)
	}

	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #0d9488;">GLCert — Certificate Expiration Alert</h2>
    <p>The following certificates are expiring soon:</p>
    %s
    %s
</body>
</html>`, certRows, caRows)

	return s.SendEmail(to, subject, body)
}

func (s *EmailService) SendTestEmail(to string) error {
	subject := "GLCert — Test Email"
	body := `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 20px;">
    <h2 style="color: #0d9488;">GLCert — Test Email</h2>
    <p>If you received this, your SMTP configuration is working correctly.</p>
</body></html>`
	return s.SendEmail(to, subject, body)
}
