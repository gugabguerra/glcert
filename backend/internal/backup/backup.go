package backup

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	zip "github.com/alexmullins/zip"
	_ "modernc.org/sqlite"
)

type BackupMetadata struct {
	Version   int       `json:"version"`
	Timestamp time.Time `json:"timestamp"`
}

type RestoreResult struct {
	Message       string `json:"message"`
	HasPassphrase bool   `json:"hasPassphrase"`
}

func GenerateBackupName() string {
	return fmt.Sprintf("glcert-backup-%s.zip", time.Now().Format("20060102-150405"))
}

func CreateBackup(dataDir string, password string) (io.Reader, int64, error) {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)

	meta := BackupMetadata{
		Version:   1,
		Timestamp: time.Now(),
	}
	metaBytes, _ := json.Marshal(meta)
	if err := addEncryptedFile(w, "backup.json", metaBytes, password); err != nil {
		return nil, 0, fmt.Errorf("add backup.json: %w", err)
	}

	dbPath := filepath.Join(dataDir, "database.sqlite")
	dbData, err := os.ReadFile(dbPath)
	if err != nil {
		return nil, 0, fmt.Errorf("read database: %w", err)
	}
	if err := addEncryptedFile(w, "database.sqlite", dbData, password); err != nil {
		return nil, 0, fmt.Errorf("add database.sqlite: %w", err)
	}

	keyPath := filepath.Join(dataDir, "encryption.key")
	keyData, err := os.ReadFile(keyPath)
	if err == nil {
		if err := addEncryptedFile(w, "encryption.key", keyData, password); err != nil {
			return nil, 0, fmt.Errorf("add encryption.key: %w", err)
		}
	}

	passphrasePath := filepath.Join(dataDir, "passphrase.txt")
	passData, err := os.ReadFile(passphrasePath)
	if err == nil {
		if err := addEncryptedFile(w, "passphrase.txt", passData, password); err != nil {
			return nil, 0, fmt.Errorf("add passphrase.txt: %w", err)
		}
	}

	certsDir := filepath.Join(dataDir, "certificates")
	if err := addDirectoryToZip(w, certsDir, "certificates", password); err != nil {
		log.Printf("[backup] warning: could not add certificates directory: %v", err)
	}

	if err := w.Close(); err != nil {
		return nil, 0, fmt.Errorf("close zip writer: %w", err)
	}

	data := buf.Bytes()
	return bytes.NewReader(data), int64(len(data)), nil
}

func addEncryptedFile(w *zip.Writer, name string, data []byte, password string) error {
	ew, err := w.Encrypt(name, password)
	if err != nil {
		return err
	}
	_, err = ew.Write(data)
	return err
}

func addDirectoryToZip(w *zip.Writer, rootDir, zipPrefix string, password string) error {
	return filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		relPath, err := filepath.Rel(rootDir, path)
		if err != nil {
			return err
		}
		zipPath := filepath.ToSlash(filepath.Join(zipPrefix, relPath))
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		ew, err := w.Encrypt(zipPath, password)
		if err != nil {
			return err
		}
		_, err = ew.Write(data)
		return err
	})
}

func ValidateBackup(backupData []byte, password string) (*BackupMetadata, error) {
	r, err := zip.NewReader(bytes.NewReader(backupData), int64(len(backupData)))
	if err != nil {
		return nil, fmt.Errorf("open backup zip: %w", err)
	}

	for _, f := range r.File {
		f.SetPassword(password)

		if f.Name == "backup.json" {
			rc, err := f.Open()
			if err != nil {
				return nil, fmt.Errorf("open backup.json (wrong password?): %w", err)
			}
			defer rc.Close()
			data, err := io.ReadAll(rc)
			if err != nil {
				return nil, fmt.Errorf("read backup.json: %w", err)
			}
			var meta BackupMetadata
			if err := json.Unmarshal(data, &meta); err != nil {
				return nil, fmt.Errorf("parse backup metadata: %w", err)
			}
			return &meta, nil
		}
	}

	return nil, fmt.Errorf("backup.json not found in archive")
}

func RestoreBackup(dataDir string, backupData []byte, password string) (*RestoreResult, error) {
	r, err := zip.NewReader(bytes.NewReader(backupData), int64(len(backupData)))
	if err != nil {
		return nil, fmt.Errorf("open backup zip: %w", err)
	}

	hasPassphrase := false

	for _, f := range r.File {
		f.SetPassword(password)

		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("open file %s: %w", f.Name, err)
		}

		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("read file %s: %w", f.Name, err)
		}

		switch f.Name {
		case "backup.json":
			var meta BackupMetadata
			if err := json.Unmarshal(data, &meta); err != nil {
				return nil, fmt.Errorf("parse backup metadata: %w", err)
			}
			if meta.Version != 1 {
				return nil, fmt.Errorf("unsupported backup version: %d", meta.Version)
			}

		case "database.sqlite":
			outPath := filepath.Join(dataDir, "database.sqlite.pending")
			if err := os.WriteFile(outPath, data, 0644); err != nil {
				return nil, fmt.Errorf("write database pending: %w", err)
			}
			pendingDB, err := sql.Open("sqlite", outPath)
			if err == nil {
				pendingDB.Exec("DELETE FROM admin")
				pendingDB.Exec("DELETE FROM sessions")
				pendingDB.Exec("UPDATE settings SET setup_complete = FALSE")
				pendingDB.Close()
			}

		case "encryption.key":
			outPath := filepath.Join(dataDir, "encryption.key.pending")
			if err := os.WriteFile(outPath, data, 0600); err != nil {
				return nil, fmt.Errorf("write encryption.key pending: %w", err)
			}

		case "passphrase.txt":
			outPath := filepath.Join(dataDir, "passphrase.txt")
			if err := os.WriteFile(outPath, data, 0600); err != nil {
				return nil, fmt.Errorf("write passphrase.txt: %w", err)
			}
			hasPassphrase = true

		default:
			if strings.HasPrefix(f.Name, "certificates/") {
				outPath := filepath.Join(dataDir, f.Name)
				dir := filepath.Dir(outPath)
				if err := os.MkdirAll(dir, 0755); err != nil {
					return nil, fmt.Errorf("create directory %s: %w", dir, err)
				}
				if err := os.WriteFile(outPath, data, 0644); err != nil {
					return nil, fmt.Errorf("write file %s: %w", f.Name, err)
				}
			}
		}
	}

	return &RestoreResult{
		Message:       "Backup restored. Server will restart to apply changes.",
		HasPassphrase: hasPassphrase,
	}, nil
}

func ApplyPendingRestore(dataDir string) bool {
	dbPending := filepath.Join(dataDir, "database.sqlite.pending")
	keyPending := filepath.Join(dataDir, "encryption.key.pending")

	if _, err := os.Stat(dbPending); os.IsNotExist(err) {
		return false
	}

	log.Println("[startup] applying pending restore...")

	os.Rename(dbPending, filepath.Join(dataDir, "database.sqlite"))
	os.Rename(keyPending, filepath.Join(dataDir, "encryption.key"))

	log.Println("[startup] restore applied successfully")
	return true
}
