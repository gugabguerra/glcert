package config

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
)

// DefaultPort is the port the server listens on when no layer sets one.
const DefaultPort = 18080

// Setting keys: camelCase in config.json, SCREAMING_SNAKE_CASE in the environment.
const (
	keyPort      = "port"
	keyDataDir   = "dataDir"
	keyLogLevel  = "logLevel"
	keyPublicURL = "publicUrl"

	envPort      = "PORT"
	envDataDir   = "DATA_DIR"
	envLogLevel  = "LOG_LEVEL"
	envPublicURL = "PUBLIC_URL"
)

// Layer locations. Both are overridable so tests can point at fixtures.
const (
	configFileEnv = "CONFIG_FILE"
	envFileEnv    = "ENV_FILE"

	defaultConfigFile = "config.json"
	defaultEnvFile    = ".env"
)

// Config holds the resolved settings. Port stays a string because the router
// address and the desktop window URL are built by concatenation.
type Config struct {
	Port     string
	DataDir  string
	LogLevel string
	// PublicURL is the externally reachable origin used in emailed links
	// (password reset, share links). Empty means those emails are not sent:
	// request headers are never trusted to build them. It is also the only
	// origin passkeys are accepted from (http://localhost:<port> when empty).
	PublicURL string
}

// validLogLevels lists the levels the logger understands, in order.
var validLogLevels = []string{"debug", "info", "warn", "error", "fatal"}

// setting describes one layered value: where it lives in each layer, the value
// to fall back on, and how the winning text is validated.
type setting struct {
	name     string
	jsonKey  string
	envKey   string
	fallback string
	decode   func(json.RawMessage) (string, error)
	validate func(string) (string, error)
}

// layer is one candidate value for a setting, labelled with its origin so a
// validation error can point at the layer that needs fixing.
type layer struct {
	source string
	value  string
	set    bool
}

// dotEnv is a parsed .env file kept next to the path it was read from.
type dotEnv struct {
	path   string
	values map[string]string
}

// Load resolves the layers, rightmost wins: defaults, config.json, .env, then
// the real process environment. An unusable value refuses to start; an unusable
// .env line only warns, because a missing or hand-edited dotenv file is normal.
func Load() (*Config, error) {
	configPath, configRequested := configFileLocation()
	fileValues, err := loadConfigFile(configPath, configRequested)
	if err != nil {
		return nil, err
	}
	dotenvValues := loadDotEnv(envFileLocation())

	port := setting{
		name:     "port",
		jsonKey:  keyPort,
		envKey:   envPort,
		fallback: strconv.Itoa(DefaultPort),
		decode:   decodeJSONNumber,
		validate: validatePort,
	}
	dataDir := setting{
		name:     "data directory",
		jsonKey:  keyDataDir,
		envKey:   envDataDir,
		fallback: DefaultDataDir(),
		decode:   decodeJSONString,
		validate: validateDataDir,
	}
	logLevel := setting{
		name:     "log level",
		jsonKey:  keyLogLevel,
		envKey:   envLogLevel,
		fallback: "info",
		decode:   decodeJSONString,
		validate: validateLogLevel,
	}

	publicURL := setting{
		name:     "public URL",
		jsonKey:  keyPublicURL,
		envKey:   envPublicURL,
		fallback: "",
		decode:   decodeJSONString,
		validate: validatePublicURL,
	}

	cfg := &Config{}
	if cfg.Port, err = port.value(fileValues, configPath, dotenvValues); err != nil {
		return nil, err
	}
	if cfg.DataDir, err = dataDir.value(fileValues, configPath, dotenvValues); err != nil {
		return nil, err
	}
	if cfg.LogLevel, err = logLevel.value(fileValues, configPath, dotenvValues); err != nil {
		return nil, err
	}
	if cfg.PublicURL, err = publicURL.value(fileValues, configPath, dotenvValues); err != nil {
		return nil, err
	}
	return cfg, nil
}

// value returns the setting from the first layer that carries one, walking from
// the strongest to the weakest, and validates it there so a bad value fails no
// matter which layer it came from.
func (s setting) value(fileValues map[string]json.RawMessage, configPath string, dotenv dotEnv) (string, error) {
	chain := []layer{envLayer(s.envKey), dotenv.layer(s.envKey)}
	fromFile, err := fileLayer(fileValues, configPath, s.jsonKey, s.decode)
	if err != nil {
		return "", err
	}
	chain = append(chain, fromFile)

	for _, candidate := range chain {
		if !candidate.set {
			continue
		}
		value, err := s.validate(candidate.value)
		if err != nil {
			return "", fmt.Errorf("invalid %s from %s: %w", s.name, candidate.source, err)
		}
		return value, nil
	}
	return s.fallback, nil
}

// envLayer reads a variable from the real process environment. A variable that
// exists but is empty counts as unset, matching how shells usually export them.
func envLayer(key string) layer {
	value := os.Getenv(key)
	return layer{source: "environment variable " + key, value: value, set: value != ""}
}

// layer reads a variable from the parsed .env. Values stay in the map: loading a
// dotenv file never rewrites the process environment.
func (d dotEnv) layer(key string) layer {
	value := d.values[key]
	return layer{source: fmt.Sprintf("%s in %s", key, d.path), value: value, set: value != ""}
}

// fileLayer reads one key from the parsed config.json, rejecting a value whose
// JSON type does not match the setting.
func fileLayer(values map[string]json.RawMessage, configPath, key string, decode func(json.RawMessage) (string, error)) (layer, error) {
	raw, ok := values[key]
	if !ok {
		return layer{}, nil
	}
	value, err := decode(raw)
	if err != nil {
		return layer{}, fmt.Errorf("config file %s: key %q: %w", configPath, key, err)
	}
	return layer{source: fmt.Sprintf("%s in %s", key, configPath), value: value, set: value != ""}, nil
}

// configFileLocation reports the config.json path and whether it was asked for
// explicitly. The default file is optional, a requested one has to exist.
func configFileLocation() (path string, requested bool) {
	if p := os.Getenv(configFileEnv); p != "" {
		return p, true
	}
	return defaultConfigFile, false
}

// envFileLocation reports the .env path, which tests can repoint at fixtures.
func envFileLocation() string {
	if p := os.Getenv(envFileEnv); p != "" {
		return p
	}
	return defaultEnvFile
}

// loadConfigFile parses the JSON layer. Absent keys simply stay unset, but a
// malformed file, a wrong type, or a missing explicitly requested file is
// fatal: starting on half a configuration silently is worse than not starting.
func loadConfigFile(path string, requested bool) (map[string]json.RawMessage, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			if requested {
				return nil, fmt.Errorf("config file %s not found", path)
			}
			return nil, nil
		}
		return nil, fmt.Errorf("read config file %s: %w", path, err)
	}

	var values map[string]json.RawMessage
	if err := json.Unmarshal(data, &values); err != nil {
		return nil, fmt.Errorf("parse config file %s: %w", path, err)
	}

	for key := range values {
		if !knownJSONKey(key) {
			fmt.Fprintf(os.Stderr, "config: unknown key %q in %s ignored\n", key, path)
		}
	}
	return values, nil
}

// loadDotEnv parses the dotenv layer. The format is forgiving on purpose: blank
// lines and comments are skipped, a line without a separator or with an
// unrecognized key is reported and skipped, and nothing here stops startup.
func loadDotEnv(path string) dotEnv {
	dotenv := dotEnv{path: path, values: map[string]string{}}

	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			fmt.Fprintf(os.Stderr, "config: read %s: %v\n", path, err)
		}
		return dotenv
	}

	for i, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			fmt.Fprintf(os.Stderr, "config: %s line %d: no \"=\" separator, skipped\n", path, i+1)
			continue
		}
		key = strings.TrimSpace(key)
		if !knownEnvKey(key) {
			fmt.Fprintf(os.Stderr, "config: %s line %d: unknown key %q skipped\n", path, i+1, key)
			continue
		}
		dotenv.values[key] = strings.TrimSpace(value)
	}

	return dotenv
}

// knownJSONKey reports whether the key names one of the settings.
func knownJSONKey(key string) bool {
	switch key {
	case keyPort, keyDataDir, keyLogLevel, keyPublicURL:
		return true
	default:
		return false
	}
}

// knownEnvKey reports whether the variable names one of the settings.
func knownEnvKey(key string) bool {
	switch key {
	case envPort, envDataDir, envLogLevel, envPublicURL:
		return true
	default:
		return false
	}
}

// decodeJSONString accepts a JSON string and rejects any other type, so
// `"dataDir": 3` fails instead of being coerced into something surprising.
func decodeJSONString(raw json.RawMessage) (string, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("expected a string, got %s", string(raw))
	}
	return value, nil
}

// decodeJSONNumber accepts a JSON number and renders it back as text so every
// layer can be resolved through the same string pipeline. A string, a boolean
// or null is a type error, never a coercion.
func decodeJSONNumber(raw json.RawMessage) (string, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("expected a number, got %s", string(raw))
	}
	number, ok := value.(float64)
	if !ok {
		return "", fmt.Errorf("expected a number, got %s", string(raw))
	}
	if number != math.Trunc(number) {
		return "", fmt.Errorf("expected a whole number, got %s", strconv.FormatFloat(number, 'f', -1, 64))
	}
	return strconv.FormatFloat(number, 'f', -1, 64), nil
}

// validatePort accepts a TCP port: 1 through 65535, echoed back in canonical
// form so the router address never sees "018080" or a stray space.
func validatePort(value string) (string, error) {
	port, err := strconv.Atoi(value)
	if err != nil {
		return "", fmt.Errorf("%q is not a number", value)
	}
	if port < 1 || port > 65535 {
		return "", fmt.Errorf("%d is not between 1 and 65535", port)
	}
	return strconv.Itoa(port), nil
}

// validateDataDir keeps the path as written; the JSON layer already rejected a
// non-string, and every layer treats an empty value as unset.
func validateDataDir(value string) (string, error) {
	return strings.TrimSpace(value), nil
}

// validateLogLevel normalizes to lower case and rejects anything the logger
// cannot map onto a level.
func validateLogLevel(value string) (string, error) {
	level := strings.ToLower(strings.TrimSpace(value))
	if !slices.Contains(validLogLevels, level) {
		return "", fmt.Errorf("%q is not one of %s", value, strings.Join(validLogLevels, ", "))
	}
	return level, nil
}

// validatePublicURL accepts an http(s) origin with an optional path prefix
// (for a reverse proxy sub-path) and drops the trailing slash.
func validatePublicURL(value string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("%q is not an http(s) URL like https://pki.example.com", value)
	}
	return strings.TrimRight(u.String(), "/"), nil
}
