package handlers

import (
	"context"
	"net/http"

	"github.com/glcert/glcert/internal/services"
)

type contextKey string

const (
	TokenKey  contextKey = "token"
	UserIDKey contextKey = "userID"
	UserRoleKey contextKey = "userRole"
)

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
