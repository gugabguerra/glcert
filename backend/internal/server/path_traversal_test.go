package server

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestCreateCARejectsTraversalName(t *testing.T) {
	h, dataDir := newTestRouter(t)
	token := completeSetup(t, h)

	for _, name := range []string{"../../evil", "a/b", "..\\evil", ".."} {
		rr := doRequest(t, h, http.MethodPost, "/api/ca", map[string]interface{}{
			"name":         name,
			"commonName":   "cn.example.com",
			"keyAlgorithm": "rsa",
		}, token)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("name %q should be rejected, got %d body=%s", name, rr.Code, rr.Body.String())
		}
	}

	// Nothing must have been written outside the data dir.
	if _, err := os.Stat(filepath.Join(filepath.Dir(dataDir), "evil")); err == nil {
		t.Fatal("traversal CA name wrote files outside data dir")
	}
}

func TestCreateCertRejectsTraversalName(t *testing.T) {
	h, dataDir := newTestRouter(t)
	token := completeSetup(t, h)
	caID := createCAAs(t, h, token, "CA", "ca.example.com")

	for _, name := range []string{"../../evil", "a/b", ".."} {
		rr := doRequest(t, h, http.MethodPost, "/api/certificates", map[string]interface{}{
			"name":                  name,
			"commonName":            "cn.example.com",
			"type":                  "server",
			"certificateAuthorityId": caID,
		}, token)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("name %q should be rejected, got %d body=%s", name, rr.Code, rr.Body.String())
		}
	}

	if _, err := os.Stat(filepath.Join(filepath.Dir(dataDir), "evil")); err == nil {
		t.Fatal("traversal cert name wrote files outside data dir")
	}
}

func TestImportCARejectsTraversalName(t *testing.T) {
	h, _ := newTestRouter(t)
	token := completeSetup(t, h)

	rr := doRequest(t, h, http.MethodPost, "/api/ca/import", map[string]interface{}{
		"name":    "../../evil",
		"certPem": "CERT",
		"keyPem":  "KEY",
	}, token)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("traversal import name should be rejected, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestDotsInNameAllowed(t *testing.T) {
	h, _ := newTestRouter(t)
	token := completeSetup(t, h)

	rr := doRequest(t, h, http.MethodPost, "/api/ca", map[string]interface{}{
		"name":         "web.server.prod",
		"commonName":   "cn.example.com",
		"keyAlgorithm": "rsa",
	}, token)
	if rr.Code != http.StatusCreated {
		t.Fatalf("name with dots should be allowed, got %d body=%s", rr.Code, rr.Body.String())
	}
}
