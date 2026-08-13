package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/glcert/glcert/internal/config"
	"github.com/glcert/glcert/internal/handlers"
	"github.com/glcert/glcert/internal/services"
	"golang.org/x/time/rate"
)

func SetupRouter(db *sql.DB, crypto *services.CryptoService, cfg *config.Config, staticHandler http.Handler) *chi.Mux {
	auth := services.NewAuthService(db)
	totpService := services.NewTOTPService(db, crypto)
	emailService := services.NewEmailService(db, crypto)
	notificationService := services.NewNotificationService(db, emailService)
	auditService := services.NewAuditService(db)
	caService := services.NewCAService(cfg.DataDir, crypto)
	certService := services.NewCertService(cfg.DataDir, crypto)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	authHandler := handlers.NewAuthHandler(auth, crypto, emailService, totpService)
	authMiddleware := handlers.NewAuthMiddleware(auth, db)
	totpHandler := handlers.NewTOTPHandler(totpService, auth)
	userHandler := handlers.NewUserHandler(auth)
	backupHandler := handlers.NewBackupHandler(db, cfg.DataDir)
	adminHandler := handlers.NewAdminHandler(db, cfg.DataDir, crypto)
	caHandler := handlers.NewCAHandler(db, caService, crypto, auth)
	certHandler := handlers.NewCertHandler(db, certService, caService, crypto, auth)
	caPermHandler := handlers.NewCAPermissionHandler(auth)
	auditHandler := handlers.NewAuditHandler(auditService)
	notificationHandler := handlers.NewNotificationHandler(notificationService)
	shareHandler := handlers.NewShareHandler(db, certService, caService, crypto, emailService, auth)
	h := handlers.New(db, crypto)

	r.Route("/api", func(r chi.Router) {
		// --- Public routes ---
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"ok"}`))
		})
		r.Get("/auth/status", authHandler.GetStatus)
		r.Post("/auth/setup", authHandler.Setup)
		r.With(handlers.RateLimit(rate.Every(2*time.Second), 5)).Post("/auth/login", authHandler.Login)
		r.With(handlers.RateLimit(rate.Every(2*time.Second), 3)).Post("/auth/forgot-password", authHandler.ForgotPassword)
		r.With(handlers.RateLimit(rate.Every(2*time.Second), 3)).Post("/auth/reset-password", authHandler.ResetPassword)
		r.Get("/share/{token}", shareHandler.ServeLink)

		// --- TOTP verify (unauthenticated) ---
		r.With(handlers.RateLimit(rate.Every(3*time.Second), 3)).Post("/totp/verify", totpHandler.Verify)

		// --- Backup restore ---
		// Allowed unauthenticated only during initial bootstrap (setup wizard).
		// After setup completes, it requires an authenticated admin.
		r.Post("/backup/restore", func(w http.ResponseWriter, r *http.Request) {
			if !auth.IsSetupComplete() {
				backupHandler.RestoreBackup(w, r)
				return
			}
			authMiddleware.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if handlers.GetUserRole(r.Context()) != "admin" {
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}
				backupHandler.RestoreBackup(w, r)
			})).ServeHTTP(w, r)
		})

		// --- Authenticated routes ---
		r.Group(func(r chi.Router) {
			r.Use(authMiddleware.RequireAuth)

			// --- Any role ---
			r.Post("/auth/logout", authHandler.Logout)
			r.Put("/auth/password", authHandler.ChangePassword)
			r.Get("/totp/status", totpHandler.GetStatus)
			r.Get("/totp/setup", totpHandler.Setup)
			r.Post("/totp/verify-setup", totpHandler.VerifySetup)
			r.Post("/totp/disable", totpHandler.Disable)

			r.Get("/users/me", userHandler.GetMe)
			r.Put("/users/me", userHandler.UpdateMe)

			r.Get("/dashboard", h.GetDashboardStats)
			r.Post("/notifications/test", notificationHandler.TestNotification)
			r.Post("/notifications/test-email", func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Email string `json:"email"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
					http.Error(w, "email is required", http.StatusBadRequest)
					return
				}
				if err := emailService.SendTestEmail(req.Email); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			})

			// --- Share (any role — viewers can share) ---
			r.Post("/share/{type}/{id}", shareHandler.GenerateLink)
			r.Post("/share/send-email", shareHandler.SendShareEmail)

			// --- Read-only CAs and certs (viewers can list/download) ---
			r.Route("/ca", func(r chi.Router) {
				r.Get("/", caHandler.List)
				r.With(authMiddleware.RequireCAAccess).Get("/{id}", caHandler.Get)
				r.With(authMiddleware.RequireCAAccess).Get("/{id}/download/cert", caHandler.DownloadCert)
				r.With(authMiddleware.RequireCAAccess).Get("/{id}/download/key", caHandler.DownloadKey)
				r.With(authMiddleware.RequireCAAccess).Get("/{id}/download/bundle", caHandler.DownloadCABundle)
			})
			r.Route("/certificates", func(r chi.Router) {
				r.Get("/", certHandler.List)
				r.Get("/groups", certHandler.ListGroups)
				r.Get("/download/group", certHandler.DownloadGroup)
				r.With(authMiddleware.RequireCertAccess).Get("/{id}", certHandler.Get)
				r.With(authMiddleware.RequireCertAccess).Get("/{id}/versions", certHandler.GetVersions)
				r.With(authMiddleware.RequireCertAccess).Get("/{id}/download/cert", certHandler.DownloadCert)
				r.With(authMiddleware.RequireCertAccess).Get("/{id}/download/key", certHandler.DownloadKey)
				r.With(authMiddleware.RequireCertAccess).Get("/{id}/download/ca", certHandler.DownloadCA)
				r.With(authMiddleware.RequireCertAccess).Get("/{id}/download/bundle", certHandler.DownloadBundle)
			})

			// --- Operator + Admin (write operations) ---
			r.Group(func(r chi.Router) {
				r.Use(handlers.RequireRole("admin", "operator"))

				r.Post("/ca", caHandler.Create)
				r.Post("/ca/import", caHandler.Import)
				r.Delete("/ca/{id}", caHandler.Delete)

				r.Post("/certificates", certHandler.Create)
				r.Post("/certificates/import", certHandler.ImportCert)
				r.With(authMiddleware.RequireCertAccess).Patch("/certificates/{id}", certHandler.UpdateGroup)
				r.With(authMiddleware.RequireCertAccess).Post("/certificates/{id}/regenerate", certHandler.Regenerate)
				r.With(authMiddleware.RequireCertAccess).Post("/certificates/{id}/versions/{version}/restore", certHandler.RestoreVersion)
				r.With(authMiddleware.RequireCertAccess).Delete("/certificates/{id}/versions/{version}", certHandler.DeleteVersion)
				r.With(authMiddleware.RequireCertAccess).Delete("/certificates/{id}", certHandler.Delete)
			})

			// --- Admin only ---
			r.Group(func(r chi.Router) {
				r.Use(handlers.RequireRole("admin"))

				r.Get("/settings", h.GetSettings)
				r.Put("/settings", h.UpdateSettings)
				r.Post("/admin/factory-reset", adminHandler.FactoryReset)
				r.Post("/backup/create", backupHandler.CreateBackup)

				r.Get("/users", userHandler.List)
				r.Post("/users", userHandler.Create)
				r.Put("/users/{id}", userHandler.Update)
				r.Post("/users/{id}/reset-password", userHandler.ResetPassword)
				r.Delete("/users/{id}", userHandler.Delete)

				r.Get("/ca/{id}/permissions", caPermHandler.Get)
				r.Put("/ca/{id}/permissions", caPermHandler.Set)
				r.Get("/audit", auditHandler.List)
			})
		})
	})

	r.Handle("/*", staticHandler)
	r.Handle("/", staticHandler)

	return r
}
