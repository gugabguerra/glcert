package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"

	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/gugabguerra/glcert/internal/models"
)

const (
	// MaxPasskeys bounds how many passkeys one account can register.
	MaxPasskeys = 10
	// maxPasskeyName bounds the label a user gives a passkey.
	maxPasskeyName = 64
	// ceremonyLifetime is how long a registration or sign-in challenge stays
	// answerable. It matches the pending sign-in window.
	ceremonyLifetime = 5 * time.Minute
)

var (
	ErrPasskeysUnavailable = errors.New("passkeys are not available on this server address")
	ErrPasskeyNotFound     = errors.New("passkey not found")
	ErrPasskeyLimit        = fmt.Errorf("an account can hold at most %d passkeys", MaxPasskeys)
	ErrNoPasskeyCeremony   = errors.New("no passkey request in progress; start again")
	ErrPasskeyRejected     = errors.New("passkey verification failed")
)

// PasskeyService registers WebAuthn credentials and checks them as the second
// sign-in factor, after the password.
//
// The relying party is fixed at startup from the configured public URL (or
// http://localhost:<port> without one). Request headers never decide which
// origin a passkey is accepted from.
type PasskeyService struct {
	db *sql.DB
	// wa is nil when the configured address cannot host passkeys.
	wa *webauthn.WebAuthn
	// origin is the one browser origin passkeys are accepted from.
	origin string

	// Challenges live in memory only, like sessions: a restart drops them.
	mu            sync.Mutex
	registrations map[string]ceremony // by user ID
	logins        map[string]ceremony // by pending sign-in token
}

type ceremony struct {
	session webauthn.SessionData
	expires time.Time
}

// NewPasskeyService builds the service for the origin users reach the server
// at. An address browsers refuse passkeys on (plain HTTP off localhost, or a
// bare IP) leaves the service unavailable instead of failing startup.
func NewPasskeyService(db *sql.DB, publicURL, port string) *PasskeyService {
	s := &PasskeyService{
		db:            db,
		registrations: map[string]ceremony{},
		logins:        map[string]ceremony{},
	}

	origin := publicURL
	if origin == "" {
		origin = "http://localhost:" + port
	}
	rpID, rpOrigin, err := relyingParty(origin)
	if err != nil {
		logger.Infof("Passkeys unavailable: %v", err)
		return s
	}

	wa, err := webauthn.New(&webauthn.Config{
		RPID:                  rpID,
		RPDisplayName:         "GLcert",
		RPOrigins:             []string{rpOrigin},
		AttestationPreference: protocol.PreferNoAttestation,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationPreferred,
		},
		// Browsers and password managers add extension outputs nobody asked
		// for (credProps is common). They carry no authority here, so they are
		// ignored rather than turned into failed sign-ins.
		ExtensionsUnsolicitedOutputPolicy: protocol.UnsolicitedOutputPolicyIgnore,
	})
	if err != nil {
		logger.Infof("Passkeys unavailable: %v", err)
		return s
	}
	s.wa = wa
	s.origin = rpOrigin
	return s
}

// relyingParty derives the WebAuthn relying party ID and origin from a base
// URL. Browsers only allow passkeys in a secure context and never for an IP
// address, so anything else is rejected up front.
func relyingParty(base string) (rpID, origin string, err error) {
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" {
		return "", "", fmt.Errorf("%q is not a usable origin", base)
	}
	host := strings.ToLower(u.Hostname())
	if net.ParseIP(host) != nil {
		return "", "", errors.New("the server address is an IP address; passkeys need a host name")
	}
	local := host == "localhost" || strings.HasSuffix(host, ".localhost")
	if u.Scheme != "https" && !local {
		return "", "", errors.New("the server address is not HTTPS")
	}
	return host, u.Scheme + "://" + strings.ToLower(u.Host), nil
}

// Available reports whether this server address can host passkeys.
func (s *PasskeyService) Available() bool {
	return s.wa != nil
}

// Origin returns the one browser origin passkeys are accepted from, or "" when
// they are unavailable. It is configuration, not a secret: the page compares
// it with its own address so a mismatch is explained before the browser asks.
func (s *PasskeyService) Origin() string {
	return s.origin
}

// passkeyUser adapts an account to the library's user interface.
type passkeyUser struct {
	id          string
	email       string
	name        string
	credentials []webauthn.Credential
}

func (u *passkeyUser) WebAuthnID() []byte   { return []byte(u.id) }
func (u *passkeyUser) WebAuthnName() string { return u.email }
func (u *passkeyUser) WebAuthnDisplayName() string {
	if u.name != "" {
		return u.name
	}
	return u.email
}
func (u *passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

func (s *PasskeyService) loadUser(userID string) (*passkeyUser, error) {
	u := &passkeyUser{id: userID}
	if err := s.db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).Scan(&u.email, &u.name); err != nil {
		return nil, fmt.Errorf("load user: %w", err)
	}

	rows, err := s.db.Query("SELECT credential FROM passkeys WHERE user_id = ? ORDER BY created_at ASC", userID)
	if err != nil {
		return nil, fmt.Errorf("load passkeys: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("load passkeys: %w", err)
		}
		var cred webauthn.Credential
		if err := json.Unmarshal([]byte(raw), &cred); err != nil {
			return nil, fmt.Errorf("decode passkey: %w", err)
		}
		u.credentials = append(u.credentials, cred)
	}
	return u, rows.Err()
}

// List returns the user's passkeys, oldest first.
func (s *PasskeyService) List(userID string) ([]models.Passkey, error) {
	rows, err := s.db.Query("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at ASC", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Non-nil so the JSON listing is [] rather than null.
	passkeys := []models.Passkey{}
	for rows.Next() {
		var p models.Passkey
		var lastUsed sql.NullTime
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &lastUsed); err != nil {
			return nil, err
		}
		if lastUsed.Valid {
			p.LastUsedAt = &lastUsed.Time
		}
		passkeys = append(passkeys, p)
	}
	return passkeys, rows.Err()
}

// Count returns how many passkeys the user has registered.
func (s *PasskeyService) Count(userID string) int {
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM passkeys WHERE user_id = ?", userID).Scan(&n)
	return n
}

// BeginRegistration issues the options the browser needs to create a passkey
// and remembers the challenge for FinishRegistration.
func (s *PasskeyService) BeginRegistration(userID string) (*protocol.CredentialCreation, error) {
	if s.wa == nil {
		return nil, ErrPasskeysUnavailable
	}
	user, err := s.loadUser(userID)
	if err != nil {
		return nil, err
	}
	if len(user.credentials) >= MaxPasskeys {
		return nil, ErrPasskeyLimit
	}

	// Excluding what is already registered stops one authenticator from being
	// added twice under different names.
	creation, session, err := s.wa.BeginRegistration(user,
		webauthn.WithExclusions(webauthn.Credentials(user.credentials).CredentialDescriptors()),
	)
	if err != nil {
		return nil, fmt.Errorf("begin passkey registration: %w", err)
	}

	s.mu.Lock()
	prune(s.registrations)
	s.registrations[userID] = ceremony{session: *session, expires: time.Now().Add(ceremonyLifetime)}
	s.mu.Unlock()
	return creation, nil
}

// FinishRegistration verifies the browser's answer to BeginRegistration and
// stores the new passkey under name.
func (s *PasskeyService) FinishRegistration(userID, name string, response []byte) (*models.Passkey, error) {
	if s.wa == nil {
		return nil, ErrPasskeysUnavailable
	}
	// Single use: the challenge is spent whether or not the answer verifies.
	session, ok := s.take(s.registrations, userID)
	if !ok {
		return nil, ErrNoPasskeyCeremony
	}

	user, err := s.loadUser(userID)
	if err != nil {
		return nil, err
	}
	if len(user.credentials) >= MaxPasskeys {
		return nil, ErrPasskeyLimit
	}

	parsed, err := protocol.ParseCredentialCreationResponseBytes(response)
	if err != nil {
		return nil, ErrPasskeyRejected
	}
	cred, err := s.wa.CreateCredential(user, session, parsed)
	if err != nil {
		logger.Warnf("Passkey registration rejected: %s", describe(err))
		return nil, ErrPasskeyRejected
	}

	raw, err := json.Marshal(cred)
	if err != nil {
		return nil, fmt.Errorf("encode passkey: %w", err)
	}

	passkey := &models.Passkey{
		ID:        uuid.NewString(),
		Name:      cleanPasskeyName(name),
		CreatedAt: time.Now().UTC(),
	}
	// credential_id is UNIQUE, so a credential already held by any account is
	// refused here even if the authenticator ignored the exclusion list.
	_, err = s.db.Exec("INSERT INTO passkeys (id, user_id, credential_id, name, credential, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		passkey.ID, userID, cred.ID, passkey.Name, string(raw), passkey.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("save passkey: %w", err)
	}
	return passkey, nil
}

// Remove deletes one of the user's passkeys. When it was the last second
// factor on the account, the backup codes go with it.
func (s *PasskeyService) Remove(userID, passkeyID string) error {
	res, err := s.db.Exec("DELETE FROM passkeys WHERE id = ? AND user_id = ?", passkeyID, userID)
	if err != nil {
		return fmt.Errorf("remove passkey: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return ErrPasskeyNotFound
	}

	_, err = s.db.Exec(`DELETE FROM backup_codes WHERE user_id = ?
		AND NOT EXISTS (SELECT 1 FROM passkeys WHERE passkeys.user_id = backup_codes.user_id)
		AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = backup_codes.user_id AND users.totp_enabled = TRUE)`, userID)
	if err != nil {
		return fmt.Errorf("delete backup codes: %w", err)
	}
	return nil
}

// BeginLogin issues the options the browser needs to sign with one of the
// user's passkeys. The challenge is tied to the pending sign-in token.
func (s *PasskeyService) BeginLogin(pendingToken, userID string) (*protocol.CredentialAssertion, error) {
	if s.wa == nil {
		return nil, ErrPasskeysUnavailable
	}
	user, err := s.loadUser(userID)
	if err != nil {
		return nil, err
	}
	if len(user.credentials) == 0 {
		return nil, ErrPasskeyNotFound
	}

	assertion, session, err := s.wa.BeginLogin(user)
	if err != nil {
		return nil, fmt.Errorf("begin passkey sign-in: %w", err)
	}

	s.mu.Lock()
	prune(s.logins)
	s.logins[pendingToken] = ceremony{session: *session, expires: time.Now().Add(ceremonyLifetime)}
	s.mu.Unlock()
	return assertion, nil
}

// FinishLogin verifies the browser's answer to BeginLogin. A nil error means
// the user proved possession of one of their passkeys.
func (s *PasskeyService) FinishLogin(pendingToken, userID string, response []byte) error {
	if s.wa == nil {
		return ErrPasskeysUnavailable
	}
	// Single use: a challenge can never be answered twice.
	session, ok := s.take(s.logins, pendingToken)
	if !ok {
		return ErrNoPasskeyCeremony
	}

	user, err := s.loadUser(userID)
	if err != nil {
		return err
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return ErrPasskeyRejected
	}
	cred, err := s.wa.ValidateLogin(user, session, parsed)
	if err != nil {
		logger.Warnf("Passkey sign-in rejected: %s", describe(err))
		return ErrPasskeyRejected
	}
	// A signature counter that went backwards means the key exists in two
	// places. Fail closed: the passkey stays refused until it is replaced.
	if cred.Authenticator.CloneWarning {
		logger.Warnf("Passkey sign-in rejected: signature counter went backwards (possible cloned authenticator)")
		return ErrPasskeyRejected
	}

	raw, err := json.Marshal(cred)
	if err != nil {
		return fmt.Errorf("encode passkey: %w", err)
	}
	if _, err := s.db.Exec("UPDATE passkeys SET credential = ?, last_used_at = ? WHERE user_id = ? AND credential_id = ?",
		string(raw), time.Now().UTC(), userID, cred.ID); err != nil {
		return fmt.Errorf("update passkey: %w", err)
	}
	return nil
}

// take removes and returns the live ceremony stored under key.
func (s *PasskeyService) take(ceremonies map[string]ceremony, key string) (webauthn.SessionData, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := ceremonies[key]
	delete(ceremonies, key)
	if !ok || time.Now().After(c.expires) {
		return webauthn.SessionData{}, false
	}
	return c.session, true
}

// prune drops expired ceremonies. The caller holds the lock.
func prune(ceremonies map[string]ceremony) {
	now := time.Now()
	for key, c := range ceremonies {
		if now.After(c.expires) {
			delete(ceremonies, key)
		}
	}
}

// cleanPasskeyName trims the user's label to something safe to list.
func cleanPasskeyName(name string) string {
	name = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name))
	if name == "" {
		return "Passkey"
	}
	if runes := []rune(name); len(runes) > maxPasskeyName {
		name = strings.TrimSpace(string(runes[:maxPasskeyName]))
	}
	return name
}

// describe renders a library error for the log. Only the library's fixed
// description of the failed check is used: its debug text echoes values the
// client sent (challenge, origin), and client text never reaches the log.
func describe(err error) string {
	var perr *protocol.Error
	if errors.As(err, &perr) && perr.Details != "" {
		return perr.Details
	}
	return "verification failed"
}
