//go:build desktop

package config

import (
	"os"
	"path/filepath"
	"runtime"
)

func DefaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "./data"
	}

	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "GLCert")
	case "windows":
		appData := os.Getenv("APPDATA")
		if appData != "" {
			return filepath.Join(appData, "GLCert")
		}
		return filepath.Join(home, "AppData", "Roaming", "GLCert")
	default: // linux
		return filepath.Join(home, ".config", "GLCert")
	}
}
