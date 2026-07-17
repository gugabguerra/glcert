package main

import (
	"fmt"
	"log"
	"net/http"

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

	crypto := services.NewCryptoService(cfg.DataDir)
	auth := services.NewAuthService(db)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	authHandler := handlers.NewAuthHandler(auth, crypto)
	authMiddleware := handlers.NewAuthMiddleware(auth)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"ok"}`))
		})

		r.Get("/auth/status", authHandler.GetStatus)
		r.Post("/auth/setup", authHandler.Setup)
		r.Post("/auth/login", authHandler.Login)

		r.Group(func(r chi.Router) {
			r.Use(authMiddleware.RequireAuth)

			r.Post("/auth/logout", authHandler.Logout)

			h := handlers.New(db)
			r.Get("/dashboard", h.GetDashboardStats)
			r.Get("/settings", h.GetSettings)
			r.Put("/settings", h.UpdateSettings)

			caService := services.NewCAService(cfg.DataDir, crypto)
			caHandler := handlers.NewCAHandler(db, caService)

			r.Route("/ca", func(r chi.Router) {
				r.Get("/", caHandler.List)
				r.Post("/", caHandler.Create)
				r.Get("/{id}", caHandler.Get)
				r.Delete("/{id}", caHandler.Delete)
				r.Get("/{id}/download/cert", caHandler.DownloadCert)
				r.Get("/{id}/download/key", caHandler.DownloadKey)
				r.Get("/{id}/download/bundle", caHandler.DownloadCABundle)
			})

			certService := services.NewCertService(cfg.DataDir, crypto)
			certHandler := handlers.NewCertHandler(db, certService, caService)

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

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("GLCert server starting on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
