package services

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"time"

	"github.com/glcert/glcert/internal/models"
)

type CAService struct {
	DataDir string
	crypto  *CryptoService
}

func NewCAService(dataDir string, crypto *CryptoService) *CAService {
	return &CAService{DataDir: dataDir, crypto: crypto}
}

type CreateCAInput struct {
	Name           string `json:"name"`
	Description    string `json:"description"`
	CommonName     string `json:"commonName"`
	Organization   string `json:"organization"`
	Country        string `json:"country"`
	State          string `json:"state"`
	City           string `json:"city"`
	Email          string `json:"email"`
	KeyAlgorithm   string `json:"keyAlgorithm"`
	RSAKeySize     int    `json:"rsaKeySize"`
	ValidityDays   int    `json:"validityDays"`
}

func (s *CAService) GenerateCA(input CreateCAInput) (*models.CertificateAuthority, []byte, []byte, error) {
	if input.RSAKeySize == 0 {
		input.RSAKeySize = 2048
	}
	if input.ValidityDays == 0 {
		input.ValidityDays = 3650
	}

	privKey, err := rsa.GenerateKey(rand.Reader, input.RSAKeySize)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("generate private key: %w", err)
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("generate serial number: %w", err)
	}

	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName:   input.CommonName,
			Organization: []string{input.Organization},
			Country:      []string{input.Country},
			Province:     []string{input.State},
			Locality:     []string{input.City},
		},
		NotBefore:             now,
		NotAfter:              now.AddDate(0, 0, input.ValidityDays),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            1,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &privKey.PublicKey, privKey)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("create certificate: %w", err)
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privKey)})

	ca := &models.CertificateAuthority{
		Name:           input.Name,
		Description:    input.Description,
		Subject:        input.CommonName,
		CreatedAt:      now,
		ExpiresAt:      template.NotAfter,
		CurrentVersion: 1,
	}

	return ca, certPEM, keyPEM, nil
}

func (s *CAService) GetCAPath(name string, version int) string {
	return filepath.Join(s.DataDir, "certificates", "ca", name, fmt.Sprintf("v%d", version))
}

func (s *CAService) SaveCA(name string, version int, certPEM, keyPEM []byte) error {
	dir := s.GetCAPath(name, version)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create CA directory: %w", err)
	}

	certPath := filepath.Join(dir, "ca.crt")
	if err := os.WriteFile(certPath, certPEM, 0644); err != nil {
		return fmt.Errorf("write certificate: %w", err)
	}

	encrypted, err := s.crypto.Encrypt(keyPEM)
	if err != nil {
		return fmt.Errorf("encrypt private key: %w", err)
	}

	keyPath := filepath.Join(dir, "ca.key")
	if err := os.WriteFile(keyPath, encrypted, 0600); err != nil {
		return fmt.Errorf("write private key: %w", err)
	}

	return nil
}

func (s *CAService) ReadCA(name string, version int) ([]byte, []byte, error) {
	dir := s.GetCAPath(name, version)

	certPath := filepath.Join(dir, "ca.crt")
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, nil, fmt.Errorf("read certificate: %w", err)
	}

	keyPath := filepath.Join(dir, "ca.key")
	keyData, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, nil, fmt.Errorf("read private key: %w", err)
	}

	keyPEM, err := s.crypto.Decrypt(keyData)
	if err != nil {
		return nil, nil, fmt.Errorf("decrypt private key: %w", err)
	}

	return certPEM, keyPEM, nil
}

func (s *CAService) DeleteCA(name string) error {
	dir := filepath.Join(s.DataDir, "certificates", "ca", name)
	return os.RemoveAll(dir)
}
