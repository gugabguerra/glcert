package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/glcert/glcert/internal/config"
	"github.com/glcert/glcert/internal/database"
	"github.com/glcert/glcert/internal/services"
)

// newTestRouter builds a fully wired router backed by an isolated temp data dir.
func newTestRouter(t *testing.T) (http.Handler, string) {
	t.Helper()
	dataDir := t.TempDir()

	db, err := database.New(dataDir)
	if err != nil {
		t.Fatalf("database.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	crypto := services.NewCryptoService(dataDir)
	cfg := &config.Config{Port: "0", DataDir: dataDir}

	staticHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	return SetupRouter(db, crypto, cfg, staticHandler), dataDir
}

// doRequest performs an HTTP request against the test router.
func doRequest(t *testing.T, h http.Handler, method, path string, body interface{}, token string) *httptest.ResponseRecorder {
	t.Helper()

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

// decodeJSON decodes a JSON response body into v.
func decodeJSON(t *testing.T, rr *httptest.ResponseRecorder, v interface{}) {
	t.Helper()
	if err := json.Unmarshal(rr.Body.Bytes(), v); err != nil {
		t.Fatalf("decode response %q: %v", rr.Body.String(), err)
	}
}

// completeSetup performs the initial setup and returns the admin session token.
func completeSetup(t *testing.T, h http.Handler) string {
	t.Helper()
	rr := doRequest(t, h, http.MethodPost, "/api/auth/setup", map[string]string{
		"password":             "admin-password123!",
		"encryptionPassphrase": "encryption-passphrase-123",
		"organization":         "TestOrg",
		"email":                "admin@example.com",
	}, "")
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("setup failed: status=%d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Token string `json:"token"`
	}
	decodeJSON(t, rr, &resp)
	if resp.Token == "" {
		t.Fatalf("setup returned no token: %s", rr.Body.String())
	}
	return resp.Token
}

// loginAs logs in with the given credentials.
func loginAs(t *testing.T, h http.Handler, email, password string) (string, int) {
	t.Helper()
	rr := doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"email":    email,
		"password": password,
	}, "")
	if rr.Code != http.StatusOK {
		return "", rr.Code
	}
	var resp struct {
		Token string `json:"token"`
	}
	decodeJSON(t, rr, &resp)
	return resp.Token, rr.Code
}

// createUserAs creates a user with the given role and returns the user ID.
func createUserAs(t *testing.T, h http.Handler, adminToken, name, email, password, role string) string {
	t.Helper()
	rr := doRequest(t, h, http.MethodPost, "/api/users", map[string]string{
		"name":     name,
		"email":    email,
		"password": password,
		"role":     role,
	}, adminToken)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create user %s failed: status=%d body=%s", email, rr.Code, rr.Body.String())
	}
	var user struct {
		ID string `json:"id"`
	}
	decodeJSON(t, rr, &user)
	return user.ID
}

// createCAAs creates a CA via the API and returns its ID.
func createCAAs(t *testing.T, h http.Handler, token, name, commonName string) string {
	t.Helper()
	rr := doRequest(t, h, http.MethodPost, "/api/ca", map[string]interface{}{
		"name":         name,
		"commonName":   commonName,
		"keyAlgorithm": "rsa",
		"rsaKeySize":   2048,
		"validityDays": 1825,
	}, token)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create CA %s failed: status=%d body=%s", name, rr.Code, rr.Body.String())
	}
	var resp struct {
		ID string `json:"id"`
	}
	decodeJSON(t, rr, &resp)
	if resp.ID == "" {
		t.Fatalf("create CA returned no id: %s", rr.Body.String())
	}
	return resp.ID
}

// grantCAPermission grants a user access to a CA (admin only).
func grantCAPermission(t *testing.T, h http.Handler, adminToken, caID, userID string) {
	t.Helper()
	rr := doRequest(t, h, http.MethodPut, "/api/ca/"+caID+"/permissions", map[string]interface{}{
		"userIds": []string{userID},
	}, adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("grant permission failed: status=%d body=%s", rr.Code, rr.Body.String())
	}
}

// createCertAs creates a certificate under a CA and returns its ID.
func createCertAs(t *testing.T, h http.Handler, token, name, commonName, caID string) string {
	t.Helper()
	rr := doRequest(t, h, http.MethodPost, "/api/certificates", map[string]interface{}{
		"name":                   name,
		"commonName":             commonName,
		"type":                   "server",
		"certificateAuthorityId": caID,
		"keyAlgorithm":           "rsa",
		"rsaKeySize":             2048,
		"validityDays":           365,
	}, token)
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("create cert %s failed: status=%d body=%s", name, rr.Code, rr.Body.String())
	}
	var resp struct {
		ID string `json:"id"`
	}
	decodeJSON(t, rr, &resp)
	if resp.ID == "" {
		t.Fatalf("create cert returned no id: %s", rr.Body.String())
	}
	return resp.ID
}

// apiPath builds an /api-prefixed path.
func apiPath(p string) string {
	if !strings.HasPrefix(p, "/api") {
		return "/api" + p
	}
	return p
}
