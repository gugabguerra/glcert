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
	"os"
	"path/filepath"
	"time"

	"github.com/gugabguerra/glcert/internal/models"
	pkcs8 "github.com/youmark/pkcs8"
)

type CAService struct {
	DataDir string
	crypto  *CryptoService
}

func NewCAService(dataDir string, crypto *CryptoService) *CAService {
	return &CAService{DataDir: dataDir, crypto: crypto}
}

type CreateCAInput struct {
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	CommonName   string  `json:"commonName"`
	Organization string  `json:"organization"`
	Country      string  `json:"country"`
	State        string  `json:"state"`
	City         string  `json:"city"`
	Email        string  `json:"email"`
	KeyAlgorithm string  `json:"keyAlgorithm"`
	RSAKeySize   int     `json:"rsaKeySize"`
	ECDSACurve   string  `json:"ecdsaCurve"`
	ValidityDays int     `json:"validityDays"`
	ParentCAID   *string `json:"parentCaId"`
}

// GenerateCA creates a new CA certificate. If ParentCAID is set, it creates an
// intermediate CA signed by the parent. Otherwise, it creates a self-signed root CA.
// Returns the model, cert PEM (chain for intermediates), and key PEM.
func (s *CAService) GenerateCA(input CreateCAInput, parentCertPEM, parentKeyPEM []byte) (*models.CertificateAuthority, []byte, []byte, error) {
	if input.ValidityDays == 0 {
		input.ValidityDays = 1825
	}

	privKey, err := generateKey(KeyParams{
		Algorithm:  input.KeyAlgorithm,
		RSAKeySize: input.RSAKeySize,
		ECDSACurve: input.ECDSACurve,
	})
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
	}

	var certDER []byte
	var certPEM []byte
	isIntermediate := input.ParentCAID != nil && parentCertPEM != nil && parentKeyPEM != nil

	if isIntermediate {
		// Intermediate CA: signed by parent, MaxPathLen=0 (can only sign end-entity certs)
		template.MaxPathLen = 0

		parentCertBlock, _ := pem.Decode(parentCertPEM)
		if parentCertBlock == nil {
			return nil, nil, nil, fmt.Errorf("decode parent CA certificate PEM")
		}
		parentCert, err := x509.ParseCertificate(parentCertBlock.Bytes)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("parse parent CA certificate: %w", err)
		}

		parentKey, err := parsePrivateKeyWithPassphrase(parentKeyPEM, nil)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("parse parent CA key: %w", err)
		}

		signingKey, err := signerFromKey(parentKey)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("parent CA key: %w", err)
		}

		certDER, err = x509.CreateCertificate(rand.Reader, template, parentCert, privKey.Public(), signingKey)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("create intermediate certificate: %w", err)
		}

		// Build chain: intermediate cert + parent cert (full chain up to root)
		intermediatePEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
		certPEM = append(intermediatePEM, parentCertPEM...)
	} else {
		// Root CA: self-signed, MaxPathLen=1
		template.MaxPathLen = 1

		certDER, err = x509.CreateCertificate(rand.Reader, template, template, privKey.Public(), privKey)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("create root certificate: %w", err)
		}
		certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	}

	keyPEM, err := encodePrivateKeyPEM(privKey)
	if err != nil {
		return nil, nil, nil, err
	}

	ca := &models.CertificateAuthority{
		Name:           input.Name,
		Description:    input.Description,
		Subject:        input.CommonName,
		CreatedAt:      now,
		ExpiresAt:      template.NotAfter,
		CurrentVersion: 1,
		ParentCAID:     input.ParentCAID,
	}

	return ca, certPEM, keyPEM, nil
}

func (s *CAService) GetCAPath(name string, version int) string {
	return filepath.Join(s.DataDir, "certificates", "ca", name, fmt.Sprintf("v%d", version))
}

func parsePrivateKeyWithPassphrase(pemData, passphrase []byte) (interface{}, error) {
	block, _ := pem.Decode(pemData)
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block")
	}

	switch {
	case block.Type == "ENCRYPTED PRIVATE KEY":
		key, err := pkcs8.ParsePKCS8PrivateKey(block.Bytes, passphrase)
		if err != nil {
			return nil, fmt.Errorf("decrypt encrypted private key: %w", err)
		}
		return key, nil

	case block.Headers["Proc-Type"] == "4,ENCRYPTED":
		der, err := x509.DecryptPEMBlock(block, passphrase) //nolint:staticcheck
		if err != nil {
			return nil, fmt.Errorf("decrypt PEM key: %w", err)
		}
		key, err := x509.ParsePKCS8PrivateKey(der)
		if err != nil {
			return nil, fmt.Errorf("parse decrypted key: %w", err)
		}
		return key, nil

	case block.Type == "PRIVATE KEY":
		return x509.ParsePKCS8PrivateKey(block.Bytes)

	case block.Type == "RSA PRIVATE KEY":
		return x509.ParsePKCS1PrivateKey(block.Bytes)

	case block.Type == "EC PRIVATE KEY":
		return x509.ParseECPrivateKey(block.Bytes)

	default:
		return nil, fmt.Errorf("unsupported key type: %s", block.Type)
	}
}

func isPassphraseProtectedPEM(pemData []byte) bool {
	block, _ := pem.Decode(pemData)
	if block == nil {
		return false
	}
	return block.Type == "ENCRYPTED PRIVATE KEY" ||
		block.Headers["Proc-Type"] == "4,ENCRYPTED"
}

func EncryptPEMWithPassphrase(keyPEM []byte, passphrase string) ([]byte, error) {
	block, _ := pem.Decode(keyPEM)
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block")
	}

	var privKey interface{}
	var err error

	switch block.Type {
	case "RSA PRIVATE KEY":
		privKey, err = x509.ParsePKCS1PrivateKey(block.Bytes)
	case "EC PRIVATE KEY":
		privKey, err = x509.ParseECPrivateKey(block.Bytes)
	case "PRIVATE KEY":
		privKey, err = x509.ParsePKCS8PrivateKey(block.Bytes)
	default:
		return nil, fmt.Errorf("unsupported key type: %s", block.Type)
	}
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}

	encryptedDER, err := pkcs8.MarshalPrivateKey(privKey, []byte(passphrase), nil)
	if err != nil {
		return nil, fmt.Errorf("encrypt private key: %w", err)
	}

	return pem.EncodeToMemory(&pem.Block{Type: "ENCRYPTED PRIVATE KEY", Bytes: encryptedDER}), nil
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

	if len(keyPEM) > 0 {
		encrypted, err := s.crypto.Encrypt(keyPEM)
		if err != nil {
			return fmt.Errorf("encrypt private key: %w", err)
		}

		keyPath := filepath.Join(dir, "ca.key")
		if err := os.WriteFile(keyPath, encrypted, 0600); err != nil {
			return fmt.Errorf("write private key: %w", err)
		}
	}

	return nil
}

func (s *CAService) ReadCA(name string, version int, passphrase string) ([]byte, []byte, error) {
	dir := s.GetCAPath(name, version)

	certPath := filepath.Join(dir, "ca.crt")
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, nil, fmt.Errorf("read certificate: %w", err)
	}

	var keyPEM []byte
	keyPath := filepath.Join(dir, "ca.key")
	keyData, err := os.ReadFile(keyPath)
	if err == nil {
		decrypted, err := s.crypto.Decrypt(keyData)
		if err != nil {
			return nil, nil, fmt.Errorf("decrypt private key: %w", err)
		}
		keyPEM = decrypted
	}

	if passphrase != "" && len(keyPEM) > 0 && isPassphraseProtectedPEM(keyPEM) {
		key, err := parsePrivateKeyWithPassphrase(keyPEM, []byte(passphrase))
		if err != nil {
			return nil, nil, fmt.Errorf("decrypt passphrase-protected key: %w", err)
		}
		keyPEM, err = encodePrivateKeyPEM(key)
		if err != nil {
			return nil, nil, fmt.Errorf("re-encode key: %w", err)
		}
	}

	return certPEM, keyPEM, nil
}

func (s *CAService) DeleteCA(name string) error {
	dir := filepath.Join(s.DataDir, "certificates", "ca", name)
	return os.RemoveAll(dir)
}

func (s *CAService) ImportCA(name, description string, certPEM, keyPEM []byte, passphrase string) (*models.CertificateAuthority, error) {
	certBlock, _ := pem.Decode(certPEM)
	if certBlock == nil {
		return nil, fmt.Errorf("failed to decode certificate PEM")
	}

	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse certificate: %w", err)
	}

	if !cert.IsCA || !cert.BasicConstraintsValid {
		return nil, fmt.Errorf("certificate is not a CA (missing CA basic constraints)")
	}

	if len(keyPEM) > 0 {
		privKey, err := parsePrivateKeyWithPassphrase(keyPEM, []byte(passphrase))
		if err != nil {
			return nil, fmt.Errorf("private key: %w", err)
		}

		if cert.PublicKeyAlgorithm == x509.RSA {
			rsaKey, ok := privKey.(*rsa.PrivateKey)
			if !ok {
				return nil, fmt.Errorf("private key type does not match certificate")
			}
			pubKey, ok := cert.PublicKey.(*rsa.PublicKey)
			if !ok || pubKey.N.Cmp(rsaKey.PublicKey.N) != 0 || pubKey.E != rsaKey.PublicKey.E {
				return nil, fmt.Errorf("private key does not match certificate public key")
			}
		} else if cert.PublicKeyAlgorithm == x509.ECDSA {
			ecKey, ok := privKey.(*ecdsa.PrivateKey)
			if !ok {
				return nil, fmt.Errorf("private key type does not match certificate")
			}
			pubKey, ok := cert.PublicKey.(*ecdsa.PublicKey)
			if !ok || pubKey.X.Cmp(ecKey.PublicKey.X) != 0 || pubKey.Y.Cmp(ecKey.PublicKey.Y) != 0 {
				return nil, fmt.Errorf("private key does not match certificate public key")
			}
		}
	}

	ca := &models.CertificateAuthority{
		Name:           name,
		Description:    description,
		Subject:        cert.Subject.CommonName,
		CreatedAt:      cert.NotBefore,
		ExpiresAt:      cert.NotAfter,
		CurrentVersion: 1,
	}

	return ca, nil
}
