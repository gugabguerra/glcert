package handlers

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/gugabguerra/glcert/internal/services"
)

type contextKey string

const (
	TokenKey    contextKey = "token"
	UserIDKey   contextKey = "userID"
	UserRoleKey contextKey = "userRole"
)

type AuthMiddleware struct {
	auth *services.AuthService
	db   *sql.DB
}

func NewAuthMiddleware(auth *services.AuthService, db *sql.DB) *AuthMiddleware {
	return &AuthMiddleware{auth: auth, db: db}
}

func (m *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		userID, role, err := m.auth.GetSessionUser(token)
		if err != nil {
			http.Error(w, "invalid session", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), TokenKey, token)
		ctx = context.WithValue(ctx, UserIDKey, userID)
		ctx = context.WithValue(ctx, UserRoleKey, role)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userRole, ok := r.Context().Value(UserRoleKey).(string)
			if !ok {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			for _, role := range roles {
				if userRole == role {
					next.ServeHTTP(w, r)
					return
				}
			}
			http.Error(w, "forbidden", http.StatusForbidden)
		})
	}
}

func GetUserID(ctx context.Context) string {
	if id, ok := ctx.Value(UserIDKey).(string); ok {
		return id
	}
	return ""
}

func GetUserRole(ctx context.Context) string {
	if role, ok := ctx.Value(UserRoleKey).(string); ok {
		return role
	}
	return ""
}

// RequireCAAccess enforces that the authenticated user has been granted access
// to the CA identified by the {id} route parameter. Admins always pass.
func (m *AuthMiddleware) RequireCAAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := GetUserID(r.Context())
		caID := chi.URLParam(r, "id")
		if caID == "" || !m.auth.UserHasCAAccess(userID, caID) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireCertAccess enforces that the authenticated user can access the
// certificate identified by the {id} route parameter (by resolving the CA the
// certificate belongs to). Self-signed certificates (no CA) are visible to any
// authenticated user, matching the listing behaviour. Admins always pass.
func (m *AuthMiddleware) RequireCertAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := GetUserID(r.Context())
		certID := chi.URLParam(r, "id")

		var caID sql.NullString
		err := m.db.QueryRow("SELECT certificate_authority_id FROM certificates WHERE id = ?", certID).Scan(&caID)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if caID.Valid && caID.String != "" && !m.auth.UserHasCAAccess(userID, caID.String) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// SecurityHeaders sets baseline hardening headers on every response.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// MaxBodyBytes caps every request body. Backup restore sets its own larger cap.
const MaxBodyBytes = 1 << 20

// LimitBody applies MaxBodyBytes to every request except backup restore.
func LimitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/backup/restore" {
			r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

// RequestLog logs each request without its query string, and with share
// tokens redacted: they are bearer credentials for a private key.
func RequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		logger.Infof("%s %s %d %dB %s", r.Method, redactPath(r.URL.Path), ww.Status(), ww.BytesWritten(), time.Since(start).Round(time.Microsecond))
	})
}

func redactPath(path string) string {
	const sharePrefix = "/api/share/"
	if rest, ok := strings.CutPrefix(path, sharePrefix); ok && !strings.Contains(rest, "/") && rest != "send-email" {
		return sharePrefix + "[redacted]"
	}
	return path
}
