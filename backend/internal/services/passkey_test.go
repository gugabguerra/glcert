package services

import "testing"

func TestRelyingParty(t *testing.T) {
	cases := []struct {
		base, rpID, origin string
		ok                 bool
	}{
		{"https://pki.example.com", "pki.example.com", "https://pki.example.com", true},
		{"https://PKI.Example.com:8443/glcert", "pki.example.com", "https://pki.example.com:8443", true},
		{"http://localhost:18080", "localhost", "http://localhost:18080", true},
		{"http://glcert.localhost:18080", "glcert.localhost", "http://glcert.localhost:18080", true},
		// Browsers refuse passkeys on these, so the server does not offer them.
		{"http://pki.example.com", "", "", false},
		{"https://192.0.2.10", "", "", false},
		{"http://127.0.0.1:18080", "", "", false},
		{"https://[2001:db8::1]", "", "", false},
		{"not a url", "", "", false},
	}
	for _, c := range cases {
		rpID, origin, err := relyingParty(c.base)
		if (err == nil) != c.ok || rpID != c.rpID || origin != c.origin {
			t.Errorf("relyingParty(%q) = %q, %q, %v; want %q, %q, ok=%v", c.base, rpID, origin, err, c.rpID, c.origin, c.ok)
		}
	}
}

func TestCleanPasskeyName(t *testing.T) {
	long := make([]rune, 100)
	for i := range long {
		long[i] = 'é'
	}
	cases := map[string]string{
		"":              "Passkey",
		"  \t\n":        "Passkey",
		" YubiKey 5C ":  "YubiKey 5C",
		"Mac\x00Book\n": "MacBook",
		string(long):    string(long[:maxPasskeyName]),
	}
	for in, want := range cases {
		if got := cleanPasskeyName(in); got != want {
			t.Errorf("cleanPasskeyName(%q) = %q, want %q", in, got, want)
		}
	}
}
