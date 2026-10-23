package server

import (
	"net/http"
	"testing"
	"time"

	"github.com/gugabguerra/glcert/internal/database"
)

const setupPassphrase = "encryption-passphrase-123"

// downloadCAKey reads a CA private key, which needs the encryption key.
func downloadCAKey(t *testing.T, h http.Handler, token, caID string) int {
	t.Helper()
	return doRequest(t, h, http.MethodGet, "/api/ca/"+caID+"/download/key", nil, token).Code
}

func TestAdminPasswordChangeKeepsKeysReadableAfterRestart(t *testing.T) {
	h, dir := newTestRouter(t)
	admin := completeSetup(t, h)
	caID := createCAAs(t, h, admin, "pw-change-ca", "pw-change.example.com")

	rr := doRequest(t, h, http.MethodPut, "/api/auth/password", map[string]string{
		"currentPassword": "admin-password123!",
		"newPassword":     "a-new-password-456!",
	}, admin)
	if rr.Code != http.StatusOK {
		t.Fatalf("change password: %d %s", rr.Code, rr.Body.String())
	}

	restarted := newTestRouterAt(t, dir)
	token, code := loginAs(t, restarted, "admin@example.com", "a-new-password-456!")
	if code != http.StatusOK {
		t.Fatalf("login after restart: %d", code)
	}
	if got := downloadCAKey(t, restarted, token, caID); got != http.StatusOK {
		t.Fatalf("CA key must stay readable after a password change, got %d", got)
	}
}

func TestSecondAdminCanSignInAndUnlock(t *testing.T) {
	h, dir := newTestRouter(t)
	admin := completeSetup(t, h)
	caID := createCAAs(t, h, admin, "second-admin-ca", "second.example.com")
	createUserAs(t, h, admin, "Second", "second@example.com", "second-password-789!", "admin")

	restarted := newTestRouterAt(t, dir)
	token, code := loginAs(t, restarted, "second@example.com", "second-password-789!")
	if code != http.StatusOK {
		t.Fatalf("second admin must be able to sign in, got %d", code)
	}
	if got := downloadCAKey(t, restarted, token, caID); got != http.StatusOK {
		t.Fatalf("second admin must unlock encryption, got %d", got)
	}
}

func TestPassphraseRecoversLockedKey(t *testing.T) {
	h, dir := newTestRouter(t)
	admin := completeSetup(t, h)
	caID := createCAAs(t, h, admin, "recovery-ca", "recovery.example.com")

	// The only admin resets a forgotten password while the server is locked:
	// nothing can rewrap their key copy, so it goes stale.
	locked := newTestRouterAt(t, dir)
	db, err := database.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO password_resets (user_id, token, expires_at)
		SELECT id, 'reset-token', ? FROM users`, time.Now().Add(10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	rr := doRequest(t, locked, http.MethodPost, "/api/auth/reset-password", map[string]string{
		"token": "reset-token", "password": "after-reset-pw-1!",
	}, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("reset: %d %s", rr.Code, rr.Body.String())
	}

	token, code := loginAs(t, locked, "admin@example.com", "after-reset-pw-1!")
	if code != http.StatusOK {
		t.Fatalf("sign-in must not be blocked by a stale key copy, got %d", code)
	}
	if got := downloadCAKey(t, locked, token, caID); got == http.StatusOK {
		t.Fatal("key must stay locked until recovery")
	}

	for pass, want := range map[string]int{"wrong-passphrase": http.StatusForbidden, setupPassphrase: http.StatusOK} {
		rr = doRequest(t, locked, http.MethodPost, "/api/auth/unlock-encryption", map[string]string{
			"passphrase": pass, "password": "after-reset-pw-1!",
		}, token)
		if rr.Code != want {
			t.Fatalf("unlock with %q: want %d, got %d %s", pass, want, rr.Code, rr.Body.String())
		}
	}
	if got := downloadCAKey(t, locked, token, caID); got != http.StatusOK {
		t.Fatalf("recovered key must open the CA, got %d", got)
	}

	// The recovery rewrapped the copy, so the next restart unlocks normally.
	again := newTestRouterAt(t, dir)
	token, _ = loginAs(t, again, "admin@example.com", "after-reset-pw-1!")
	if got := downloadCAKey(t, again, token, caID); got != http.StatusOK {
		t.Fatalf("copy must be rewrapped after recovery, got %d", got)
	}
}

func TestNonAdminCannotUnlockEncryption(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	createUserAs(t, h, admin, "Op", "op@example.com", "operator-password-1!", "operator")
	op, _ := loginAs(t, h, "op@example.com", "operator-password-1!")
	rr := doRequest(t, h, http.MethodPost, "/api/auth/unlock-encryption", map[string]string{
		"passphrase": setupPassphrase, "password": "operator-password-1!",
	}, op)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator must not unlock encryption, got %d", rr.Code)
	}
}
