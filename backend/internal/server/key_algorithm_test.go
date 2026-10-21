package server

import (
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"testing"
)

// TestCertKeyAlgorithmAPI checks that keyAlgorithm is honoured on issue, kept
// on regenerate, and that the key and bundle downloads work for each one.
func TestCertKeyAlgorithmAPI(t *testing.T) {
	h, _ := newTestRouter(t)
	adminToken := completeSetup(t, h)

	rr := doRequest(t, h, http.MethodPost, "/api/ca", map[string]interface{}{
		"name": "ec-ca", "commonName": "ec-ca.example.com", "keyAlgorithm": "ecdsa",
	}, adminToken)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create ECDSA CA: status=%d body=%s", rr.Code, rr.Body.String())
	}
	var ca struct {
		ID string `json:"id"`
	}
	decodeJSON(t, rr, &ca)

	for _, tc := range []struct {
		alg  string
		want x509.PublicKeyAlgorithm
	}{
		{"rsa", x509.RSA},
		{"ecdsa", x509.ECDSA},
		{"ed25519", x509.Ed25519},
	} {
		t.Run(tc.alg, func(t *testing.T) {
			rr := doRequest(t, h, http.MethodPost, "/api/certificates", map[string]interface{}{
				"name": "leaf-" + tc.alg, "commonName": tc.alg + ".example.com", "type": "server",
				"certificateAuthorityId": ca.ID, "keyAlgorithm": tc.alg,
			}, adminToken)
			if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
				t.Fatalf("create cert: status=%d body=%s", rr.Code, rr.Body.String())
			}
			var cert struct {
				ID string `json:"id"`
			}
			decodeJSON(t, rr, &cert)

			checkAlgo := func(stage string) {
				rr := doRequest(t, h, http.MethodGet, "/api/certificates/"+cert.ID+"/download/cert", nil, adminToken)
				if rr.Code != http.StatusOK {
					t.Fatalf("%s: download cert: status=%d", stage, rr.Code)
				}
				block, _ := pem.Decode(rr.Body.Bytes())
				if block == nil {
					t.Fatalf("%s: decode cert PEM", stage)
				}
				parsed, err := x509.ParseCertificate(block.Bytes)
				if err != nil {
					t.Fatalf("%s: parse cert: %v", stage, err)
				}
				if parsed.PublicKeyAlgorithm != tc.want {
					t.Fatalf("%s: PublicKeyAlgorithm = %v, want %v", stage, parsed.PublicKeyAlgorithm, tc.want)
				}
			}
			checkAlgo("issue")

			rr = doRequest(t, h, http.MethodPost, "/api/certificates/"+cert.ID+"/regenerate", map[string]int{"validityDays": 30}, adminToken)
			if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
				t.Fatalf("regenerate: status=%d body=%s", rr.Code, rr.Body.String())
			}
			checkAlgo("regenerate")

			for _, download := range []string{"key", "bundle"} {
				rr = doRequest(t, h, http.MethodGet, "/api/certificates/"+cert.ID+"/download/"+download, nil, adminToken)
				if rr.Code != http.StatusOK {
					t.Fatalf("download %s: status=%d body=%s", download, rr.Code, rr.Body.String())
				}
			}
		})
	}

	rr = doRequest(t, h, http.MethodPost, "/api/certificates", map[string]interface{}{
		"name": "bad", "commonName": "bad.example.com", "type": "selfsigned", "keyAlgorithm": "dsa",
	}, adminToken)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("unknown keyAlgorithm: status=%d, want 400", rr.Code)
	}
}
