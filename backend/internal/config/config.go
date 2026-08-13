package config

import "os"

type Config struct {
	Port    string
	DataDir string
}

func Load() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "18080"
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = DefaultDataDir()
	}

	return &Config{
		Port:    port,
		DataDir: dataDir,
	}
}
