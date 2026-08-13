package server

import (
	"net/http"
	"testing"
)

func TestSetupIsRejectedOnceComplete(t *testing.T) {
	h, _ := newTestRouter(t)

	// First setup succeeds and returns an admin token.
	token := completeSetup(t, h)
	if token == "" {
		t.Fatal("expected a session token after initial setup")
	}

	// A second, unauthenticated setup attempt must be rejected.
	rr := doRequest(t, h, http.MethodPost, "/api/auth/setup", map[string]string{
		"password":             "attacker-password",
		"encryptionPassphrase": "attacker-passphrase",
		"email":                "attacker@example.com",
	}, "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("second setup should be forbidden, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestSetupRejectedWithoutSetupCompleteBeforeBootstrap(t *testing.T) {
	h, _ := newTestRouter(t)

	// Simulate the original admin already existing: do setup, then verify the
	// admin can still log in and no extra admin was created by a second setup.
	completeSetup(t, h)

	rr := doRequest(t, h, http.MethodPost, "/api/auth/setup", map[string]string{
		"password":             "attacker-password",
		"encryptionPassphrase": "attacker-passphrase",
		"email":                "attacker@example.com",
	}, "")
	if rr.Code == http.StatusOK || rr.Code == http.StatusCreated {
		t.Fatalf("setup must not create a new admin after bootstrap, got %d", rr.Code)
	}

	// The original admin credentials must still be valid.
	_, code := loginAs(t, h, "admin@example.com", "admin-password123!")
	if code != http.StatusOK {
		t.Fatalf("original admin login failed after rejected setup: %d", code)
	}
}
