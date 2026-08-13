package server

import (
	"net/http"
	"testing"
)

func TestSecurityHeadersPresent(t *testing.T) {
	h, _ := newTestRouter(t)

	rr := doRequest(t, h, http.MethodGet, "/api/health", nil, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("health failed: %d", rr.Code)
	}

	checks := map[string]string{
		"Content-Security-Policy": "default-src 'self'",
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"Referrer-Policy":         "no-referrer",
	}
	for header, want := range checks {
		got := rr.Header().Get(header)
		if got == "" {
			t.Errorf("missing security header %s", header)
			continue
		}
		if len(want) > 0 && got != want && !contains(got, want) {
			t.Errorf("header %s = %q, want contains %q", header, got, want)
		}
	}
	if csp := rr.Header().Get("Content-Security-Policy"); !contains(csp, "script-src 'self'") {
		t.Errorf("CSP missing script-src: %q", csp)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}