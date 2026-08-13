package server

import (
	"net/http"
	"testing"
)

// setupOpScenario: admin, operator (granted caA only), plus caA and caB.
func setupOpScenario(t *testing.T) (http.Handler, string, string, string, string) {
	t.Helper()
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	opID := createUserAs(t, h, adminToken, "Operator", "op@example.com", "password1", "operator")

	caA := createCAAs(t, h, adminToken, "CA-A", "ca-a.example.com")
	caB := createCAAs(t, h, adminToken, "CA-B", "ca-b.example.com")

	doRequest(t, h, http.MethodPut, "/api/ca/"+caA+"/permissions", map[string]interface{}{
		"userIds": []string{opID},
	}, adminToken)

	opToken, _ := loginAs(t, h, "op@example.com", "password1")
	return h, adminToken, opToken, caA, caB
}

func TestOperatorCanCreateCertUnderGrantedCA(t *testing.T) {
	h, _, opToken, caA, _ := setupOpScenario(t)

	rr := doRequest(t, h, http.MethodPost, "/api/certificates", map[string]interface{}{
		"name":                  "ok",
		"commonName":            "ok.example.com",
		"type":                  "server",
		"certificateAuthorityId": caA,
	}, opToken)
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("operator should create cert under granted CA, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestOperatorCannotCreateCertUnderUngrantedCA(t *testing.T) {
	h, _, opToken, _, caB := setupOpScenario(t)

	rr := doRequest(t, h, http.MethodPost, "/api/certificates", map[string]interface{}{
		"name":                  "nope",
		"commonName":            "nope.example.com",
		"type":                  "server",
		"certificateAuthorityId": caB,
	}, opToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator must be forbidden from issuing under ungranted CA, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestOperatorCannotDeleteUngrantedCert(t *testing.T) {
	h, adminToken, opToken, _, caB := setupOpScenario(t)

	certB := createCertAs(t, h, adminToken, "cert-b", "cert-b.example.com", caB)

	rr := doRequest(t, h, http.MethodDelete, "/api/certificates/"+certB, nil, opToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator must be forbidden from deleting ungranted cert, got %d", rr.Code)
	}
}

func TestOperatorCannotRegenerateUngrantedCert(t *testing.T) {
	h, adminToken, opToken, _, caB := setupOpScenario(t)

	certB := createCertAs(t, h, adminToken, "cert-b2", "cert-b2.example.com", caB)

	rr := doRequest(t, h, http.MethodPost, "/api/certificates/"+certB+"/regenerate", map[string]int{"validityDays": 365}, opToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator must be forbidden from regenerating ungranted cert, got %d", rr.Code)
	}
}

func TestOperatorCanDeleteGrantedCert(t *testing.T) {
	h, _, opToken, caA, _ := setupOpScenario(t)

	certA := createCertAs(t, h, opToken, "cert-a", "cert-a.example.com", caA)

	rr := doRequest(t, h, http.MethodDelete, "/api/certificates/"+certA, nil, opToken)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("operator should delete cert under granted CA, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestOperatorCannotImportUnderUngrantedCA(t *testing.T) {
	h, _, opToken, _, caB := setupOpScenario(t)

	rr := doRequest(t, h, http.MethodPost, "/api/certificates/import", map[string]interface{}{
		"name":                  "imported",
		"certPem":               "CERT",
		"keyPem":                "KEY",
		"certificateAuthorityId": caB,
	}, opToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator must be forbidden from importing under ungranted CA, got %d", rr.Code)
	}
}

func TestOperatorCannotUpdateGroupOfUngrantedCert(t *testing.T) {
	h, adminToken, opToken, _, caB := setupOpScenario(t)

	certB := createCertAs(t, h, adminToken, "cert-b3", "cert-b3.example.com", caB)

	rr := doRequest(t, h, http.MethodPatch, "/api/certificates/"+certB, map[string]string{"groupName": "hack"}, opToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator must be forbidden from regrouping ungranted cert, got %d", rr.Code)
	}
}
