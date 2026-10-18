package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gugabguerra/glcert/internal/database"
	"github.com/gugabguerra/glcert/internal/services"
)

// seedDashboard creates three root CAs, each with one valid, one
// expiring-soon and one expired certificate, a child CA under the first root
// with one valid certificate, and one unassigned certificate. It returns the
// handler, the auth service and the root CA ids.
func seedDashboard(t *testing.T) (*Handler, *services.AuthService, []string) {
	t.Helper()
	dataDir := t.TempDir()
	db, err := database.New(dataDir)
	if err != nil {
		t.Fatalf("database.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	now := time.Now()
	exec := func(q string, args ...interface{}) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	addCert := func(id string, caID interface{}, expires time.Time) {
		exec(`INSERT INTO certificates (id, name, type, certificate_authority_id) VALUES (?, ?, 'server', ?)`, id, id, caID)
		exec(`INSERT INTO certificate_versions (certificate_id, version, storage_path, serial_number,
			fingerprint, signature_algorithm, public_key_algorithm, expires_at)
			VALUES (?, 1, '', ?, ?, '', '', ?)`, id, id, id, expires)
	}

	caIDs := []string{"ca-a", "ca-b", "ca-c"}
	for _, ca := range caIDs {
		exec(`INSERT INTO certificate_authorities (id, name, subject, expires_at) VALUES (?, ?, ?, ?)`,
			ca, ca, "CN="+ca, now.AddDate(5, 0, 0))
		addCert(ca+"-valid", ca, now.AddDate(1, 0, 0))
		addCert(ca+"-expiring", ca, now.AddDate(0, 0, 10))
		addCert(ca+"-expired", ca, now.AddDate(0, 0, -1))
	}
	exec(`INSERT INTO certificate_authorities (id, name, subject, expires_at, parent_ca_id) VALUES (?, ?, ?, ?, ?)`,
		"ca-a-child", "ca-a-child", "CN=ca-a-child", now.AddDate(5, 0, 0), "ca-a")
	addCert("ca-a-child-valid", "ca-a-child", now.AddDate(1, 0, 0))
	addCert("unassigned", nil, now.AddDate(1, 0, 0))

	auth := services.NewAuthService(db)
	return New(db, services.NewCryptoService(dataDir), auth), auth, caIDs
}

func getDashboard(t *testing.T, h *Handler, userID string) (int, DashboardStats) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard", nil)
	req = req.WithContext(context.WithValue(req.Context(), UserIDKey, userID))
	rr := httptest.NewRecorder()
	h.GetDashboardStats(rr, req)

	var stats DashboardStats
	if rr.Code == http.StatusOK {
		if err := json.NewDecoder(rr.Body).Decode(&stats); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return rr.Code, stats
}

func TestDashboardStatsScopedToAccessibleCAs(t *testing.T) {
	h, auth, caIDs := seedDashboard(t)

	admin, err := auth.CreateUser("Admin", "admin@example.test", "password-123", "admin")
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	operator, err := auth.CreateUser("Op", "op@example.test", "password-123", "operator")
	if err != nil {
		t.Fatalf("create operator: %v", err)
	}
	unassigned, err := auth.CreateUser("None", "none@example.test", "password-123", "operator")
	if err != nil {
		t.Fatalf("create unassigned operator: %v", err)
	}
	if err := auth.SetCAPermissions(caIDs[0], []string{operator.ID}); err != nil {
		t.Fatalf("set permissions: %v", err)
	}

	cases := []struct {
		name   string
		userID string
		want   DashboardStats
	}{
		// 4 CAs; 3 roots × 3 certs + child cert + unassigned; 3 expiring, 3 expired.
		{"admin sees everything", admin.ID, DashboardStats{CACount: 4, CertificateCount: 11, ExpiringSoon: 3, Expired: 3}},
		// Assigned root + its child CA; their 4 certs + the unassigned one,
		// matching the CA and certificate lists.
		{"operator sees assigned CA and its child only", operator.ID, DashboardStats{CACount: 2, CertificateCount: 5, ExpiringSoon: 1, Expired: 1}},
		{"operator without CAs", unassigned.ID, DashboardStats{CACount: 0, CertificateCount: 1, ExpiringSoon: 0, Expired: 0}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, got := getDashboard(t, h, tc.userID)
			if code != http.StatusOK {
				t.Fatalf("status = %d, want 200", code)
			}
			if got != tc.want {
				t.Fatalf("stats = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestDashboardStatsFailsClosed(t *testing.T) {
	h, _, _ := seedDashboard(t)

	// No user in context: nothing is counted.
	code, got := getDashboard(t, h, "")
	if code != http.StatusOK || got != (DashboardStats{}) {
		t.Fatalf("anonymous: status %d stats %+v, want 200 and zero stats", code, got)
	}

	// Unknown user: role lookup fails, so the handler refuses instead of
	// reporting global totals.
	code, _ = getDashboard(t, h, "no-such-user")
	if code != http.StatusInternalServerError {
		t.Fatalf("unknown user: status %d, want 500", code)
	}
}

func TestListsFailClosedOnPermissionLookupError(t *testing.T) {
	h, auth, _ := seedDashboard(t)
	caHandler := NewCAHandler(h.db, nil, h.crypto, auth)
	certHandler := NewCertHandler(h.db, nil, nil, h.crypto, auth)

	// An unknown user makes the role lookup fail; lists must refuse rather
	// than fall back to unfiltered results.
	for name, list := range map[string]http.HandlerFunc{
		"ca list":   caHandler.List,
		"cert list": certHandler.List,
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req = req.WithContext(context.WithValue(req.Context(), UserIDKey, "no-such-user"))
			rr := httptest.NewRecorder()
			list(rr, req)
			if rr.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500", rr.Code)
			}
		})
	}

	cond, args, filtered := certHandler.accessibleCAFilter("no-such-user")
	if !filtered || cond != "1 = 0" || len(args) != 0 {
		t.Fatalf("accessibleCAFilter = (%q, %v, %v), want impossible filter", cond, args, filtered)
	}
}
