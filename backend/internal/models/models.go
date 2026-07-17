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
	DefaultValidityDays int       `json:"defaultValidityDays"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type CertificateAuthority struct {
	ID             int64     `json:"id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	Subject        string    `json:"subject"`
	CreatedAt      time.Time `json:"createdAt"`
	ExpiresAt      time.Time `json:"expiresAt"`
	CurrentVersion int       `json:"currentVersion"`
}

type Certificate struct {
	ID                    int64     `json:"id"`
	Name                  string    `json:"name"`
	Description           string    `json:"description"`
	Type                  string    `json:"type"` // server, client, selfsigned
	CertificateAuthorityID *int64   `json:"certificateAuthorityId"`
	CurrentVersion        int       `json:"currentVersion"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type CertificateVersion struct {
	ID                 int64     `json:"id"`
	CertificateID      int64     `json:"certificateId"`
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
