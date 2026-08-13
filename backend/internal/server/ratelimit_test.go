package server

import (
	"net/http"
	"testing"
)

func TestLoginRateLimitedAfterBurst(t *testing.T) {
	h, _ := newTestRouter(t)
	completeSetup(t, h)

	// Burst is 5: the first five attempts pass through (they fail auth).
	for i := 0; i < 5; i++ {
		rr := doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{
			"email":    "admin@example.com",
			"password": "wrong-password",
		}, "")
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d should be 401, got %d", i+1, rr.Code)
		}
	}

	// The sixth attempt must be throttled regardless of credentials.
	rr := doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"email":    "admin@example.com",
		"password": "wrong-password",
	}, "")
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("sixth login attempt must be rate limited, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestForgotPasswordRateLimited(t *testing.T) {
	h, _ := newTestRouter(t)

	for i := 0; i < 3; i++ {
		doRequest(t, h, http.MethodPost, "/api/auth/forgot-password", map[string]string{
			"email": "nobody@example.com",
		}, "")
	}

	rr := doRequest(t, h, http.MethodPost, "/api/auth/forgot-password", map[string]string{
		"email": "nobody@example.com",
	}, "")
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("forgot-password must be rate limited after burst, got %d", rr.Code)
	}
}

func TestLegitLoginStillWorksWithinLimit(t *testing.T) {
	h, _ := newTestRouter(t)
	completeSetup(t, h)

	rr := doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"email":    "admin@example.com",
		"password": "admin-password123!",
	}, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("a legitimate login within the limit must succeed, got %d body=%s", rr.Code, rr.Body.String())
	}
}
