package models

import "time"

type Settings struct {
	ID                  int64     `json:"id"`
	Organization        string    `json:"organization"`
	Country             string    `json:"country"`
	State               string    `json:"state"`
	City                string    `json:"city"`
	Email               string    `json:"email"`
	DefaultKeyAlgorithm string    `json:"defaultKeyAlgorithm"`
	DefaultRSAKeySize   int       `json:"defaultRSAKeySize"`
	DefaultECDSACurve   string    `json:"defaultECDSACurve"`
	DefaultValidityDays      int       `json:"defaultValidityDays"`
	NotificationsEnabled      bool      `json:"notificationsEnabled"`
	NotificationWebhookURL    string    `json:"notificationWebhookUrl"`
	NotificationThresholdDays int       `json:"notificationThresholdDays"`
	SMTPHost                  string    `json:"smtpHost"`
	SMTPPort                  int       `json:"smtpPort"`
	SMTPUsername              string    `json:"smtpUsername"`
	SMTPFromEmail             string    `json:"smtpFromEmail"`
	SMTPFromName              string    `json:"smtpFromName"`
	EmailNotificationsEnabled bool      `json:"emailNotificationsEnabled"`
	CreatedAt                time.Time `json:"createdAt"`
	UpdatedAt                time.Time `json:"updatedAt"`
}

type CertificateAuthority struct {
	ID                       string    `json:"id"`
	Name                     string    `json:"name"`
	Description              string    `json:"description"`
	Subject                  string    `json:"subject"`
	CreatedAt                time.Time `json:"createdAt"`
	ExpiresAt                time.Time `json:"expiresAt"`
	CurrentVersion           int       `json:"currentVersion"`
	KeyEncryptedPassphrase   []byte    `json:"-"`
}

type Certificate struct {
	ID                    string    `json:"id"`
	Name                  string    `json:"name"`
	Description           string    `json:"description"`
	Type                  string    `json:"type"` // server, client, selfsigned
	CertificateAuthorityID *string  `json:"certificateAuthorityId"`
	CurrentVersion        int       `json:"currentVersion"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type CertificateVersion struct {
	ID                 string    `json:"id"`
	CertificateID      string    `json:"certificateId"`
	Version            int       `json:"version"`
	StoragePath        string    `json:"storagePath"`
	SerialNumber       string    `json:"serialNumber"`
	Fingerprint        string    `json:"fingerprint"`
	SignatureAlgorithm string    `json:"signatureAlgorithm"`
	PublicKeyAlgorithm string    `json:"publicKeyAlgorithm"`
	CreatedAt          time.Time `json:"createdAt"`
	ExpiresAt          time.Time `json:"expiresAt"`
	Revoked            bool      `json:"revoked"`
}
