package services

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"strings"
)

// KeyParams describes the key pair to generate for a CA or certificate.
type KeyParams struct {
	Algorithm  string // rsa (default), ecdsa, ed25519
	RSAKeySize int    // RSA only; defaults to 2048
	ECDSACurve string // ECDSA only: P-256 (default), P-384, P-521
}

// ValidateKeyParams rejects unknown algorithms and curves so callers can
// answer 400 before doing any work.
func ValidateKeyParams(p KeyParams) error {
	switch strings.ToLower(p.Algorithm) {
	case "", "rsa":
	case "ecdsa":
		if _, err := ecdsaCurve(p.ECDSACurve); err != nil {
			return err
		}
	case "ed25519":
	default:
		return fmt.Errorf("keyAlgorithm must be rsa, ecdsa, or ed25519")
	}
	return nil
}

func ecdsaCurve(name string) (elliptic.Curve, error) {
	switch strings.ToUpper(name) {
	case "", "P-256", "P256":
		return elliptic.P256(), nil
	case "P-384", "P384":
		return elliptic.P384(), nil
	case "P-521", "P521":
		return elliptic.P521(), nil
	default:
		return nil, fmt.Errorf("ecdsaCurve must be P-256, P-384, or P-521")
	}
}

// generateKey creates a private key for the requested algorithm.
func generateKey(p KeyParams) (crypto.Signer, error) {
	if err := ValidateKeyParams(p); err != nil {
		return nil, err
	}
	switch strings.ToLower(p.Algorithm) {
	case "ecdsa":
		curve, _ := ecdsaCurve(p.ECDSACurve)
		return ecdsa.GenerateKey(curve, rand.Reader)
	case "ed25519":
		_, priv, err := ed25519.GenerateKey(rand.Reader)
		return priv, err
	default:
		size := p.RSAKeySize
		if size == 0 {
			size = 2048
		}
		return rsa.GenerateKey(rand.Reader, size)
	}
}

// encodePrivateKeyPEM encodes a key in its conventional PEM form: PKCS#1 for
// RSA, SEC 1 for ECDSA and PKCS#8 for Ed25519.
func encodePrivateKeyPEM(key interface{}) ([]byte, error) {
	switch k := key.(type) {
	case *rsa.PrivateKey:
		return pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(k)}), nil
	case *ecdsa.PrivateKey:
		der, err := x509.MarshalECPrivateKey(k)
		if err != nil {
			return nil, fmt.Errorf("marshal EC key: %w", err)
		}
		return pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}), nil
	case ed25519.PrivateKey:
		der, err := x509.MarshalPKCS8PrivateKey(k)
		if err != nil {
			return nil, fmt.Errorf("marshal Ed25519 key: %w", err)
		}
		return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
	default:
		return nil, fmt.Errorf("unsupported key type: %T", key)
	}
}

// signerFromKey narrows a parsed private key to a signer usable by
// x509.CreateCertificate.
func signerFromKey(key interface{}) (crypto.Signer, error) {
	switch k := key.(type) {
	case *rsa.PrivateKey:
		return k, nil
	case *ecdsa.PrivateKey:
		return k, nil
	case ed25519.PrivateKey:
		return k, nil
	default:
		return nil, fmt.Errorf("unsupported key type: %T", key)
	}
}

// KeyParamsFromCertPEM returns the key parameters of an existing certificate,
// so regeneration can keep its algorithm, size and curve.
func KeyParamsFromCertPEM(certPEM []byte) (KeyParams, error) {
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return KeyParams{}, fmt.Errorf("decode certificate PEM")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return KeyParams{}, fmt.Errorf("parse certificate: %w", err)
	}
	switch pub := cert.PublicKey.(type) {
	case *rsa.PublicKey:
		return KeyParams{Algorithm: "rsa", RSAKeySize: pub.N.BitLen()}, nil
	case *ecdsa.PublicKey:
		return KeyParams{Algorithm: "ecdsa", ECDSACurve: pub.Curve.Params().Name}, nil
	case ed25519.PublicKey:
		return KeyParams{Algorithm: "ed25519"}, nil
	default:
		return KeyParams{}, fmt.Errorf("unsupported public key type: %T", cert.PublicKey)
	}
}

// keyUsageFor drops KeyEncipherment for non-RSA keys, where it does not apply.
func keyUsageFor(key crypto.Signer, usage x509.KeyUsage) x509.KeyUsage {
	if _, ok := key.(*rsa.PrivateKey); !ok {
		usage &^= x509.KeyUsageKeyEncipherment
	}
	return usage
}
