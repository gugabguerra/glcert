package logger

import (
	"fmt"
	"log"
	"os"
	"strings"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
	LevelFatal
)

var levelNames = map[Level]string{
	LevelDebug: "DEBUG",
	LevelInfo:  "INFO",
	LevelWarn:  "WARN",
	LevelError: "ERROR",
	LevelFatal: "FATAL",
}

var currentLevel Level = LevelInfo

// Init sets the log level from the already-resolved configuration. An empty
// level behaves like "info"; the value is expected to come from config.Load,
// which has validated it.
func Init(level string) {
	if level == "" {
		level = "info"
	}
	currentLevel = parseLevel(strings.ToLower(level))
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	Infof("log level set to %s", levelNames[currentLevel])
}

func parseLevel(s string) Level {
	switch s {
	case "debug":
		return LevelDebug
	case "info":
		return LevelInfo
	case "warn":
		return LevelWarn
	case "error":
		return LevelError
	case "fatal":
		return LevelFatal
	default:
		return LevelInfo
	}
}

func shouldLog(level Level) bool {
	return level >= currentLevel
}

func logf(level Level, format string, args ...any) {
	if !shouldLog(level) {
		return
	}
	prefix := fmt.Sprintf("[%s] ", levelNames[level])
	log.Printf(prefix+format, args...)
}

func Debugf(format string, args ...any) { logf(LevelDebug, format, args...) }
func Infof(format string, args ...any)  { logf(LevelInfo, format, args...) }
func Warnf(format string, args ...any)  { logf(LevelWarn, format, args...) }
func Errorf(format string, args ...any) { logf(LevelError, format, args...) }

func Fatalf(format string, args ...any) {
	logf(LevelFatal, format, args...)
	os.Exit(1)
}
