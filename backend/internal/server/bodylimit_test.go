package server

import (
	"net/http"
	"strings"
	"testing"
)

func TestImportCARejectsOversizedBody(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	// Body exceeds the 1 MiB MaxBytesReader cap on /ca/import; it must be
	// rejected before any processing.
	big := strings.Repeat("a", 2<<20)
	rr := doRequest(t, h, http.MethodPost, "/api/ca/import", map[string]interface{}{
		"name":    big,
		"certPem": "not-a-real-cert",
		"keyPem":  "not-a-real-key",
	}, adminToken)
	if rr.Code != http.StatusBadRequest && rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized import body must be rejected, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestImportCertRejectsOversizedBody(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)
	caID := createCAAs(t, h, adminToken, "ca-bodflimit", "ca-bodflimit.example.com")

	big := strings.Repeat("a", 2<<20)
	rr := doRequest(t, h, http.MethodPost, "/api/certificates/import", map[string]interface{}{
		"name":                   big,
		"certPem":                "not-a-real-cert",
		"keyPem":                 "not-a-real-key",
		"certificateAuthorityId": caID,
	}, adminToken)
	if rr.Code != http.StatusBadRequest && rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized cert import body must be rejected, got %d body=%s", rr.Code, rr.Body.String())
	}
}
