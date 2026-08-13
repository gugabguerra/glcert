//go:build !desktop

package config

func DefaultDataDir() string {
	return "./data"
}
