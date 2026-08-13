package server

import (
	"net/http"
	"testing"
)

func TestLoginDoesNotRevealUserExistence(t *testing.T) {
	h, _ := newTestRouter(t)
	completeSetup(t, h)

	unknown := doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"email":    "ghost@example.com",
		"password": "whatever-pass-123",
	}, "")
	wrongPass := doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"email":    "admin@example.com",
		"password": "wrong-pass-456",
	}, "")

	if unknown.Code != http.StatusUnauthorized || wrongPass.Code != http.StatusUnauthorized {
		t.Fatalf("both must be 401, got unknown=%d wrongPass=%d", unknown.Code, wrongPass.Code)
	}
	if unknown.Body.String() != wrongPass.Body.String() {
		t.Errorf("responses must be identical to avoid user enumeration: %q vs %q",
			unknown.Body.String(), wrongPass.Body.String())
	}
}
