package server

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
)

func operatorToken(t *testing.T, h http.Handler, admin string) (string, string) {
	t.Helper()
	id := createUserAs(t, h, admin, "Op", "op@example.com", "operator-password-1!", "operator")
	token, code := loginAs(t, h, "op@example.com", "operator-password-1!")
	if code != http.StatusOK {
		t.Fatalf("operator login: %d", code)
	}
	return token, id
}

func TestOperatorCannotDeleteUngrantedCA(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	caID := createCAAs(t, h, admin, "protected-ca", "protected.example.com")
	op, _ := operatorToken(t, h, admin)

	rr := doRequest(t, h, http.MethodDelete, "/api/ca/"+caID, nil, op)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator must not delete an ungranted CA, got %d", rr.Code)
	}
	if rr = doRequest(t, h, http.MethodGet, "/api/ca/"+caID, nil, admin); rr.Code != http.StatusOK {
		t.Fatalf("CA must still exist, got %d", rr.Code)
	}
}

func TestOperatorCannotSignUnderUngrantedParent(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	parentID := createCAAs(t, h, admin, "parent-ca", "parent.example.com")
	op, _ := operatorToken(t, h, admin)

	rr := doRequest(t, h, http.MethodPost, "/api/ca", map[string]interface{}{
		"name": "rogue-intermediate", "commonName": "rogue.example.com",
		"keyAlgorithm": "rsa", "rsaKeySize": 2048, "validityDays": 365, "parentCaId": parentID,
	}, op)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("operator must not sign under an ungranted parent, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestDuplicateCANameIsRejected(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	caID := createCAAs(t, h, admin, "Prod", "prod.example.com")
	before := doRequest(t, h, http.MethodGet, "/api/ca/"+caID+"/download/key", nil, admin).Body.String()

	for _, name := range []string{"Prod", "prod"} {
		rr := doRequest(t, h, http.MethodPost, "/api/ca", map[string]interface{}{
			"name": name, "commonName": "other.example.com",
			"keyAlgorithm": "rsa", "rsaKeySize": 2048, "validityDays": 365,
		}, admin)
		if rr.Code != http.StatusConflict {
			t.Fatalf("duplicate name %q must be rejected, got %d", name, rr.Code)
		}
	}
	after := doRequest(t, h, http.MethodGet, "/api/ca/"+caID+"/download/key", nil, admin).Body.String()
	if before != after {
		t.Fatal("existing CA key must not be overwritten")
	}
}

func TestDotNameIsRejected(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	rr := doRequest(t, h, http.MethodPost, "/api/ca", map[string]interface{}{
		"name": ".", "commonName": "dot.example.com",
		"keyAlgorithm": "rsa", "rsaKeySize": 2048, "validityDays": 365,
	}, admin)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf(`name "." must be rejected, got %d`, rr.Code)
	}
}

func createShareLink(t *testing.T, h http.Handler, token, caID string) string {
	t.Helper()
	rr := doRequest(t, h, http.MethodPost, "/api/share/ca/"+caID, map[string]string{"fileType": "certificate"}, token)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create share link: %d %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Token string `json:"token"`
	}
	decodeJSON(t, rr, &resp)
	return resp.Token
}

func TestShareLinkIsSingleUseUnderConcurrency(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	caID := createCAAs(t, h, admin, "share-ca", "share.example.com")
	token := createShareLink(t, h, admin, caID)

	var mu sync.Mutex
	served := 0
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if doRequest(t, h, http.MethodGet, "/api/share/"+token, nil, "").Code == http.StatusOK {
				mu.Lock()
				served++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if served != 1 {
		t.Fatalf("share link must be served exactly once, got %d", served)
	}
}

func TestShareEmailNeedsAKnownTokenAndPublicURL(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	caID := createCAAs(t, h, admin, "mail-ca", "mail.example.com")
	token := createShareLink(t, h, admin, caID)

	// The test router has no PUBLIC_URL, so nothing can be emailed.
	rr := doRequest(t, h, http.MethodPost, "/api/share/send-email", map[string]string{
		"email": "someone@example.com", "token": token, "fileName": "mail-ca.crt",
	}, admin)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("without PUBLIC_URL the email must be refused, got %d", rr.Code)
	}
	// A client-supplied URL is no longer accepted at all.
	rr = doRequest(t, h, http.MethodPost, "/api/share/send-email", map[string]string{
		"email": "someone@example.com", "url": "https://evil.example/phish", "fileName": "x",
	}, admin)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("a request without a token must be rejected, got %d", rr.Code)
	}
}

func TestOversizedJSONBodyIsRejected(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	big := make([]byte, 2<<20)
	for i := range big {
		big[i] = 'a'
	}
	rr := doRequest(t, h, http.MethodPut, "/api/settings", map[string]string{"organization": string(big)}, admin)
	if rr.Code != http.StatusBadRequest && rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized settings body must be rejected, got %d", rr.Code)
	}
}

func enableTOTP(t *testing.T, h http.Handler, token string) string {
	t.Helper()
	rr := doRequest(t, h, http.MethodGet, "/api/totp/setup", nil, token)
	var setup struct {
		Secret string `json:"secret"`
	}
	decodeJSON(t, rr, &setup)

	// Client-chosen values are ignored: only the code is used.
	code, _ := totp.GenerateCode(setup.Secret, time.Now())
	rr = doRequest(t, h, http.MethodPost, "/api/totp/verify-setup", map[string]interface{}{
		"code": code, "secret": "JBSWY3DPEHPK3PXP", "codes": []string{"00000000"},
	}, token)
	if rr.Code != http.StatusOK {
		t.Fatalf("verify-setup: %d %s", rr.Code, rr.Body.String())
	}
	return setup.Secret
}

func TestTOTPPendingSignInBurnsAfterFailedAttempts(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	secret := enableTOTP(t, h, admin)

	rr := doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"email": "admin@example.com", "password": "admin-password123!",
	}, "")
	var login struct {
		PartialToken string `json:"partialToken"`
	}
	decodeJSON(t, rr, &login)

	// The per-IP limiter would stop us first; vary the client address so the
	// per-token limit is what is tested.
	verify := func(code string, i int) int {
		req := map[string]string{"partialToken": login.PartialToken, "code": code}
		return doRequestFrom(t, h, http.MethodPost, "/api/totp/verify", req, i)
	}
	for i := 0; i < 5; i++ {
		if got := verify("000000", i); got != http.StatusUnauthorized {
			t.Fatalf("wrong code %d: got %d", i, got)
		}
	}
	good, _ := totp.GenerateCode(secret, time.Now())
	if got := verify(good, 99); got != http.StatusUnauthorized {
		t.Fatalf("pending sign-in must be burned after 5 failures, got %d", got)
	}
}

func TestBackupCodeFromClientIsNotAccepted(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	enableTOTP(t, h, admin)

	rr := doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"email": "admin@example.com", "password": "admin-password123!",
	}, "")
	var login struct {
		PartialToken string `json:"partialToken"`
	}
	decodeJSON(t, rr, &login)
	if got := doRequestFrom(t, h, http.MethodPost, "/api/totp/verify", map[string]string{
		"partialToken": login.PartialToken, "code": "00000000",
	}, 1); got != http.StatusUnauthorized {
		t.Fatalf("client-chosen backup code must not work, got %d", got)
	}
}
