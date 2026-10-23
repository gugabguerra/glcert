package services

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/gugabguerra/glcert/internal/database"
)

func TestPasswordChangeKeepsDataReadable(t *testing.T) {
	dir := t.TempDir()
	s := NewCryptoService(dir)
	if err := s.SavePassphrase("master", "admin-1", "old-pw"); err != nil {
		t.Fatal(err)
	}
	blob, _ := s.Encrypt([]byte("secret"))
	if err := s.SetWrap("admin-1", "new-pw"); err != nil {
		t.Fatal(err)
	}

	fresh := NewCryptoService(dir)
	if err := fresh.Unlock("admin-1", "old-pw"); err == nil {
		t.Fatal("old password must no longer open the key")
	}
	if err := fresh.Unlock("admin-1", "new-pw"); err != nil {
		t.Fatalf("Unlock with new password: %v", err)
	}
	if plain, err := fresh.Decrypt(blob); err != nil || string(plain) != "secret" {
		t.Fatalf("data unreadable after password change: %q %v", plain, err)
	}
}

func TestEachAdminUnlocksWithOwnPassword(t *testing.T) {
	dir := t.TempDir()
	s := NewCryptoService(dir)
	if err := s.SavePassphrase("master", "admin-1", "pw-1"); err != nil {
		t.Fatal(err)
	}
	blob, _ := s.Encrypt([]byte("secret"))
	if err := s.SetWrap("admin-2", "pw-2"); err != nil {
		t.Fatal(err)
	}

	second := NewCryptoService(dir)
	if err := second.Unlock("admin-2", "pw-2"); err != nil {
		t.Fatalf("second admin Unlock: %v", err)
	}
	if plain, err := second.Decrypt(blob); err != nil || string(plain) != "secret" {
		t.Fatalf("second admin cannot read data: %v", err)
	}

	if err := s.RemoveWrap("admin-2"); err != nil {
		t.Fatal(err)
	}
	if err := NewCryptoService(dir).Unlock("admin-2", "pw-2"); !errors.Is(err, ErrNoWrap) {
		t.Fatalf("removed copy must not unlock, got %v", err)
	}
}

func TestRecoveryWithPassphrase(t *testing.T) {
	dir := t.TempDir()
	s := NewCryptoService(dir)
	if err := s.SavePassphrase("master", "admin-1", "pw"); err != nil {
		t.Fatal(err)
	}
	blob, _ := s.Encrypt([]byte("secret"))

	locked := NewCryptoService(dir)
	if err := locked.UnlockWithPassphrase("wrong"); err == nil {
		t.Fatal("wrong passphrase must not unlock")
	}
	if locked.IsEnabled() {
		t.Fatal("failed unlock must leave the service locked")
	}
	if err := locked.UnlockWithPassphrase("master"); err != nil {
		t.Fatalf("UnlockWithPassphrase: %v", err)
	}
	if plain, err := locked.Decrypt(blob); err != nil || string(plain) != "secret" {
		t.Fatalf("recovered service cannot read data: %v", err)
	}
}

// v1Instance writes a version 1 data dir: the key file and every secret are
// sealed with PBKDF2(admin password, salt), as the old code did.
func v1Instance(t *testing.T, password string) string {
	t.Helper()
	dir := t.TempDir()
	s := NewCryptoService(dir)
	salt := bytes.Repeat([]byte{7}, 16)
	gcm, err := newGCM(s.deriveKey(password, salt))
	if err != nil {
		t.Fatal(err)
	}
	sealV1 := func(p string) []byte {
		b, err := seal(gcm, []byte(p))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	file := base64.StdEncoding.EncodeToString(append(append([]byte{}, salt...), sealV1("master")...))
	if err := os.WriteFile(s.GetPassphrasePath(), []byte(file), 0600); err != nil {
		t.Fatal(err)
	}

	caDir := filepath.Join(dir, "certificates", "ca", "root", "v1")
	certDir := filepath.Join(dir, "certificates", "server", "web", "v2")
	for d, f := range map[string]string{caDir: "ca.key", certDir: "key.pem"} {
		os.MkdirAll(d, 0755)
		os.WriteFile(filepath.Join(d, f), sealV1("KEY "+f), 0600)
	}
	// A blob from before an earlier password change: no key opens it.
	staleDir := filepath.Join(dir, "certificates", "server", "old", "v1")
	os.MkdirAll(staleDir, 0755)
	os.WriteFile(filepath.Join(staleDir, "key.pem"), bytes.Repeat([]byte{1}, 64), 0600)

	db, err := database.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	mustExec := func(q string, args ...interface{}) {
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	mustExec(`INSERT INTO users (id, email, password_hash, role, totp_secret, totp_enabled) VALUES ('admin-1', 'a@example.com', 'x', 'admin', ?, TRUE)`, sealV1("TOTPSECRET"))
	mustExec(`INSERT INTO certificate_authorities (id, name, subject, expires_at, key_encrypted_passphrase) VALUES ('ca-1', 'root', 'CN=root', CURRENT_TIMESTAMP, ?)`, sealV1("ca-pass"))
	mustExec(`UPDATE settings SET smtp_password = ? WHERE id = 1`, string(sealV1("smtp-pass")))
	db.Close()
	return dir
}

func TestMigrateV1KeepsEverySecret(t *testing.T) {
	dir := v1Instance(t, "admin-pw")
	db, err := database.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	s := NewCryptoService(dir)
	if err := s.Unlock("admin-1", "admin-pw"); !errors.Is(err, ErrLegacyKeyFile) {
		t.Fatalf("expected ErrLegacyKeyFile, got %v", err)
	}
	if _, err := s.MigrateV1(db, "admin-1", "wrong-pw"); err == nil {
		t.Fatal("wrong password must not migrate")
	}
	report, err := s.MigrateV1(db, "admin-1", "admin-pw")
	if err != nil {
		t.Fatalf("MigrateV1: %v", err)
	}
	if report.Migrated != 5 || report.Unreadable != 1 {
		t.Fatalf("unexpected report %+v", report)
	}
	if _, err := os.Stat(s.GetPassphrasePath() + ".v1"); err != nil {
		t.Fatalf("v1 key file must be kept: %v", err)
	}

	// A fresh process unlocks with the v2 file and reads every secret.
	fresh := NewCryptoService(dir)
	if err := fresh.Unlock("admin-1", "admin-pw"); err != nil {
		t.Fatalf("Unlock after migration: %v", err)
	}
	if err := fresh.UnlockWithPassphrase("master"); err != nil {
		t.Fatalf("setup passphrase must recover the key: %v", err)
	}
	expectPlain := func(blob []byte, want string) {
		t.Helper()
		got, err := fresh.Decrypt(blob)
		if err != nil || string(got) != want {
			t.Fatalf("want %q, got %q (%v)", want, got, err)
		}
	}
	for path, want := range map[string]string{
		"certificates/ca/root/v1/ca.key":     "KEY ca.key",
		"certificates/server/web/v2/key.pem": "KEY key.pem",
	} {
		blob, _ := os.ReadFile(filepath.Join(dir, path))
		expectPlain(blob, want)
	}
	var totp, caPass []byte
	var smtp string
	db.QueryRow(`SELECT totp_secret FROM users WHERE id = 'admin-1'`).Scan(&totp)
	db.QueryRow(`SELECT key_encrypted_passphrase FROM certificate_authorities WHERE id = 'ca-1'`).Scan(&caPass)
	db.QueryRow(`SELECT smtp_password FROM settings WHERE id = 1`).Scan(&smtp)
	expectPlain(totp, "TOTPSECRET")
	expectPlain(caPass, "ca-pass")
	expectPlain([]byte(smtp), "smtp-pass")

	stale, _ := os.ReadFile(filepath.Join(dir, "certificates/server/old/v1/key.pem"))
	if !bytes.Equal(stale, bytes.Repeat([]byte{1}, 64)) {
		t.Fatal("unreadable secrets must be left untouched")
	}
}

func TestMigrateV1ResumesAfterInterruption(t *testing.T) {
	dir := v1Instance(t, "admin-pw")
	db, err := database.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	s := NewCryptoService(dir)
	v1File, _ := os.ReadFile(s.GetPassphrasePath())
	if _, err := s.MigrateV1(db, "admin-1", "admin-pw"); err != nil {
		t.Fatal(err)
	}
	kf, err := s.readKeyFile()
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a crash after the secrets were rewritten but before the new
	// key file landed: the v1 file and the pending salt are still on disk.
	os.WriteFile(s.GetPassphrasePath(), v1File, 0600)
	os.WriteFile(s.pendingSaltPath(), kf.Salt, 0600)

	again := NewCryptoService(dir)
	report, err := again.MigrateV1(db, "admin-1", "admin-pw")
	if err != nil {
		t.Fatalf("re-run: %v", err)
	}
	if report.Migrated != 0 || report.Current != 5 {
		t.Fatalf("re-run must find everything current, got %+v", report)
	}
	blob, _ := os.ReadFile(filepath.Join(dir, "certificates/ca/root/v1/ca.key"))
	if plain, err := again.Decrypt(blob); err != nil || string(plain) != "KEY ca.key" {
		t.Fatalf("key file unreadable after resumed migration: %v", err)
	}
}
