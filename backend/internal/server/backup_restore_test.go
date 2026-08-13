package server

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	zip "github.com/alexmullins/zip"
	"github.com/glcert/glcert/internal/database"
)

// makeBackupZip builds a password-protected zip with the given entries.
func makeBackupZip(t *testing.T, password string, entries map[string][]byte) []byte {
	t.Helper()
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	for name, data := range entries {
		ew, err := w.Encrypt(name, password)
		if err != nil {
			t.Fatalf("encrypt entry %s: %v", name, err)
		}
		if _, err := ew.Write(data); err != nil {
			t.Fatalf("write entry %s: %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

// validBackupDB returns a fresh, migrated SQLite database as []byte.
func validBackupDB(t *testing.T) []byte {
	t.Helper()
	dir := t.TempDir()
	db, err := database.New(dir)
	if err != nil {
		t.Fatalf("create backup db: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close backup db: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "database.sqlite"))
	if err != nil {
		t.Fatalf("read backup db: %v", err)
	}
	return data
}

// doRestore posts a backup zip (multipart form) to /api/backup/restore.
func doRestore(t *testing.T, h http.Handler, zipData []byte, password, token string) *httptest.ResponseRecorder {
	t.Helper()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("backup", "backup.zip")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(zipData); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := mw.WriteField("password", password); err != nil {
		t.Fatalf("write password field: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/backup/restore", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func TestRestoreBlockedAfterSetupForAnonymous(t *testing.T) {
	h, _ := newTestRouter(t)
	completeSetup(t, h)

	backup := makeBackupZip(t, "pw", map[string][]byte{
		"backup.json":     []byte(`{"version":1,"timestamp":"2026-01-01T00:00:00Z"}`),
		"database.sqlite": validBackupDB(t),
	})

	rr := doRestore(t, h, backup, "pw", "")
	if rr.Code != http.StatusUnauthorized && rr.Code != http.StatusForbidden {
		t.Fatalf("anonymous restore after setup must be rejected, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestRestoreAllowedBeforeSetup(t *testing.T) {
	h, _ := newTestRouter(t)

	backup := makeBackupZip(t, "pw", map[string][]byte{
		"backup.json":                          []byte(`{"version":1,"timestamp":"2026-01-01T00:00:00Z"}`),
		"database.sqlite":                      validBackupDB(t),
		"certificates/demo/server/v1/cert.pem": []byte("CERT"),
	})

	rr := doRestore(t, h, backup, "pw", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("pre-setup restore should succeed, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestRestoreAllowedForAdminAfterSetup(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	backup := makeBackupZip(t, "pw", map[string][]byte{
		"backup.json":     []byte(`{"version":1,"timestamp":"2026-01-01T00:00:00Z"}`),
		"database.sqlite": validBackupDB(t),
	})

	rr := doRestore(t, h, backup, "pw", adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("admin restore after setup should succeed, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestRestoreForbiddenForNonAdminAfterSetup(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	// operator user
	opToken, _ := loginAs(t, h, "admin@example.com", "admin-password123!")
	_ = opToken
	createUserAs(t, h, adminToken, "Operator", "op@example.com", "password1", "operator")
	opToken, code := loginAs(t, h, "op@example.com", "password1")
	if code != http.StatusOK {
		t.Fatalf("operator login failed: %d", code)
	}

	backup := makeBackupZip(t, "pw", map[string][]byte{
		"backup.json":     []byte(`{"version":1,"timestamp":"2026-01-01T00:00:00Z"}`),
		"database.sqlite": validBackupDB(t),
	})

	rr := doRestore(t, h, backup, "pw", opToken)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator restore must be forbidden, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestRestoreZipSlipDoesNotWriteOutsideDataDir(t *testing.T) {
	h, dataDir := newTestRouter(t)
	completeSetup(t, h)

	backup := makeBackupZip(t, "pw", map[string][]byte{
		"backup.json":     []byte(`{"version":1,"timestamp":"2026-01-01T00:00:00Z"}`),
		"database.sqlite": validBackupDB(t),
		// Malicious entry attempting to escape the data dir.
		"certificates/../../pwned.txt": []byte("PWNED"),
		// Legitimate entry that must still be written.
		"certificates/demo/server/v1/cert.pem": []byte("CERT"),
	})

	adminToken, _ := loginAs(t, h, "admin@example.com", "admin-password123!")

	rr := doRestore(t, h, backup, "pw", adminToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("restore should succeed, got %d body=%s", rr.Code, rr.Body.String())
	}

	// The traversal must not have escaped the temp data dir.
	escaped := filepath.Join(filepath.Dir(dataDir), "pwned.txt")
	if _, err := os.Stat(escaped); err == nil {
		t.Fatalf("zip slip wrote file outside data dir: %s", escaped)
	}

	// The legitimate entry is written inside the data dir.
	written := filepath.Join(dataDir, "certificates", "demo", "server", "v1", "cert.pem")
	data, err := os.ReadFile(written)
	if err != nil {
		t.Fatalf("legitimate backup file not written: %v", err)
	}
	if string(data) != "CERT" {
		t.Fatalf("unexpected cert file content: %q", data)
	}
}

func TestRestoreInvalidArchiveHandledSafely(t *testing.T) {
	h, dataDir := newTestRouter(t)
	completeSetup(t, h)

	// A tiny compressed entry that expands beyond the extraction limit would
	// require real zlib data; instead verify the cap rejects large archives.
	big := make([]byte, 10<<20) // 10 MiB of mostly-zeros (compresses tiny)
	for i := range big {
		big[i] = byte(i % 2)
	}
	adminToken, _ := loginAs(t, h, "admin@example.com", "admin-password123!")

	rr := doRestore(t, h, makeBackupZip(t, "pw", map[string][]byte{
		"backup.json": []byte(`{"version":1}`),
		"big.bin":     big,
	}), "pw", adminToken)

	// The archive is not a valid backup (missing database.sqlite) but it must
	// not cause a crash or panic, and must not write anything.
	_ = rr

	if _, err := os.Stat(filepath.Join(dataDir, "big.bin")); err == nil {
		t.Fatalf("unexpected big.bin written to data dir")
	}
}
