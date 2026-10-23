package services

import (
	"bytes"
	"os"
	"testing"
)

func TestEncryptPassthroughWhenNotConfigured(t *testing.T) {
	s := NewCryptoService(t.TempDir())

	out, err := s.Encrypt([]byte("plaintext secret"))
	if err != nil {
		t.Fatalf("Encrypt on unconfigured crypto should not fail: %v", err)
	}
	if !bytes.Equal(out, []byte("plaintext secret")) {
		t.Fatalf("Encrypt should pass through when encryption is not configured, got %q", out)
	}

	back, err := s.Decrypt(out)
	if err != nil {
		t.Fatalf("Decrypt on unconfigured crypto should not fail: %v", err)
	}
	if !bytes.Equal(back, []byte("plaintext secret")) {
		t.Fatalf("Decrypt should pass through when encryption is not configured, got %q", back)
	}
}

func TestEncryptFailsClosedWhenLocked(t *testing.T) {
	dir := t.TempDir()

	setup := NewCryptoService(dir)
	if err := setup.SavePassphrase("correct horse battery staple", "admin-1", "admin-password"); err != nil {
		t.Fatalf("SavePassphrase: %v", err)
	}

	// Fresh instance in the same data dir: encryption is configured but the
	// passphrase has not been unlocked. It must refuse to handle secrets
	// rather than silently storing them in plaintext.
	locked := NewCryptoService(dir)

	if _, err := locked.Encrypt([]byte("top secret key material")); err == nil {
		t.Fatal("Encrypt must fail closed when encryption is configured but locked")
	}
	if _, err := locked.Decrypt([]byte("top secret key material")); err == nil {
		t.Fatal("Decrypt must fail closed when encryption is configured but locked")
	}
}

func TestEncryptDecryptRoundTripWhenUnlocked(t *testing.T) {
	dir := t.TempDir()
	const pass = "correct horse battery staple"

	s := NewCryptoService(dir)
	if err := s.SavePassphrase(pass, "admin-1", "admin-password"); err != nil {
		t.Fatalf("SavePassphrase: %v", err)
	}

	enc, err := s.Encrypt([]byte("private key material"))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if bytes.Equal(enc, []byte("private key material")) {
		t.Fatal("encrypted output must differ from plaintext")
	}

	// A fresh instance that loads the passphrase must decrypt the same blob.
	unlocked := NewCryptoService(dir)
	if err := unlocked.Unlock("admin-1", "admin-password"); err != nil {
		t.Fatalf("Unlock: %v", err)
	}
	plain, err := unlocked.Decrypt(enc)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if !bytes.Equal(plain, []byte("private key material")) {
		t.Fatalf("round trip mismatch: got %q", plain)
	}
}

func TestPassphraseFileDeletedAllowsPlaintextAgain(t *testing.T) {
	dir := t.TempDir()
	const pass = "correct horse battery staple"

	s := NewCryptoService(dir)
	if err := s.SavePassphrase(pass, "admin-1", "admin-password"); err != nil {
		t.Fatalf("SavePassphrase: %v", err)
	}

	// Simulate factory reset: key file removed and crypto reset. Plaintext
	// storage is then the intended state again (fresh install).
	if err := os.Remove(s.GetPassphrasePath()); err != nil {
		t.Fatalf("remove key file: %v", err)
	}
	s.Reset()

	out, err := s.Encrypt([]byte("plaintext secret"))
	if err != nil {
		t.Fatalf("Encrypt after reset should pass through: %v", err)
	}
	if !bytes.Equal(out, []byte("plaintext secret")) {
		t.Fatalf("unexpected output %q", out)
	}
}
