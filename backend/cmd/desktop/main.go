//go:build desktop

package main

import (
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"time"

	"github.com/glcert/glcert/internal/config"
	"github.com/glcert/glcert/internal/database"
	"github.com/glcert/glcert/internal/embedded"
	"github.com/glcert/glcert/internal/handlers"
	"github.com/glcert/glcert/internal/logger"
	"github.com/glcert/glcert/internal/server"
	"github.com/glcert/glcert/internal/services"
	"github.com/webview/webview_go"
)

// version is injected at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}
	logger.Init(cfg.LogLevel)
	logger.Infof("GLCert version %s", version)

	db, err := database.New(cfg.DataDir)
	if err != nil {
		logger.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	db.Exec("DELETE FROM sessions")
	db.Exec("DELETE FROM pending_sessions")
	logger.Infof("Sessions cleared — re-login required after restart")

	crypto := services.NewCryptoService(cfg.DataDir)

	subFS, err := fs.Sub(embedded.StaticFiles, "static")
	if err != nil {
		logger.Fatalf("Failed to load embedded assets: %v", err)
	}
	staticHandler := handlers.NewEmbeddedStaticHandler(subFS)
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
	go func() {
		if err := http.ListenAndServe(addr, r); err != nil {
			logger.Fatalf("Server failed: %v", err)
		}
	}()

	w := webview.New(true)
	defer w.Destroy()
	w.SetTitle("GLCert")
	w.SetSize(1200, 800, webview.HintNone)
	w.Navigate("http://localhost:" + cfg.Port)
	w.Run()
}
