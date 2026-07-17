package handlers

import (
	"context"
	"net/http"

	"github.com/glcert/glcert/internal/services"
)

type contextKey string

const TokenKey contextKey = "token"

type AuthMiddleware struct {
	auth *services.AuthService
}

func NewAuthMiddleware(auth *services.AuthService) *AuthMiddleware {
	return &AuthMiddleware{auth: auth}
}

func (m *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		if !m.auth.ValidateSession(token) {
			http.Error(w, "invalid session", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), TokenKey, token)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
