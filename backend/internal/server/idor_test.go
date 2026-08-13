package server

import (
	"net/http"
	"testing"
)

// setupIDORScenario creates an admin, a viewer and an operator, plus two CAs.
// caA is granted to viewer+operator, caB is not.
func setupIDORScenario(t *testing.T) (http.Handler, string, string, string, string, string) {
	t.Helper()
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	viewerID := createUserAs(t, h, adminToken, "Viewer", "viewer@example.com", "password1", "viewer")
	opID := createUserAs(t, h, adminToken, "Operator", "op@example.com", "password1", "operator")

	caA := createCAAs(t, h, adminToken, "CA-A", "ca-a.example.com")
	caB := createCAAs(t, h, adminToken, "CA-B", "ca-b.example.com")

	// SetCAPermissions replaces the whole grant list, so grant both at once.
	rr := doRequest(t, h, http.MethodPut, "/api/ca/"+caA+"/permissions", map[string]interface{}{
		"userIds": []string{viewerID, opID},
	}, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("grant permissions failed: %d body=%s", rr.Code, rr.Body.String())
	}

	viewerToken, _ := loginAs(t, h, "viewer@example.com", "password1")
	opToken, _ := loginAs(t, h, "op@example.com", "password1")

	return h, adminToken, viewerToken, opToken, caA, caB
}

func TestViewerCannotDownloadUnauthorizedCAKey(t *testing.T) {
	h, _, viewerToken, _, caA, caB := setupIDORScenario(t)

	rr := doRequest(t, h, http.MethodGet, "/api/ca/"+caA+"/download/key", nil, viewerToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("viewer with permission should download CA key, got %d body=%s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodGet, "/api/ca/"+caB+"/download/key", nil, viewerToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("viewer without permission must be forbidden from CA key, got %d", rr.Code)
	}
}

func TestViewerCannotDownloadUnauthorizedCABundle(t *testing.T) {
	h, _, viewerToken, _, _, caB := setupIDORScenario(t)

	rr := doRequest(t, h, http.MethodGet, "/api/ca/"+caB+"/download/bundle", nil, viewerToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("viewer without permission must be forbidden from CA bundle, got %d", rr.Code)
	}
}

func TestOperatorCannotDownloadUnauthorizedCAKey(t *testing.T) {
	h, _, _, opToken, _, caB := setupIDORScenario(t)

	rr := doRequest(t, h, http.MethodGet, "/api/ca/"+caB+"/download/key", nil, opToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator without CA permission must be forbidden, got %d", rr.Code)
	}
}

func TestAdminCanDownloadAnyCAKey(t *testing.T) {
	h, adminToken, _, _, _, caB := setupIDORScenario(t)

	rr := doRequest(t, h, http.MethodGet, "/api/ca/"+caB+"/download/key", nil, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("admin should download any CA key, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestCertAccessRespectedOnDownloadAndDetail(t *testing.T) {
	h, adminToken, viewerToken, _, _, caB := setupIDORScenario(t)

	// cert under unauthorized CA caB (created by admin)
	certB := createCertAs(t, h, adminToken, "cert-b", "cert-b.example.com", caB)

	// viewer must be forbidden from detail + key download
	rr := doRequest(t, h, http.MethodGet, "/api/certificates/"+certB, nil, viewerToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("viewer must be forbidden from unauthorized cert detail, got %d", rr.Code)
	}
	rr = doRequest(t, h, http.MethodGet, "/api/certificates/"+certB+"/download/key", nil, viewerToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("viewer must be forbidden from unauthorized cert key, got %d", rr.Code)
	}
}

func TestCertAccessAllowedForGrantedViewer(t *testing.T) {
	h, adminToken, viewerToken, _, caA, _ := setupIDORScenario(t)

	certA := createCertAs(t, h, adminToken, "cert-a", "cert-a.example.com", caA)

	rr := doRequest(t, h, http.MethodGet, "/api/certificates/"+certA, nil, viewerToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("viewer should access cert of granted CA, got %d body=%s", rr.Code, rr.Body.String())
	}
	rr = doRequest(t, h, http.MethodGet, "/api/certificates/"+certA+"/download/key", nil, viewerToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("viewer should download key of granted CA cert, got %d", rr.Code)
	}
}

func TestShareLinkGenerationRespectsAccess(t *testing.T) {
	h, _, viewerToken, _, caA, caB := setupIDORScenario(t)

	rr := doRequest(t, h, http.MethodPost, "/api/share/ca/"+caA, map[string]string{"fileType": "key"}, viewerToken)
	if rr.Code != http.StatusCreated {
		t.Fatalf("viewer should share accessible CA, got %d body=%s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodPost, "/api/share/ca/"+caB, map[string]string{"fileType": "key"}, viewerToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("viewer must be forbidden from sharing unauthorized CA, got %d", rr.Code)
	}
}

func TestShareLinkGenerationOnUnauthorizedCertForbidden(t *testing.T) {
	h, adminToken, viewerToken, _, _, caB := setupIDORScenario(t)

	certB := createCertAs(t, h, adminToken, "cert-b2", "cert-b2.example.com", caB)

	rr := doRequest(t, h, http.MethodPost, "/api/share/certificate/"+certB, map[string]string{"fileType": "key"}, viewerToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("viewer must be forbidden from sharing unauthorized cert, got %d", rr.Code)
	}
}

func TestListGroupsFilteredByAccess(t *testing.T) {
	h, adminToken, _, opToken, caA, caB := setupIDORScenario(t)

	certSharedA := createCertAs(t, h, adminToken, "cert-shared-a", "shared-a.example.com", caA)
	certSecretB := createCertAs(t, h, adminToken, "cert-secret-b", "secret-b.example.com", caB)
	createCertAs(t, h, adminToken, "cert-mine", "mine.example.com", caA)

	// Assign groups: "shared" contains an accessible + unauthorized cert,
	// "secret" contains ONLY unauthorized certs.
	setGroup(t, h, adminToken, certSharedA, "shared")
	setGroup(t, h, adminToken, certSecretB, "secret")

	rr := doRequest(t, h, http.MethodGet, "/api/certificates/groups", nil, opToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("list groups failed: %d body=%s", rr.Code, rr.Body.String())
	}

	var groups []struct {
		Name string `json:"name"`
	}
	decodeJSON(t, rr, &groups)

	found := map[string]bool{}
	for _, g := range groups {
		found[g.Name] = true
	}
	if found["secret"] {
		t.Fatalf("operator must not see groups whose certs are all unauthorized: %+v", groups)
	}
	if !found["shared"] {
		t.Fatalf("operator should see group containing an accessible cert: %+v", groups)
	}
}

func setGroup(t *testing.T, h http.Handler, token, certID, group string) {
	t.Helper()
	rr := doRequest(t, h, http.MethodPatch, "/api/certificates/"+certID, map[string]string{
		"groupName": group,
	}, token)
	if rr.Code != http.StatusOK {
		t.Fatalf("set group %q failed: %d body=%s", group, rr.Code, rr.Body.String())
	}
}