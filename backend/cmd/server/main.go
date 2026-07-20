package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/glcert/glcert/internal/config"
	"github.com/glcert/glcert/internal/database"
	"github.com/glcert/glcert/internal/handlers"
	"github.com/glcert/glcert/internal/services"
)

func main() {
	cfg := config.Load()

	db, err := database.New(cfg.DataDir)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	db.Exec("DELETE FROM sessions")
	db.Exec("DELETE FROM pending_sessions")
	log.Printf("Sessions cleared — re-login required after restart")

	crypto := services.NewCryptoService(cfg.DataDir)
	auth := services.NewAuthService(db)
	totpService := services.NewTOTPService(db, crypto)
	emailService := services.NewEmailService(db, crypto)
	notificationService := services.NewNotificationService(db, emailService)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	authHandler := handlers.NewAuthHandler(auth, crypto, emailService, totpService)
	authMiddleware := handlers.NewAuthMiddleware(auth)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"ok"}`))
		})

		r.Get("/auth/status", authHandler.GetStatus)
		r.Post("/auth/setup", authHandler.Setup)
		r.Post("/auth/login", authHandler.Login)
		r.Post("/auth/forgot-password", authHandler.ForgotPassword)
		r.Post("/auth/reset-password", authHandler.ResetPassword)

		backupHandler := handlers.NewBackupHandler(db, cfg.DataDir)
		r.Post("/backup/restore", backupHandler.RestoreBackup)

		totpHandler := handlers.NewTOTPHandler(totpService, auth)
		r.Post("/totp/verify", totpHandler.Verify)

		caService := services.NewCAService(cfg.DataDir, crypto)
		certService := services.NewCertService(cfg.DataDir, crypto)
		notificationHandler := handlers.NewNotificationHandler(notificationService)
		shareHandler := handlers.NewShareHandler(db, certService, caService, crypto, emailService)

		r.Get("/share/{token}", shareHandler.ServeLink)

		r.Group(func(r chi.Router) {
			r.Use(authMiddleware.RequireAuth)

			r.Post("/auth/logout", authHandler.Logout)
			r.Put("/auth/password", authHandler.ChangePassword)
			adminHandler := handlers.NewAdminHandler(db, cfg.DataDir, crypto)
			r.Post("/admin/factory-reset", adminHandler.FactoryReset)
			r.Post("/backup/create", backupHandler.CreateBackup)

			r.Get("/totp/status", totpHandler.GetStatus)
			r.Get("/totp/setup", totpHandler.Setup)
			r.Post("/totp/verify-setup", totpHandler.VerifySetup)
			r.Post("/totp/disable", totpHandler.Disable)

			h := handlers.New(db, crypto)
			r.Get("/dashboard", h.GetDashboardStats)
			r.Get("/settings", h.GetSettings)
			r.Put("/settings", h.UpdateSettings)
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

			caHandler := handlers.NewCAHandler(db, caService, crypto)

		r.Route("/ca", func(r chi.Router) {
			r.Get("/", caHandler.List)
			r.Post("/", caHandler.Create)
			r.Post("/import", caHandler.Import)
			r.Get("/{id}", caHandler.Get)
			r.Delete("/{id}", caHandler.Delete)
			r.Get("/{id}/download/cert", caHandler.DownloadCert)
			r.Get("/{id}/download/key", caHandler.DownloadKey)
			r.Get("/{id}/download/bundle", caHandler.DownloadCABundle)
		})

			certHandler := handlers.NewCertHandler(db, certService, caService, crypto)

			r.Post("/share/{type}/{id}", shareHandler.GenerateLink)
			r.Post("/share/send-email", shareHandler.SendShareEmail)

			r.Route("/certificates", func(r chi.Router) {
				r.Get("/", certHandler.List)
				r.Post("/", certHandler.Create)
				r.Get("/{id}", certHandler.Get)
				r.Get("/{id}/versions", certHandler.GetVersions)
				r.Post("/{id}/regenerate", certHandler.Regenerate)
				r.Post("/{id}/versions/{version}/restore", certHandler.RestoreVersion)
				r.Delete("/{id}/versions/{version}", certHandler.DeleteVersion)
				r.Delete("/{id}", certHandler.Delete)
				r.Get("/{id}/download/cert", certHandler.DownloadCert)
				r.Get("/{id}/download/key", certHandler.DownloadKey)
				r.Get("/{id}/download/ca", certHandler.DownloadCA)
				r.Get("/{id}/download/bundle", certHandler.DownloadBundle)
			})
		})
	})

	staticHandler := handlers.NewStaticHandler("./static")
	r.Handle("/*", staticHandler)

	go func() {
		time.Sleep(5 * time.Minute)
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		notificationService.CheckAndNotify()
		for range ticker.C {
			notificationService.CheckAndNotify()
			auth.CleanupSessions()
			totpService.CleanupPendingSessions()
		}
	}()

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("GLCert server starting on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
