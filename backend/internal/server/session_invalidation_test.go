package server

import (
	"net/http"
	"testing"
)

func TestChangePasswordInvalidatesSessions(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	// Second active session for the same admin user.
	secondToken, code := loginAs(t, h, "admin@example.com", "admin-password123!")
	if code != http.StatusOK {
		t.Fatalf("second login failed: %d", code)
	}

	rr := doRequest(t, h, http.MethodPut, "/api/auth/password", map[string]string{
		"currentPassword": "admin-password123!",
		"newPassword":     "brand-new-password456!",
	}, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("change password failed: %d body=%s", rr.Code, rr.Body.String())
	}

	for _, tok := range []string{adminToken, secondToken} {
		if r := doRequest(t, h, http.MethodGet, "/api/users", nil, tok); r.Code != http.StatusUnauthorized {
			t.Errorf("session %q must be invalidated after password change, got %d", tok[:8], r.Code)
		}
	}

	// Old password no longer works, new one does.
	if _, code := loginAs(t, h, "admin@example.com", "admin-password123!"); code != http.StatusUnauthorized {
		t.Errorf("old password must be rejected, got %d", code)
	}
	if _, code := loginAs(t, h, "admin@example.com", "brand-new-password456!"); code != http.StatusOK {
		t.Errorf("new password must work, got %d", code)
	}
}

func TestAdminResetPasswordInvalidatesSessions(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	opID := createUserAs(t, h, adminToken, "Operator", "op@example.com", "operator-pass1", "operator")
	opToken, code := loginAs(t, h, "op@example.com", "operator-pass1")
	if code != http.StatusOK {
		t.Fatalf("operator login failed: %d", code)
	}

	rr := doRequest(t, h, http.MethodPost, "/api/users/"+opID+"/reset-password", map[string]string{
		"password": "operator-reset-pass2",
	}, adminToken)
	if rr.Code != http.StatusOK && rr.Code != http.StatusCreated {
		t.Fatalf("admin reset password failed: %d body=%s", rr.Code, rr.Body.String())
	}

	if r := doRequest(t, h, http.MethodGet, "/api/users", nil, opToken); r.Code != http.StatusUnauthorized {
		t.Errorf("operator session must be invalidated after admin reset, got %d", r.Code)
	}

	if _, code := loginAs(t, h, "op@example.com", "operator-pass1"); code != http.StatusUnauthorized {
		t.Errorf("old operator password must be rejected, got %d", code)
	}
	if _, code := loginAs(t, h, "op@example.com", "operator-reset-pass2"); code != http.StatusOK {
		t.Errorf("new operator password must work, got %d", code)
	}
}
