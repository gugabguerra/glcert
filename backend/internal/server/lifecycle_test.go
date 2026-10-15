package server

import (
	"net/http"
	"strings"
	"testing"
)

// TestCALifecycle walks a CA from creation through the read and download
// endpoints to deletion, and confirms the record is gone afterwards.
func TestCALifecycle(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	caID := createCAAs(t, h, adminToken, "lifecycle-ca", "lifecycle-ca.example.com")
	if caID == "" {
		t.Fatal("expected a non-empty CA id from createCAAs")
	}

	// The list endpoint must report the freshly created CA.
	rr := doRequest(t, h, http.MethodGet, "/api/ca", nil, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected CA list to succeed, got %d body=%s", rr.Code, rr.Body.String())
	}
	var cas []map[string]interface{}
	decodeJSON(t, rr, &cas)
	found := false
	for _, ca := range cas {
		if ca["id"] == caID {
			found = true
			if ca["name"] != "lifecycle-ca" {
				t.Fatalf("expected listed CA name to be lifecycle-ca, got %v", ca["name"])
			}
			break
		}
	}
	if !found {
		t.Fatalf("expected the new CA to be listed, got %d entries: %s", len(cas), rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodGet, "/api/ca/"+caID, nil, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected CA detail to succeed, got %d body=%s", rr.Code, rr.Body.String())
	}

	for _, download := range []string{"cert", "key", "bundle"} {
		rr = doRequest(t, h, http.MethodGet, "/api/ca/"+caID+"/download/"+download, nil, adminToken)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected CA %s download to succeed, got %d body=%s", download, rr.Code, rr.Body.String())
		}
	}

	rr = doRequest(t, h, http.MethodDelete, "/api/ca/"+caID, nil, adminToken)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected CA delete to return 204, got %d body=%s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodGet, "/api/ca/"+caID, nil, adminToken)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected deleted CA detail to return 404, got %d body=%s", rr.Code, rr.Body.String())
	}
}

// TestCertLifecycle walks a certificate through issue, version history,
// regenerate, restore, downloads and deletion.
func TestCertLifecycle(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	caID := createCAAs(t, h, adminToken, "lifecycle-ca", "lifecycle-ca.example.com")
	certID := createCertAs(t, h, adminToken, "lifecycle-cert", "lifecycle-cert.example.com", caID)
	if certID == "" {
		t.Fatal("expected a non-empty certificate id from createCertAs")
	}

	rr := doRequest(t, h, http.MethodGet, "/api/certificates/"+certID, nil, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected certificate detail to succeed, got %d body=%s", rr.Code, rr.Body.String())
	}

	// A freshly issued certificate has exactly one version.
	rr = doRequest(t, h, http.MethodGet, "/api/certificates/"+certID+"/versions", nil, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected certificate versions to succeed, got %d body=%s", rr.Code, rr.Body.String())
	}
	var versions []interface{}
	decodeJSON(t, rr, &versions)
	if len(versions) != 1 {
		t.Fatalf("expected 1 certificate version after issue, got %d: %s", len(versions), rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodPost, "/api/certificates/"+certID+"/regenerate", map[string]int{"validityDays": 365}, adminToken)
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("expected certificate regenerate to succeed, got %d body=%s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodGet, "/api/certificates/"+certID+"/versions", nil, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected certificate versions to succeed after regenerate, got %d body=%s", rr.Code, rr.Body.String())
	}
	decodeJSON(t, rr, &versions)
	if len(versions) != 2 {
		t.Fatalf("expected 2 certificate versions after regenerate, got %d: %s", len(versions), rr.Body.String())
	}

	// Restoring the original version is a quiet success.
	rr = doRequest(t, h, http.MethodPost, "/api/certificates/"+certID+"/versions/1/restore", nil, adminToken)
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK && rr.Code != http.StatusNoContent {
		t.Fatalf("expected version restore to succeed, got %d body=%s", rr.Code, rr.Body.String())
	}

	for _, download := range []string{"cert", "key", "ca", "bundle"} {
		rr = doRequest(t, h, http.MethodGet, "/api/certificates/"+certID+"/download/"+download, nil, adminToken)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected certificate %s download to succeed, got %d body=%s", download, rr.Code, rr.Body.String())
		}
	}

	rr = doRequest(t, h, http.MethodDelete, "/api/certificates/"+certID, nil, adminToken)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected certificate delete to return 204, got %d body=%s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodGet, "/api/certificates/"+certID, nil, adminToken)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected deleted certificate detail to return 404, got %d body=%s", rr.Code, rr.Body.String())
	}
}

// TestSessionFlow checks that the setup session authenticates requests, that a
// missing token is rejected, that logout invalidates the session, and that a
// wrong password never yields a token.
func TestSessionFlow(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	rr := doRequest(t, h, http.MethodGet, "/api/users/me", nil, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected the session token to authenticate /api/users/me, got %d body=%s", rr.Code, rr.Body.String())
	}

	// The same request without a token must be rejected.
	rr = doRequest(t, h, http.MethodGet, "/api/users/me", nil, "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected an empty token to be unauthorized, got %d body=%s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodPost, "/api/auth/logout", nil, adminToken)
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK && rr.Code != http.StatusNoContent {
		t.Fatalf("expected logout to succeed, got %d body=%s", rr.Code, rr.Body.String())
	}

	// The token must no longer work once the session is closed.
	rr = doRequest(t, h, http.MethodGet, "/api/users/me", nil, adminToken)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected the logged out token to be unauthorized, got %d body=%s", rr.Code, rr.Body.String())
	}

	// A wrong password must never produce a session.
	rr = doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"email":    "admin@example.com",
		"password": "not-the-password",
	}, "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected a wrong password to be unauthorized, got %d body=%s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "token") {
		t.Fatalf("expected no token from a wrong password, got body=%s", rr.Body.String())
	}
}
