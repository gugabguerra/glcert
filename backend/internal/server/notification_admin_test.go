package server

import (
	"net/http"
	"testing"
)

func TestNotificationTestEndpointsAreAdminOnly(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	createUserAs(t, h, adminToken, "Operator", "op@example.com", "operator-pass1", "operator")
	opToken, code := loginAs(t, h, "op@example.com", "operator-pass1")
	if code != http.StatusOK {
		t.Fatalf("operator login failed: %d", code)
	}

	// Operator (and any non-admin) must be rejected before the handler runs.
	for _, path := range []string{"/api/notifications/test", "/api/notifications/test-email"} {
		rr := doRequest(t, h, http.MethodPost, path, map[string]string{
			"webhookUrl": "https://example.test/hook",
			"email":      "someone@example.com",
		}, opToken)
		if rr.Code != http.StatusForbidden {
			t.Errorf("%s as operator: got %d, want 403", path, rr.Code)
		}
	}

	// Admin reaches the handler (may be 400/500 depending on SMTP/webhook
	// availability, but never 403).
	for _, path := range []string{"/api/notifications/test", "/api/notifications/test-email"} {
		rr := doRequest(t, h, http.MethodPost, path, map[string]string{
			"webhookUrl": "https://example.test/hook",
			"email":      "someone@example.com",
		}, adminToken)
		if rr.Code == http.StatusForbidden || rr.Code == http.StatusUnauthorized {
			t.Errorf("%s as admin: got %d, must not be blocked", path, rr.Code)
		}
	}
}
