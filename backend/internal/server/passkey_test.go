package server

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/pquerna/otp/totp"

	"github.com/gugabguerra/glcert/internal/config"
	"github.com/gugabguerra/glcert/internal/database"
	"github.com/gugabguerra/glcert/internal/services"
)

// testOrigin is where the test router believes it is served: no PUBLIC_URL
// and port "0" (see newTestRouterAt).
const testOrigin = "http://localhost:0"

const adminEmail, adminPassword = "admin@example.com", "admin-password123!"

// softAuthenticator is a software WebAuthn authenticator: one ES256 key that
// answers registration and sign-in challenges the way a browser would.
type softAuthenticator struct {
	key     *ecdsa.PrivateKey
	id      []byte
	counter uint32
	origin  string
}

func newSoftAuthenticator(t *testing.T) *softAuthenticator {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	id := make([]byte, 16)
	rand.Read(id)
	return &softAuthenticator{key: key, id: id, origin: testOrigin}
}

var b64 = base64.RawURLEncoding

func (a *softAuthenticator) clientData(t *testing.T, kind, challenge string) []byte {
	t.Helper()
	data, err := json.Marshal(map[string]interface{}{
		"type": kind, "challenge": challenge, "origin": a.origin, "crossOrigin": false,
	})
	if err != nil {
		t.Fatalf("marshal client data: %v", err)
	}
	return data
}

// authData builds authenticator data for rpID "localhost": user present and
// verified, plus the attested credential when attested is set.
func (a *softAuthenticator) authData(t *testing.T, attested bool) []byte {
	t.Helper()
	rpHash := sha256.Sum256([]byte("localhost"))
	flags := byte(0x01 | 0x04)
	if attested {
		flags |= 0x40
	}
	data := append(rpHash[:], flags)
	data = binary.BigEndian.AppendUint32(data, a.counter)
	if !attested {
		return data
	}

	pub, err := a.key.PublicKey.Bytes() // 0x04 || X || Y
	if err != nil {
		t.Fatalf("encode public key: %v", err)
	}
	cose, err := webauthncbor.Marshal(webauthncose.EC2PublicKeyData{
		PublicKeyData: webauthncose.PublicKeyData{KeyType: 2, Algorithm: -7},
		Curve:         1,
		XCoord:        pub[1:33],
		YCoord:        pub[33:65],
	})
	if err != nil {
		t.Fatalf("encode COSE key: %v", err)
	}
	data = append(data, make([]byte, 16)...) // zero AAGUID
	data = binary.BigEndian.AppendUint16(data, uint16(len(a.id)))
	data = append(data, a.id...)
	return append(data, cose...)
}

// attestation answers a registration challenge with a "none" attestation.
func (a *softAuthenticator) attestation(t *testing.T, challenge string) map[string]interface{} {
	t.Helper()
	object, err := webauthncbor.Marshal(map[string]interface{}{
		"fmt": "none", "attStmt": map[string]interface{}{}, "authData": a.authData(t, true),
	})
	if err != nil {
		t.Fatalf("encode attestation: %v", err)
	}
	return map[string]interface{}{
		"id": b64.EncodeToString(a.id), "rawId": b64.EncodeToString(a.id), "type": "public-key",
		"response": map[string]interface{}{
			"clientDataJSON":    b64.EncodeToString(a.clientData(t, "webauthn.create", challenge)),
			"attestationObject": b64.EncodeToString(object),
		},
		"clientExtensionResults": map[string]interface{}{},
	}
}

// assertion answers a sign-in challenge, advancing the signature counter.
func (a *softAuthenticator) assertion(t *testing.T, challenge string) map[string]interface{} {
	t.Helper()
	a.counter++
	authData := a.authData(t, false)
	clientData := a.clientData(t, "webauthn.get", challenge)
	clientHash := sha256.Sum256(clientData)
	digest := sha256.Sum256(append(append([]byte{}, authData...), clientHash[:]...))
	sig, err := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return map[string]interface{}{
		"id": b64.EncodeToString(a.id), "rawId": b64.EncodeToString(a.id), "type": "public-key",
		"response": map[string]interface{}{
			"clientDataJSON":    b64.EncodeToString(clientData),
			"authenticatorData": b64.EncodeToString(authData),
			"signature":         b64.EncodeToString(sig),
		},
		"clientExtensionResults": map[string]interface{}{},
	}
}

type challengeOptions struct {
	PublicKey struct {
		Challenge        string              `json:"challenge"`
		RP               struct{ ID string } `json:"rp"`
		RPID             string              `json:"rpId"`
		AllowCredentials []struct {
			ID string `json:"id"`
		} `json:"allowCredentials"`
	} `json:"publicKey"`
}

type registerResult struct {
	Passkey struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"passkey"`
	BackupCodes []string `json:"backupCodes"`
}

// registerPasskey registers the authenticator for the signed-in user.
func registerPasskey(t *testing.T, h http.Handler, token string, a *softAuthenticator, name string) registerResult {
	t.Helper()
	rr := doRequest(t, h, http.MethodPost, "/api/passkeys/register/begin", nil, token)
	if rr.Code != http.StatusOK {
		t.Fatalf("register begin: %d %s", rr.Code, rr.Body.String())
	}
	var options challengeOptions
	decodeJSON(t, rr, &options)
	if options.PublicKey.RP.ID != "localhost" {
		t.Fatalf("rp id = %q, want localhost", options.PublicKey.RP.ID)
	}

	rr = doRequest(t, h, http.MethodPost, "/api/passkeys/register/finish", map[string]interface{}{
		"name": name, "credential": a.attestation(t, options.PublicKey.Challenge),
	}, token)
	if rr.Code != http.StatusOK {
		t.Fatalf("register finish: %d %s", rr.Code, rr.Body.String())
	}
	var result registerResult
	decodeJSON(t, rr, &result)
	return result
}

type pendingLogin struct {
	Token        string   `json:"token"`
	PartialToken string   `json:"partialToken"`
	Methods      []string `json:"methods"`
}

func passwordLogin(t *testing.T, h http.Handler, email, password string) pendingLogin {
	t.Helper()
	rr := doRequest(t, h, http.MethodPost, "/api/auth/login", map[string]string{"email": email, "password": password}, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rr.Code, rr.Body.String())
	}
	var login pendingLogin
	decodeJSON(t, rr, &login)
	return login
}

// passkeyChallenge asks for a sign-in challenge from client address i.
func passkeyChallenge(t *testing.T, h http.Handler, partialToken string, i int) string {
	t.Helper()
	rr := doRequestFromFull(t, h, "/api/passkeys/login/begin", map[string]string{"partialToken": partialToken}, i)
	if rr.Code != http.StatusOK {
		t.Fatalf("login begin: %d %s", rr.Code, rr.Body.String())
	}
	var options challengeOptions
	decodeJSON(t, rr, &options)
	if len(options.PublicKey.AllowCredentials) == 0 {
		t.Fatalf("login begin listed no credentials: %s", rr.Body.String())
	}
	return options.PublicKey.Challenge
}

func passkeyFinish(t *testing.T, h http.Handler, partialToken string, credential map[string]interface{}, i int) (int, string) {
	t.Helper()
	rr := doRequestFromFull(t, h, "/api/passkeys/login/finish", map[string]interface{}{
		"partialToken": partialToken, "credential": credential,
	}, i)
	var resp struct {
		Token string `json:"token"`
	}
	if rr.Code == http.StatusOK {
		decodeJSON(t, rr, &resp)
	}
	return rr.Code, resp.Token
}

func TestPasskeyRegisterAndSignIn(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	auth := newSoftAuthenticator(t)

	result := registerPasskey(t, h, admin, auth, "  Laptop\n ")
	if result.Passkey.Name != "Laptop" {
		t.Fatalf("name = %q, want it trimmed to Laptop", result.Passkey.Name)
	}
	// First second factor on the account: backup codes come with it.
	if len(result.BackupCodes) != 10 {
		t.Fatalf("got %d backup codes, want 10", len(result.BackupCodes))
	}

	rr := doRequest(t, h, http.MethodGet, "/api/passkeys", nil, admin)
	var list struct {
		Available bool   `json:"available"`
		Origin    string `json:"origin"`
		Passkeys  []struct {
			ID         string  `json:"id"`
			LastUsedAt *string `json:"lastUsedAt"`
		} `json:"passkeys"`
	}
	decodeJSON(t, rr, &list)
	if !list.Available || list.Origin != "http://localhost:0" || len(list.Passkeys) != 1 || list.Passkeys[0].LastUsedAt != nil {
		t.Fatalf("unexpected listing: %s", rr.Body.String())
	}
	// The stored public key and counter never leave the server.
	if body := rr.Body.String(); len(body) > 400 {
		t.Fatalf("listing is larger than its fields explain: %s", body)
	}

	login := passwordLogin(t, h, adminEmail, adminPassword)
	if login.Token != "" || login.PartialToken == "" {
		t.Fatalf("password alone must not open a passkey account: %+v", login)
	}
	if len(login.Methods) != 1 || login.Methods[0] != "passkey" {
		t.Fatalf("methods = %v, want [passkey]", login.Methods)
	}

	// The pending token is not a session.
	if rr := doRequest(t, h, http.MethodGet, "/api/users/me", nil, login.PartialToken); rr.Code != http.StatusUnauthorized {
		t.Fatalf("pending token opened an authenticated route: %d", rr.Code)
	}

	assertion := auth.assertion(t, passkeyChallenge(t, h, login.PartialToken, 1))
	code, session := passkeyFinish(t, h, login.PartialToken, assertion, 1)
	if code != http.StatusOK || session == "" {
		t.Fatalf("passkey sign-in failed: %d", code)
	}

	rr = doRequest(t, h, http.MethodGet, "/api/users/me", nil, session)
	var me struct {
		PasskeyCount int `json:"passkeyCount"`
	}
	decodeJSON(t, rr, &me)
	if rr.Code != http.StatusOK || me.PasskeyCount != 1 {
		t.Fatalf("session after passkey sign-in: %d %s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, h, http.MethodGet, "/api/passkeys", nil, session)
	decodeJSON(t, rr, &list)
	if list.Passkeys[0].LastUsedAt == nil {
		t.Fatalf("lastUsedAt not recorded: %s", rr.Body.String())
	}

	// The same signed answer is worthless afterwards: challenge and pending
	// token are both spent.
	if code, _ := passkeyFinish(t, h, login.PartialToken, assertion, 2); code != http.StatusUnauthorized {
		t.Fatalf("replayed assertion: got %d", code)
	}
}

func TestPasskeyAssertionCannotBeReplayedWithinPendingSignIn(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	auth := newSoftAuthenticator(t)
	registerPasskey(t, h, admin, auth, "Key")

	login := passwordLogin(t, h, adminEmail, adminPassword)
	stale := auth.assertion(t, passkeyChallenge(t, h, login.PartialToken, 1))
	// A new challenge replaces the old one; the answer to the old one fails.
	fresh := passkeyChallenge(t, h, login.PartialToken, 2)
	if code, _ := passkeyFinish(t, h, login.PartialToken, stale, 3); code != http.StatusUnauthorized {
		t.Fatalf("answer to a superseded challenge: got %d", code)
	}
	// That failure spent the fresh challenge as well: one answer per challenge.
	if code, _ := passkeyFinish(t, h, login.PartialToken, auth.assertion(t, fresh), 4); code != http.StatusUnauthorized {
		t.Fatalf("challenge must be single-use, got %d", code)
	}
}

func TestPasskeyRejectsForgedAssertions(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	auth := newSoftAuthenticator(t)
	registerPasskey(t, h, admin, auth, "Key")

	cases := map[string]func(challenge string) map[string]interface{}{
		"wrong origin": func(challenge string) map[string]interface{} {
			phish := *auth
			phish.origin = "https://glcert.evil.example"
			return phish.assertion(t, challenge)
		},
		"wrong key": func(challenge string) map[string]interface{} {
			other := newSoftAuthenticator(t)
			other.id = auth.id
			return other.assertion(t, challenge)
		},
		"unknown credential": func(challenge string) map[string]interface{} {
			return newSoftAuthenticator(t).assertion(t, challenge)
		},
		"wrong challenge": func(string) map[string]interface{} {
			return auth.assertion(t, b64.EncodeToString(make([]byte, 32)))
		},
	}
	i := 0
	for name, forge := range cases {
		login := passwordLogin(t, h, adminEmail, adminPassword)
		i += 2
		challenge := passkeyChallenge(t, h, login.PartialToken, i)
		if code, _ := passkeyFinish(t, h, login.PartialToken, forge(challenge), i+1); code != http.StatusUnauthorized {
			t.Fatalf("%s: got %d, want 401", name, code)
		}
	}
}

func TestPasskeyPendingSignInBurnsAfterFailedAttempts(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	auth := newSoftAuthenticator(t)
	registerPasskey(t, h, admin, auth, "Key")

	login := passwordLogin(t, h, adminEmail, adminPassword)
	for i := 0; i < 5; i++ {
		challenge := passkeyChallenge(t, h, login.PartialToken, 10+i)
		if code, _ := passkeyFinish(t, h, login.PartialToken, newSoftAuthenticator(t).assertion(t, challenge), 20+i); code != http.StatusUnauthorized {
			t.Fatalf("forged attempt %d: got %d", i, code)
		}
	}
	rr := doRequestFromFull(t, h, "/api/passkeys/login/begin", map[string]string{"partialToken": login.PartialToken}, 40)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("pending sign-in must be burned after 5 failures, got %d", rr.Code)
	}
}

func TestPasskeyCounterRollbackIsRejected(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	auth := newSoftAuthenticator(t)
	auth.counter = 10
	registerPasskey(t, h, admin, auth, "Key")

	login := passwordLogin(t, h, adminEmail, adminPassword)
	if code, _ := passkeyFinish(t, h, login.PartialToken, auth.assertion(t, passkeyChallenge(t, h, login.PartialToken, 1)), 2); code != http.StatusOK {
		t.Fatalf("first sign-in: got %d", code)
	}

	// A copy of the key that never saw the last sign-in reports an old counter.
	clone := *auth
	clone.counter = 3
	login = passwordLogin(t, h, adminEmail, adminPassword)
	if code, _ := passkeyFinish(t, h, login.PartialToken, clone.assertion(t, passkeyChallenge(t, h, login.PartialToken, 3)), 4); code != http.StatusUnauthorized {
		t.Fatalf("rolled-back counter: got %d, want 401", code)
	}
}

func TestPasskeyBackupCodeRecoversAccount(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	result := registerPasskey(t, h, admin, newSoftAuthenticator(t), "Lost phone")

	verify := func(code string, i int) int {
		login := passwordLogin(t, h, adminEmail, adminPassword)
		return doRequestFrom(t, h, http.MethodPost, "/api/totp/verify", map[string]string{
			"partialToken": login.PartialToken, "code": code,
		}, i)
	}
	if got := verify(result.BackupCodes[0], 1); got != http.StatusOK {
		t.Fatalf("backup code on a passkey-only account: got %d", got)
	}
	if got := verify(result.BackupCodes[0], 2); got != http.StatusUnauthorized {
		t.Fatalf("backup code must work once, got %d", got)
	}

	// A second passkey does not rotate the codes that still work.
	if again := registerPasskey(t, h, admin, newSoftAuthenticator(t), "Spare"); len(again.BackupCodes) != 0 {
		t.Fatalf("backup codes reissued while unused ones remain")
	}
	if got := verify(result.BackupCodes[1], 3); got != http.StatusOK {
		t.Fatalf("earlier backup code stopped working: got %d", got)
	}
}

func TestPasskeyRemoveNeedsPasswordAndOwnership(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	result := registerPasskey(t, h, admin, newSoftAuthenticator(t), "Key")
	path := "/api/passkeys/" + result.Passkey.ID + "/remove"

	createUserAs(t, h, admin, "Other", "other@example.com", "other-password123!", "operator")
	other, _ := loginAs(t, h, "other@example.com", "other-password123!")
	if rr := doRequest(t, h, http.MethodPost, path, map[string]string{"password": "other-password123!"}, other); rr.Code != http.StatusNotFound {
		t.Fatalf("another user's passkey: got %d, want 404", rr.Code)
	}
	if rr := doRequest(t, h, http.MethodPost, path, map[string]string{"password": "wrong"}, admin); rr.Code != http.StatusForbidden {
		t.Fatalf("wrong password: got %d, want 403", rr.Code)
	}
	if rr := doRequest(t, h, http.MethodPost, path, map[string]string{"password": adminPassword}, admin); rr.Code != http.StatusOK {
		t.Fatalf("remove: %d %s", rr.Code, rr.Body.String())
	}

	// No second factor left: the password opens the account again, and the
	// backup codes went with the last passkey.
	login := passwordLogin(t, h, adminEmail, adminPassword)
	if login.Token == "" || login.PartialToken != "" {
		t.Fatalf("expected a plain session after removing the last passkey: %+v", login)
	}
	again := registerPasskey(t, h, login.Token, newSoftAuthenticator(t), "New")
	if len(again.BackupCodes) != 10 {
		t.Fatalf("backup codes should be reissued, got %d", len(again.BackupCodes))
	}
	pending := passwordLogin(t, h, adminEmail, adminPassword)
	if got := doRequestFrom(t, h, http.MethodPost, "/api/totp/verify", map[string]string{
		"partialToken": pending.PartialToken, "code": result.BackupCodes[0],
	}, 7); got != http.StatusUnauthorized {
		t.Fatalf("backup code from the removed set still works: %d", got)
	}
}

func TestPasskeyBelongsToOneAccount(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	adminKey := newSoftAuthenticator(t)
	registerPasskey(t, h, admin, adminKey, "Admin key")

	createUserAs(t, h, admin, "Other", "other@example.com", "other-password123!", "viewer")
	other, _ := loginAs(t, h, "other@example.com", "other-password123!")
	registerPasskey(t, h, other, newSoftAuthenticator(t), "Other key")

	// The other user's pending sign-in cannot be finished with the admin's key.
	login := passwordLogin(t, h, "other@example.com", "other-password123!")
	challenge := passkeyChallenge(t, h, login.PartialToken, 1)
	if code, _ := passkeyFinish(t, h, login.PartialToken, adminKey.assertion(t, challenge), 2); code != http.StatusUnauthorized {
		t.Fatalf("another account's passkey: got %d, want 401", code)
	}

	// One authenticator cannot be registered twice.
	rr := doRequest(t, h, http.MethodPost, "/api/passkeys/register/begin", nil, other)
	var options challengeOptions
	decodeJSON(t, rr, &options)
	rr = doRequest(t, h, http.MethodPost, "/api/passkeys/register/finish", map[string]interface{}{
		"name": "Stolen", "credential": adminKey.attestation(t, options.PublicKey.Challenge),
	}, other)
	if rr.Code == http.StatusOK {
		t.Fatalf("a credential ID held by another account was registered again")
	}
}

func TestTOTPAndPasskeyTogether(t *testing.T) {
	h, _ := newTestRouter(t)
	admin := completeSetup(t, h)
	secret := enableTOTP(t, h, admin)
	auth := newSoftAuthenticator(t)
	// TOTP setup already issued backup codes; the passkey adds none.
	if result := registerPasskey(t, h, admin, auth, "Key"); len(result.BackupCodes) != 0 {
		t.Fatalf("backup codes reissued on top of the TOTP set")
	}

	login := passwordLogin(t, h, adminEmail, adminPassword)
	if len(login.Methods) != 2 || login.Methods[0] != "passkey" || login.Methods[1] != "totp" {
		t.Fatalf("methods = %v, want [passkey totp]", login.Methods)
	}

	// Turning the authenticator app off leaves the passkey, so the account
	// still asks for a second factor.
	code, _ := totp.GenerateCode(secret, time.Now())
	rr := doRequest(t, h, http.MethodPost, "/api/totp/disable", map[string]string{"password": adminPassword, "code": code}, admin)
	if rr.Code != http.StatusOK {
		t.Fatalf("disable totp: %d %s", rr.Code, rr.Body.String())
	}
	login = passwordLogin(t, h, adminEmail, adminPassword)
	if login.Token != "" || len(login.Methods) != 1 || login.Methods[0] != "passkey" {
		t.Fatalf("after disabling TOTP: %+v", login)
	}
	if code, _ := passkeyFinish(t, h, login.PartialToken, auth.assertion(t, passkeyChallenge(t, h, login.PartialToken, 1)), 2); code != http.StatusOK {
		t.Fatalf("passkey sign-in after disabling TOTP: %d", code)
	}
}

func TestPasskeyUnavailableOffSecureOrigin(t *testing.T) {
	dataDir := t.TempDir()
	db, err := database.New(dataDir)
	if err != nil {
		t.Fatalf("database.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	cfg := &config.Config{Port: "0", DataDir: dataDir, PublicURL: "http://pki.example.com"}
	h := SetupRouter(db, services.NewCryptoService(dataDir), cfg, http.NotFoundHandler())
	admin := completeSetup(t, h)

	rr := doRequest(t, h, http.MethodGet, "/api/passkeys", nil, admin)
	var list struct {
		Available bool   `json:"available"`
		Origin    string `json:"origin"`
	}
	decodeJSON(t, rr, &list)
	if list.Available || list.Origin != "" {
		t.Fatalf("passkeys offered on a plain-HTTP public URL")
	}
	if rr := doRequest(t, h, http.MethodPost, "/api/passkeys/register/begin", nil, admin); rr.Code != http.StatusConflict {
		t.Fatalf("register begin on an insecure origin: got %d, want 409", rr.Code)
	}
}

func TestPasskeyRoutesNeedAuthentication(t *testing.T) {
	h, _ := newTestRouter(t)
	completeSetup(t, h)
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/passkeys"},
		{http.MethodPost, "/api/passkeys/register/begin"},
		{http.MethodPost, "/api/passkeys/register/finish"},
		{http.MethodPost, "/api/passkeys/some-id/remove"},
	} {
		if rr := doRequest(t, h, route.method, route.path, map[string]string{}, ""); rr.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s without a session: got %d", route.method, route.path, rr.Code)
		}
	}
	// The sign-in endpoints accept only a live pending token.
	for _, token := range []string{"totp_pending_deadbeef", "not-a-pending-token"} {
		rr := doRequestFromFull(t, h, "/api/passkeys/login/begin", map[string]string{"partialToken": token}, 1)
		if rr.Code != http.StatusUnauthorized && rr.Code != http.StatusBadRequest {
			t.Fatalf("login begin with %q: got %d", token, rr.Code)
		}
	}
}
