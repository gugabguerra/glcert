package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/glcert/glcert/internal/config"
	"github.com/glcert/glcert/internal/database"
	"github.com/glcert/glcert/internal/handlers"
	"github.com/glcert/glcert/internal/logger"
	"github.com/glcert/glcert/internal/server"
	"github.com/glcert/glcert/internal/services"
)

// version is injected at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	logger.Init()
	logger.Infof("GLCert version %s", version)
	cfg := config.Load()

	db, err := database.New(cfg.DataDir)
	if err != nil {
		logger.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	db.Exec("DELETE FROM sessions")
	db.Exec("DELETE FROM pending_sessions")
	logger.Infof("Sessions cleared — re-login required after restart")

	crypto := services.NewCryptoService(cfg.DataDir)

	staticHandler := handlers.NewStaticHandler("./static")
	r := server.SetupRouter(db, crypto, cfg, staticHandler)

	notificationService := services.NewNotificationService(db, services.NewEmailService(db, crypto))
	auth := services.NewAuthService(db)
	totpService := services.NewTOTPService(db, crypto)

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
	logger.Infof("GLCert server starting on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		logger.Fatalf("Server failed: %v", err)
	}
}
