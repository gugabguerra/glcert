package config

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// isolate fixes both layer files inside dir and clears the three settings from
// the real environment, so only the layers a test creates can supply them.
// A test that needs no config-file layer writes an empty "{}" file.
func isolate(t *testing.T, dir string) {
	t.Helper()

	t.Setenv("PORT", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("LOG_LEVEL", "")
	t.Setenv("CONFIG_FILE", filepath.Join(dir, "config.json"))
	t.Setenv("ENV_FILE", filepath.Join(dir, ".env"))
}

// writeLayer writes one layer file inside dir and returns its path.
func writeLayer(t *testing.T, dir, name, content string) string {
	t.Helper()

	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

// captureStderr swaps os.Stderr for a pipe, runs fn, and returns what it wrote.
func captureStderr(t *testing.T, fn func()) string {
	t.Helper()

	original := os.Stderr
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("create pipe: %v", err)
	}
	os.Stderr = writer

	written := make(chan string, 1)
	go func() {
		var sb strings.Builder
		io.Copy(&sb, reader)
		written <- sb.String()
	}()

	fn()

	writer.Close()
	os.Stderr = original
	captured := <-written
	reader.Close()
	return captured
}

func TestLoadFallsBackToDefaultsWhenNothingIsConfigured(t *testing.T) {
	// Default-path case: the working directory is an empty temporary one and
	// CONFIG_FILE/ENV_FILE are left unset, so the default "config.json" and
	// ".env" are absent. A missing default config file is skipped, not refused.
	t.Chdir(t.TempDir())

	t.Setenv("PORT", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("LOG_LEVEL", "")
	t.Setenv("CONFIG_FILE", "")
	t.Setenv("ENV_FILE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load with nothing configured should not fail: %v", err)
	}
	if cfg.Port != "18080" {
		t.Errorf("Port should fall back to 18080, got %q", cfg.Port)
	}
	if cfg.DataDir != DefaultDataDir() {
		t.Errorf("DataDir should fall back to %q, got %q", DefaultDataDir(), cfg.DataDir)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel should fall back to info, got %q", cfg.LogLevel)
	}
}

func TestLoadTakesValuesFromConfigFile(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"port": 9090, "dataDir": "/var/lib/glcert", "logLevel": "debug"}`)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("a well-formed config.json should load: %v", err)
	}
	if cfg.Port != "9090" {
		t.Errorf("Port should come from config.json, got %q", cfg.Port)
	}
	if cfg.DataDir != "/var/lib/glcert" {
		t.Errorf("DataDir should come from config.json, got %q", cfg.DataDir)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel should come from config.json, got %q", cfg.LogLevel)
	}
}

func TestLoadNormalizesLogLevelFromTheEnvironment(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", "{}")
	t.Setenv("LOG_LEVEL", "DEBUG")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("an upper-case log level should still be accepted: %v", err)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel should be normalized to lower case, got %q", cfg.LogLevel)
	}
}

func TestLoadPrefersTheRealEnvironmentOverConfigFile(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"port": 9090, "logLevel": "debug"}`)
	t.Setenv("PORT", "3000")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load should not fail: %v", err)
	}
	if cfg.Port != "3000" {
		t.Errorf("PORT should win over config.json, got %q", cfg.Port)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("unaffected settings should still come from config.json, got %q", cfg.LogLevel)
	}
}

func TestLoadPrefersDotEnvOverConfigFile(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"port": 9090, "dataDir": "/from/config"}`)
	writeLayer(t, dir, ".env", "PORT=4000\nDATA_DIR=/from/dotenv\n")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load should not fail: %v", err)
	}
	if cfg.Port != "4000" {
		t.Errorf(".env should win over config.json, got %q", cfg.Port)
	}
	if cfg.DataDir != "/from/dotenv" {
		t.Errorf("DATA_DIR should come from .env, got %q", cfg.DataDir)
	}
}

func TestLoadPrefersTheRealEnvironmentOverDotEnv(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", "{}")
	writeLayer(t, dir, ".env", "PORT=4000\nDATA_DIR=/from/dotenv\nLOG_LEVEL=warn\n")
	t.Setenv("PORT", "3000")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load should not fail: %v", err)
	}
	if cfg.Port != "3000" {
		t.Errorf("PORT should win over .env, got %q", cfg.Port)
	}
	if cfg.DataDir != "/from/dotenv" {
		t.Errorf("DATA_DIR should still come from .env, got %q", cfg.DataDir)
	}
	if cfg.LogLevel != "warn" {
		t.Errorf("LOG_LEVEL should still come from .env, got %q", cfg.LogLevel)
	}
}

func TestLoadLeavesTheProcessEnvironmentUntouched(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", "{}")
	writeLayer(t, dir, ".env", "DATA_DIR=/from/dotenv\nLOG_LEVEL=warn\nSOME_UNRELATED_KEY=super-secret-value\n")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load should not fail: %v", err)
	}
	if cfg.DataDir != "/from/dotenv" {
		t.Errorf("DATA_DIR should be read from .env, got %q", cfg.DataDir)
	}
	if value := os.Getenv("DATA_DIR"); value != "" {
		t.Errorf("loading a .env should not export DATA_DIR into the environment, got %q", value)
	}
	if value := os.Getenv("SOME_UNRELATED_KEY"); value != "" {
		t.Errorf("loading a .env should not export unrelated keys, got %q", value)
	}
}

func TestLoadRejectsMalformedConfigFile(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"port": }`)

	if _, err := Load(); err == nil {
		t.Fatalf("Load should report malformed JSON instead of starting on defaults")
	}
}

func TestLoadRejectsPortGivenAsAString(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"port": "18080"}`)

	_, err := Load()
	if err == nil {
		t.Fatalf("Load should reject a string where a JSON number is required")
	}
	if !strings.Contains(err.Error(), "port") {
		t.Errorf("the error should name the offending setting, got %v", err)
	}
}

func TestLoadRejectsDataDirGivenAsANumber(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"dataDir": 3}`)

	_, err := Load()
	if err == nil {
		t.Fatalf("Load should reject a number where a JSON string is required")
	}
	if !strings.Contains(err.Error(), "dataDir") {
		t.Errorf("the error should name the offending key, got %v", err)
	}
}

func TestLoadRejectsPortZero(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"port": 0}`)

	if _, err := Load(); err == nil {
		t.Fatalf("Load should reject port 0, which is not a port to listen on")
	}
}

func TestLoadRejectsPortAboveTheRange(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"port": 70000}`)

	if _, err := Load(); err == nil {
		t.Fatalf("Load should reject port 70000, which is outside 1-65535")
	}
}

func TestLoadRejectsNonNumericPortFromTheEnvironment(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", "{}")
	t.Setenv("PORT", "not-a-port")

	if _, err := Load(); err == nil {
		t.Fatalf("Load should reject a PORT that is not a number")
	}
}

func TestLoadRejectsUnknownLogLevel(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"logLevel": "verbose"}`)

	_, err := Load()
	if err == nil {
		t.Fatalf("Load should reject a log level the logger cannot map")
	}
	if !strings.Contains(err.Error(), "verbose") {
		t.Errorf("the error should quote the rejected level, got %v", err)
	}
}

func TestLoadRejectsAnExplicitlyRequestedConfigFileThatIsMissing(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	t.Setenv("CONFIG_FILE", filepath.Join(dir, "absent.json"))

	_, err := Load()
	if err == nil {
		t.Fatalf("Load should refuse to start when CONFIG_FILE points at a file that is not there")
	}
	if !strings.Contains(err.Error(), "absent.json") {
		t.Errorf("the error should name the missing file, got %v", err)
	}
}

func TestLoadSurvivesAJunkDotEnvFile(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", "{}")
	writeLayer(t, dir, ".env", "# a comment\n\nPORT=5555\nthis line has no separator\nSOME_UNRELATED_KEY=super-secret-value\nLOG_LEVEL=debug\n")

	var cfg *Config
	var err error
	warnings := captureStderr(t, func() {
		cfg, err = Load()
	})

	if err != nil {
		t.Fatalf("a .env with junk lines should not stop startup: %v", err)
	}
	if cfg.Port != "5555" {
		t.Errorf("the recognized key should still load, got Port %q", cfg.Port)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("the last recognized key should load, got LogLevel %q", cfg.LogLevel)
	}
	if !strings.Contains(warnings, "line 4") {
		t.Errorf("the warning should point at the line without a separator, got %q", warnings)
	}
	if !strings.Contains(warnings, "SOME_UNRELATED_KEY") {
		t.Errorf("the warning should name the unknown key, got %q", warnings)
	}
	if strings.Contains(warnings, "super-secret-value") {
		t.Errorf("the warning must not print the value, got %q", warnings)
	}
}

func TestLoadWarnsAboutUnknownConfigFileKeys(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"port": 8080, "rootCa": "some-secret-value"}`)

	var cfg *Config
	var err error
	warnings := captureStderr(t, func() {
		cfg, err = Load()
	})

	if err != nil {
		t.Fatalf("an unknown key should not fail the load: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("recognized keys should still apply, got Port %q", cfg.Port)
	}
	if !strings.Contains(warnings, "rootCa") {
		t.Errorf("the warning should name the unknown key, got %q", warnings)
	}
	if strings.Contains(warnings, "some-secret-value") {
		t.Errorf("the warning must not print the value, got %q", warnings)
	}
}

func TestLoadToleratesAnAbsentDotEnvFile(t *testing.T) {
	dir := t.TempDir()
	isolate(t, dir)
	writeLayer(t, dir, "config.json", `{"dataDir": "/var/lib/glcert"}`)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("a missing .env is normal and should not fail: %v", err)
	}
	if cfg.DataDir != "/var/lib/glcert" {
		t.Errorf("DataDir should come from config.json, got %q", cfg.DataDir)
	}
	if cfg.Port != "18080" {
		t.Errorf("Port should fall back to the default, got %q", cfg.Port)
	}
}
