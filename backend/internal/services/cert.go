package services

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/gugabguerra/glcert/internal/models"
)

type CertService struct {
	DataDir string
	crypto  *CryptoService
}

func NewCertService(dataDir string, crypto *CryptoService) *CertService {
	return &CertService{DataDir: dataDir, crypto: crypto}
}

type CreateCertInput struct {
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	CommonName        string   `json:"commonName"`
	Type              string   `json:"type"` // server, client, selfsigned
	CertificateAuthID *string  `json:"certificateAuthorityId"`
	DNSNames          []string `json:"dnsNames"`
	IPAddresses       []string `json:"ipAddresses"`
	Organization      string   `json:"organization"`
	Country           string   `json:"country"`
	State             string   `json:"state"`
	City              string   `json:"city"`
	KeyAlgorithm      string   `json:"keyAlgorithm"`
	RSAKeySize        int      `json:"rsaKeySize"`
	ECDSACurve        string   `json:"ecdsaCurve"`
	ValidityDays      int      `json:"validityDays"`
}

type CertResult struct {
	Cert    *models.Certificate
	CertPEM []byte
	KeyPEM  []byte
	CAPem   []byte
}

func (s *CertService) GenerateCert(input CreateCertInput, caCertPEM, caKeyPEM []byte) (*CertResult, error) {
	if input.ValidityDays == 0 {
		input.ValidityDays = 365
	}

	privKey, err := generateKey(KeyParams{
		Algorithm:  input.KeyAlgorithm,
		RSAKeySize: input.RSAKeySize,
		ECDSACurve: input.ECDSACurve,
	})
	if err != nil {
		return nil, fmt.Errorf("generate private key: %w", err)
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("generate serial number: %w", err)
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
		NotBefore: now,
		NotAfter:  now.AddDate(0, 0, input.ValidityDays),
	}

	// Add SANs
	for _, dns := range input.DNSNames {
		template.DNSNames = append(template.DNSNames, dns)
	}
	for _, ipStr := range input.IPAddresses {
		ip := net.ParseIP(ipStr)
		if ip != nil {
			template.IPAddresses = append(template.IPAddresses, ip)
		}
	}

	// Set key usage based on type
	switch input.Type {
	case "server":
		template.KeyUsage = x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment
		template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
	case "client":
		template.KeyUsage = x509.KeyUsageDigitalSignature
		template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}
	case "serverclient":
		template.KeyUsage = x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment
		template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth}
	case "selfsigned":
		template.KeyUsage = x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment
		template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth}
	}
	template.KeyUsage = keyUsageFor(privKey, template.KeyUsage)

	var certDER []byte
	var certPEM []byte
	var keyPEM []byte

	if input.Type == "selfsigned" {
		// Self-signed: sign with own key
		certDER, err = x509.CreateCertificate(rand.Reader, template, template, privKey.Public(), privKey)
		if err != nil {
			return nil, fmt.Errorf("create certificate: %w", err)
		}
	} else {
		// Sign with CA
		if caCertPEM == nil || caKeyPEM == nil {
			return nil, fmt.Errorf("CA certificate and key are required")
		}

		caCertBlock, _ := pem.Decode(caCertPEM)
		if caCertBlock == nil {
			return nil, fmt.Errorf("decode CA certificate PEM")
		}
		caCert, err := x509.ParseCertificate(caCertBlock.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse CA certificate: %w", err)
		}

		parsedCAKey, err := parsePrivateKeyWithPassphrase(caKeyPEM, nil)
		if err != nil {
			return nil, fmt.Errorf("parse CA key: %w", err)
		}
		caKey, err := signerFromKey(parsedCAKey)
		if err != nil {
			return nil, fmt.Errorf("CA key: %w", err)
		}

		certDER, err = x509.CreateCertificate(rand.Reader, template, caCert, privKey.Public(), caKey)
		if err != nil {
			return nil, fmt.Errorf("create certificate: %w", err)
		}
	}

	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyPEM, err = encodePrivateKeyPEM(privKey)
	if err != nil {
		return nil, err
	}

	cert := &models.Certificate{
		Name:                   input.Name,
		Description:            input.Description,
		Type:                   input.Type,
		CertificateAuthorityID: input.CertificateAuthID,
		CreatedAt:              now,
		UpdatedAt:              now,
	}

	return &CertResult{
		Cert:    cert,
		CertPEM: certPEM,
		KeyPEM:  keyPEM,
		CAPem:   caCertPEM,
	}, nil
}

func (s *CertService) GetCertPath(certType, name string, version int) string {
	return filepath.Join(s.DataDir, "certificates", certType, name, fmt.Sprintf("v%d", version))
}

func (s *CertService) SaveCert(certType, name string, version int, certPEM, keyPEM, caPEM []byte) error {
	dir := s.GetCertPath(certType, name, version)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create certificate directory: %w", err)
	}

	certPath := filepath.Join(dir, "cert.pem")
	if err := os.WriteFile(certPath, certPEM, 0644); err != nil {
		return fmt.Errorf("write certificate: %w", err)
	}

	encrypted, err := s.crypto.Encrypt(keyPEM)
	if err != nil {
		return fmt.Errorf("encrypt private key: %w", err)
	}

	keyPath := filepath.Join(dir, "key.pem")
	if err := os.WriteFile(keyPath, encrypted, 0600); err != nil {
		return fmt.Errorf("write private key: %w", err)
	}

	if caPEM != nil {
		caPath := filepath.Join(dir, "ca.pem")
		if err := os.WriteFile(caPath, caPEM, 0644); err != nil {
			return fmt.Errorf("write CA certificate: %w", err)
		}
	}

	return nil
}

func (s *CertService) ReadCert(certType, name string, version int) ([]byte, []byte, []byte, error) {
	dir := s.GetCertPath(certType, name, version)

	certPath := filepath.Join(dir, "cert.pem")
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("read certificate: %w", err)
	}

	keyPath := filepath.Join(dir, "key.pem")
	keyData, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("read private key: %w", err)
	}

	keyPEM, err := s.crypto.Decrypt(keyData)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decrypt private key: %w", err)
	}

	var caPEM []byte
	caPath := filepath.Join(dir, "ca.pem")
	caPEM, _ = os.ReadFile(caPath) // CA file is optional for self-signed

	return certPEM, keyPEM, caPEM, nil
}

func (s *CertService) DeleteCert(certType, name string) error {
	dir := filepath.Join(s.DataDir, "certificates", certType, name)
	return os.RemoveAll(dir)
}

func (s *CertService) DeleteVersion(certType, name string, version int) error {
	dir := s.GetCertPath(certType, name, version)
	return os.RemoveAll(dir)
}

type ImportCertResult struct {
	Type         string
	CommonName   string
	DNSNames     []string
	IPAddresses  []string
	SerialNumber string
	Fingerprint  string
	SigAlgo      string
	PubKeyAlgo   string
	ExpiresAt    time.Time
}

func (s *CertService) ImportCert(certPEM, keyPEM []byte, passphrase string) (*ImportCertResult, *x509.Certificate, error) {
	certBlock, _ := pem.Decode(certPEM)
	if certBlock == nil {
		return nil, nil, fmt.Errorf("failed to decode certificate PEM")
	}

	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse certificate: %w", err)
	}

	if cert.IsCA {
		return nil, nil, fmt.Errorf("certificate is a CA — use Import CA instead")
	}

	if len(keyPEM) > 0 {
		privKey, err := parsePrivateKeyWithPassphrase(keyPEM, []byte(passphrase))
		if err != nil {
			return nil, nil, fmt.Errorf("private key: %w", err)
		}

		if cert.PublicKeyAlgorithm == x509.RSA {
			rsaKey, ok := privKey.(*rsa.PrivateKey)
			if !ok {
				return nil, nil, fmt.Errorf("private key type does not match certificate")
			}
			pubKey, ok := cert.PublicKey.(*rsa.PublicKey)
			if !ok || pubKey.N.Cmp(rsaKey.PublicKey.N) != 0 || pubKey.E != rsaKey.PublicKey.E {
				return nil, nil, fmt.Errorf("private key does not match certificate public key")
			}
		} else if cert.PublicKeyAlgorithm == x509.ECDSA {
			ecKey, ok := privKey.(*ecdsa.PrivateKey)
			if !ok {
				return nil, nil, fmt.Errorf("private key type does not match certificate")
			}
			pubKey, ok := cert.PublicKey.(*ecdsa.PublicKey)
			if !ok || !ecKey.PublicKey.Equal(pubKey) {
				return nil, nil, fmt.Errorf("private key does not match certificate public key")
			}
		}
	}

	certType := detectCertType(cert)

	result := &ImportCertResult{
		Type:         certType,
		CommonName:   cert.Subject.CommonName,
		DNSNames:     cert.DNSNames,
		SerialNumber: cert.SerialNumber.String(),
		Fingerprint:  fmt.Sprintf("%x", cert.SerialNumber),
		SigAlgo:      cert.SignatureAlgorithm.String(),
		PubKeyAlgo:   cert.PublicKeyAlgorithm.String(),
		ExpiresAt:    cert.NotAfter,
	}

	for _, ip := range cert.IPAddresses {
		result.IPAddresses = append(result.IPAddresses, ip.String())
	}

	return result, cert, nil
}

func detectCertType(cert *x509.Certificate) string {
	hasServer := false
	hasClient := false
	for _, usage := range cert.ExtKeyUsage {
		if usage == x509.ExtKeyUsageServerAuth {
			hasServer = true
		}
		if usage == x509.ExtKeyUsageClientAuth {
			hasClient = true
		}
	}
	if hasServer && hasClient {
		return "serverclient"
	}
	if hasClient {
		return "client"
	}
	return "server"
}
