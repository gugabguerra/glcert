package handlers

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAppBaseURL(t *testing.T) {
	req := func(host string, isTLS bool, xfp string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "http://example.test/api/auth/forgot-password", nil)
		r.Host = host
		if isTLS {
			r.TLS = &tls.ConnectionState{HandshakeComplete: true}
		}
		if xfp != "" {
			r.Header.Set("X-Forwarded-Proto", xfp)
		}
		return r
	}

	cases := []struct {
		name string
		host string
		tls  bool
		xfp  string
		want string
	}{
		{"plain host", "cert.example.com:8080", false, "", "http://cert.example.com:8080"},
		{"tls request", "cert.example.com", true, "", "https://cert.example.com"},
		{"forwarded https", "cert.example.com", false, "https", "https://cert.example.com"},
		{"host injection", "example.com/\r\nX-Evil: 1", false, "", "http://localhost"},
		{"empty host", "", false, "", "http://localhost"},
		{"host with backslash", "evil.com\\@good.com", false, "", "http://localhost"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := appBaseURL(req(tc.host, tc.tls, tc.xfp)); got != tc.want {
				t.Fatalf("appBaseURL(%q) = %q, want %q", tc.host, got, tc.want)
			}
		})
	}
}
