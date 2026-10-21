package services

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"
)

var keyAlgorithms = []struct {
	name string
	algo x509.PublicKeyAlgorithm
}{
	{"rsa", x509.RSA},
	{"ecdsa", x509.ECDSA},
	{"ed25519", x509.Ed25519},
}

func parseTestCert(t *testing.T, certPEM []byte) *x509.Certificate {
	t.Helper()
	block, _ := pem.Decode(certPEM)
	if block == nil {
		t.Fatal("decode certificate PEM")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	return cert
}

// assertKeyMatches checks that keyPEM parses back and holds the private half
// of the certificate's public key.
func assertKeyMatches(t *testing.T, cert *x509.Certificate, keyPEM []byte) {
	t.Helper()
	key, err := parsePrivateKeyWithPassphrase(keyPEM, nil)
	if err != nil {
		t.Fatalf("parse key PEM: %v", err)
	}
	signer, err := signerFromKey(key)
	if err != nil {
		t.Fatalf("signer from key: %v", err)
	}
	type equaler interface{ Equal(x crypto.PublicKey) bool }
	if !signer.Public().(equaler).Equal(cert.PublicKey) {
		t.Fatal("private key does not match certificate public key")
	}
}

func TestGenerateCertSelfSignedPerAlgorithm(t *testing.T) {
	svc := &CertService{}
	for _, tc := range keyAlgorithms {
		t.Run(tc.name, func(t *testing.T) {
			res, err := svc.GenerateCert(CreateCertInput{
				Name: "c", CommonName: "c.example.com", Type: "selfsigned", KeyAlgorithm: tc.name,
			}, nil, nil)
			if err != nil {
				t.Fatalf("GenerateCert: %v", err)
			}
			cert := parseTestCert(t, res.CertPEM)
			if cert.PublicKeyAlgorithm != tc.algo {
				t.Fatalf("PublicKeyAlgorithm = %v, want %v", cert.PublicKeyAlgorithm, tc.algo)
			}
			if err := cert.CheckSignature(cert.SignatureAlgorithm, cert.RawTBSCertificate, cert.Signature); err != nil {
				t.Fatalf("self-signature: %v", err)
			}
			if tc.algo != x509.RSA && cert.KeyUsage&x509.KeyUsageKeyEncipherment != 0 {
				t.Fatal("non-RSA certificate must not carry KeyEncipherment")
			}
			assertKeyMatches(t, cert, res.KeyPEM)
		})
	}
}

// TestGenerateCertCASignedPerAlgorithm issues a leaf of every algorithm under
// a CA of every algorithm.
func TestGenerateCertCASignedPerAlgorithm(t *testing.T) {
	caSvc := &CAService{}
	certSvc := &CertService{}
	for _, caAlg := range keyAlgorithms {
		_, caCertPEM, caKeyPEM, err := caSvc.GenerateCA(CreateCAInput{
			Name: "ca", CommonName: "ca.example.com", KeyAlgorithm: caAlg.name,
		}, nil, nil)
		if err != nil {
			t.Fatalf("GenerateCA(%s): %v", caAlg.name, err)
		}
		caCert := parseTestCert(t, caCertPEM)
		if caCert.PublicKeyAlgorithm != caAlg.algo {
			t.Fatalf("CA PublicKeyAlgorithm = %v, want %v", caCert.PublicKeyAlgorithm, caAlg.algo)
		}
		assertKeyMatches(t, caCert, caKeyPEM)

		for _, leafAlg := range keyAlgorithms {
			t.Run(caAlg.name+"-ca/"+leafAlg.name, func(t *testing.T) {
				res, err := certSvc.GenerateCert(CreateCertInput{
					Name: "c", CommonName: "c.example.com", Type: "server", KeyAlgorithm: leafAlg.name,
				}, caCertPEM, caKeyPEM)
				if err != nil {
					t.Fatalf("GenerateCert: %v", err)
				}
				cert := parseTestCert(t, res.CertPEM)
				if cert.PublicKeyAlgorithm != leafAlg.algo {
					t.Fatalf("PublicKeyAlgorithm = %v, want %v", cert.PublicKeyAlgorithm, leafAlg.algo)
				}
				if err := cert.CheckSignatureFrom(caCert); err != nil {
					t.Fatalf("signature from CA: %v", err)
				}
				assertKeyMatches(t, cert, res.KeyPEM)
			})
		}
	}
}

func TestGenerateKeyParams(t *testing.T) {
	key, err := generateKey(KeyParams{Algorithm: "rsa", RSAKeySize: 3072})
	if err != nil {
		t.Fatal(err)
	}
	if got := key.(*rsa.PrivateKey).N.BitLen(); got != 3072 {
		t.Fatalf("RSA size = %d, want 3072", got)
	}

	key, err = generateKey(KeyParams{Algorithm: "ecdsa", ECDSACurve: "P-384"})
	if err != nil {
		t.Fatal(err)
	}
	if got := key.(*ecdsa.PrivateKey).Curve.Params().Name; got != "P-384" {
		t.Fatalf("curve = %s, want P-384", got)
	}

	key, err = generateKey(KeyParams{})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := key.(*rsa.PrivateKey); !ok {
		t.Fatalf("default key type = %T, want RSA", key)
	}

	if _, err := generateKey(KeyParams{Algorithm: "dsa"}); err == nil {
		t.Fatal("expected unknown algorithm to be rejected")
	}
	if _, err := generateKey(KeyParams{Algorithm: "ecdsa", ECDSACurve: "P-224"}); err == nil {
		t.Fatal("expected unsupported curve to be rejected")
	}
}

func TestKeyParamsFromCertPEMRoundTrip(t *testing.T) {
	svc := &CertService{}
	for _, want := range []KeyParams{
		{Algorithm: "rsa", RSAKeySize: 3072},
		{Algorithm: "ecdsa", ECDSACurve: "P-384"},
		{Algorithm: "ed25519"},
	} {
		res, err := svc.GenerateCert(CreateCertInput{
			Name: "c", CommonName: "c", Type: "selfsigned",
			KeyAlgorithm: want.Algorithm, RSAKeySize: want.RSAKeySize, ECDSACurve: want.ECDSACurve,
		}, nil, nil)
		if err != nil {
			t.Fatalf("GenerateCert(%s): %v", want.Algorithm, err)
		}
		got, err := KeyParamsFromCertPEM(res.CertPEM)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("KeyParamsFromCertPEM = %+v, want %+v", got, want)
		}
	}
}

// TestPassphraseRoundTripPerAlgorithm covers CA keys stored behind a passphrase.
func TestPassphraseRoundTripPerAlgorithm(t *testing.T) {
	for _, alg := range []string{"rsa", "ecdsa", "ed25519"} {
		key, err := generateKey(KeyParams{Algorithm: alg})
		if err != nil {
			t.Fatal(err)
		}
		keyPEM, err := encodePrivateKeyPEM(key)
		if err != nil {
			t.Fatal(err)
		}
		enc, err := EncryptPEMWithPassphrase(keyPEM, "secret")
		if err != nil {
			t.Fatalf("%s: encrypt: %v", alg, err)
		}
		dec, err := parsePrivateKeyWithPassphrase(enc, []byte("secret"))
		if err != nil {
			t.Fatalf("%s: decrypt: %v", alg, err)
		}
		if _, err := encodePrivateKeyPEM(dec); err != nil {
			t.Fatalf("%s: re-encode: %v", alg, err)
		}
		if _, ok := dec.(ed25519.PrivateKey); alg == "ed25519" && !ok {
			t.Fatalf("decrypted key type = %T, want ed25519", dec)
		}
	}
}
