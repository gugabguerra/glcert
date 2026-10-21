package server

import (
	"net/http"
	"strings"
	"testing"
)

type auditRow struct {
	UserID     *string `json:"userId"`
	UserEmail  *string `json:"userEmail"`
	Action     string  `json:"action"`
	EntityType *string `json:"entityType"`
	EntityID   *string `json:"entityId"`
	Details    string  `json:"details"`
}

func listAudit(t *testing.T, h http.Handler, token string) []auditRow {
	t.Helper()
	rr := doRequest(t, h, http.MethodGet, "/api/audit?limit=100", nil, token)
	if rr.Code != http.StatusOK {
		t.Fatalf("list audit: status=%d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Entries []auditRow `json:"entries"`
	}
	decodeJSON(t, rr, &resp)
	return resp.Entries
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// TestAuditLogRecordsStateChanges performs a series of administrative and
// certificate operations and checks each one leaves an attributed audit row
// without any secret in it.
func TestAuditLogRecordsStateChanges(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	const userPassword = "operator-secret-pw1"
	const resetPassword = "reset-secret-pw2"
	userID := createUserAs(t, h, adminToken, "Op", "op@example.com", userPassword, "operator")

	rr := doRequest(t, h, http.MethodPut, "/api/users/"+userID, map[string]string{"role": "viewer"}, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("change role: status=%d body=%s", rr.Code, rr.Body.String())
	}
	rr = doRequest(t, h, http.MethodPost, "/api/users/"+userID+"/reset-password", map[string]string{"password": resetPassword}, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("reset password: status=%d body=%s", rr.Code, rr.Body.String())
	}

	caID := createCAAs(t, h, adminToken, "audit-ca", "audit-ca.example.com")
	grantCAPermission(t, h, adminToken, caID, userID)
	certID := createCertAs(t, h, adminToken, "audit-leaf", "leaf.example.com", caID)
	rr = doRequest(t, h, http.MethodPost, "/api/certificates/"+certID+"/regenerate", map[string]int{"validityDays": 30}, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("regenerate: status=%d body=%s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodGet, "/api/settings", nil, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("get settings: status=%d", rr.Code)
	}
	var settings map[string]interface{}
	decodeJSON(t, rr, &settings)
	settings["smtpPassword"] = "smtp-secret-pw3"
	rr = doRequest(t, h, http.MethodPut, "/api/settings", settings, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("update settings: status=%d body=%s", rr.Code, rr.Body.String())
	}

	for _, path := range []string{"/api/certificates/" + certID, "/api/users/" + userID, "/api/ca/" + caID} {
		rr = doRequest(t, h, http.MethodDelete, path, nil, adminToken)
		if rr.Code != http.StatusNoContent {
			t.Fatalf("delete %s: status=%d body=%s", path, rr.Code, rr.Body.String())
		}
	}

	want := []struct {
		action, entityType, entityID, details string
	}{
		{"user.create", "user", userID, "op@example.com (operator)"},
		{"user.role_change", "user", userID, "op@example.com: operator → viewer"},
		{"user.password_reset", "user", userID, "op@example.com"},
		{"ca.create", "ca", caID, "audit-ca"},
		{"ca.permissions.update", "ca", caID, "audit-ca: 1 user(s) granted"},
		{"certificate.create", "certificate", certID, "audit-leaf"},
		{"certificate.regenerate", "certificate", certID, "audit-leaf (v2)"},
		{"settings.update", "settings", "1", "Settings updated"},
		{"certificate.delete", "certificate", certID, "audit-leaf"},
		{"user.delete", "user", userID, "op@example.com"},
		{"ca.delete", "ca", caID, "audit-ca"},
	}

	entries := listAudit(t, h, adminToken)
	byAction := map[string]auditRow{}
	for _, e := range entries {
		byAction[e.Action] = e
		for _, secret := range []string{userPassword, resetPassword, "smtp-secret-pw3", adminToken} {
			if strings.Contains(e.Details, secret) {
				t.Errorf("%s: details leak a secret: %q", e.Action, e.Details)
			}
		}
	}
	if len(entries) != len(want) {
		t.Errorf("got %d audit rows, want %d: %+v", len(entries), len(want), entries)
	}
	for _, w := range want {
		e, ok := byAction[w.action]
		if !ok {
			t.Errorf("missing audit row %q", w.action)
			continue
		}
		if str(e.EntityType) != w.entityType || str(e.EntityID) != w.entityID || e.Details != w.details {
			t.Errorf("%s: got (%s, %s, %q), want (%s, %s, %q)", w.action,
				str(e.EntityType), str(e.EntityID), e.Details, w.entityType, w.entityID, w.details)
		}
		if str(e.UserID) == "" || str(e.UserEmail) != "admin@example.com" {
			t.Errorf("%s: actor = (%q, %q), want the admin", w.action, str(e.UserID), str(e.UserEmail))
		}
	}
}

// TestAuditFailedOperationNotLogged checks rejected requests leave no row.
func TestAuditFailedOperationNotLogged(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	rr := doRequest(t, h, http.MethodPost, "/api/ca", map[string]interface{}{"name": "../evil", "commonName": "x"}, adminToken)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
	if entries := listAudit(t, h, adminToken); len(entries) != 0 {
		t.Fatalf("expected no audit rows, got %+v", entries)
	}
}

// TestAuditFactoryResetSurvives checks the factory_reset row is written after
// the wipe, so it is the first entry of the fresh log.
func TestAuditFactoryResetSurvives(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)
	createCAAs(t, h, adminToken, "gone-ca", "gone.example.com")

	rr := doRequest(t, h, http.MethodPost, "/api/admin/factory-reset", nil, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("factory reset: status=%d body=%s", rr.Code, rr.Body.String())
	}

	newToken := completeSetup(t, h)
	entries := listAudit(t, h, newToken)
	if len(entries) != 1 || entries[0].Action != "factory_reset" {
		t.Fatalf("expected only a factory_reset row, got %+v", entries)
	}
	if str(entries[0].UserEmail) != "admin@example.com" {
		t.Fatalf("factory_reset actor email = %q", str(entries[0].UserEmail))
	}
}
