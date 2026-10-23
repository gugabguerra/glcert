package services

import (
	"database/sql"
	"encoding/base64"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/gugabguerra/glcert/internal/logger"
)

// MigrationReport counts the secrets MigrateV1 looked at.
type MigrationReport struct {
	Migrated   int // re-encrypted from the v1 key
	Current    int // already under the v2 key (an earlier run was interrupted)
	Unreadable int // opened by neither key; left untouched
}

// MigrateV1 converts a v1 encryption.key into the v2 scheme. The v1 data key
// was derived from the admin password, so only the admin whose password
// opens the v1 file can run it.
//
// Nothing is deleted: the original key file is kept as encryption.key.v1,
// secrets neither key opens are left as they are, and every step can be
// re-run. Key files and database rows are rewritten before the new key file,
// so an interrupted run resumes from the v1 file and skips what it already
// converted.
func (s *CryptoService) MigrateV1(db *sql.DB, userID, password string) (MigrationReport, error) {
	var report MigrationReport
	s.fileMu.Lock()
	defer s.fileMu.Unlock()

	raw, err := os.ReadFile(s.GetPassphrasePath())
	if err != nil {
		return report, fmt.Errorf("read key file: %w", err)
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(data) < 16 {
		return report, fmt.Errorf("decode v1 key file")
	}
	oldGCM, err := newGCM(s.deriveKey(password, data[:16]))
	if err != nil {
		return report, err
	}
	passphrase, err := open(oldGCM, data[16:])
	if err != nil {
		return report, fmt.Errorf("this password does not open the v1 key file")
	}

	backupPath := s.GetPassphrasePath() + ".v1"
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		if err := os.WriteFile(backupPath, raw, 0600); err != nil {
			return report, fmt.Errorf("keep v1 key file: %w", err)
		}
	}

	// Reuse the salt of an interrupted run so secrets it already converted
	// still open.
	salt, err := s.pendingSalt()
	if err != nil {
		return report, err
	}
	newGCMKey, err := newGCM(s.deriveKey(string(passphrase), salt))
	if err != nil {
		return report, err
	}

	reencrypt := func(blob []byte, where string) ([]byte, bool, error) {
		if plain, err := open(oldGCM, blob); err == nil {
			out, err := seal(newGCMKey, plain)
			if err != nil {
				return nil, false, err
			}
			report.Migrated++
			return out, true, nil
		}
		if _, err := open(newGCMKey, blob); err == nil {
			report.Current++
			return nil, false, nil
		}
		report.Unreadable++
		logger.Warnf("crypto migration: %s opens with neither key; left unchanged", where)
		return nil, false, nil
	}

	certsDir := filepath.Join(s.DataDir, "certificates")
	err = filepath.WalkDir(certsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) && path == certsDir {
				return filepath.SkipDir
			}
			return err
		}
		if d.IsDir() || (d.Name() != "ca.key" && d.Name() != "key.pem") {
			return nil
		}
		blob, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(s.DataDir, path)
		out, changed, err := reencrypt(blob, rel)
		if err != nil || !changed {
			return err
		}
		return writeFileAtomic(path, out, 0600)
	})
	if err != nil {
		return report, fmt.Errorf("migrate key files: %w", err)
	}

	if err := migrateRows(db, reencrypt); err != nil {
		return report, err
	}

	check, err := seal(newGCMKey, keyCheck)
	if err != nil {
		return report, err
	}
	wrapped, err := s.wrap(password, string(passphrase))
	if err != nil {
		return report, err
	}
	kf := &keyFile{Version: keyFileVersion, Salt: salt, Check: check, Wraps: map[string][]byte{userID: wrapped}}
	if err := s.writeKeyFile(kf); err != nil {
		return report, err
	}
	os.Remove(s.pendingSaltPath())

	logger.Infof("crypto migration: %d secrets migrated, %d already current, %d unreadable",
		report.Migrated, report.Current, report.Unreadable)
	return report, s.activate(kf, string(passphrase))
}

func (s *CryptoService) pendingSaltPath() string {
	return s.GetPassphrasePath() + ".salt"
}

// pendingSalt returns the v2 data-key salt for this migration, persisting it
// first so an interrupted run resumes with the same key.
func (s *CryptoService) pendingSalt() ([]byte, error) {
	if salt, err := os.ReadFile(s.pendingSaltPath()); err == nil && len(salt) == 16 {
		return salt, nil
	}
	salt, err := randomSalt()
	if err != nil {
		return nil, err
	}
	if err := writeFileAtomic(s.pendingSaltPath(), salt, 0600); err != nil {
		return nil, err
	}
	return salt, nil
}

// migrateRows re-encrypts every encrypted database column in one transaction.
func migrateRows(db *sql.DB, reencrypt func([]byte, string) ([]byte, bool, error)) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	columns := []struct {
		table, key, column string
		text               bool // stored as TEXT rather than BLOB
	}{
		{"users", "id", "totp_secret", false},
		{"certificate_authorities", "id", "key_encrypted_passphrase", false},
		{"settings", "id", "smtp_password", true},
	}
	for _, c := range columns {
		rows, err := tx.Query(fmt.Sprintf("SELECT %s, %s FROM %s WHERE %s IS NOT NULL AND LENGTH(%s) > 0",
			c.key, c.column, c.table, c.column, c.column))
		if err != nil {
			return fmt.Errorf("read %s.%s: %w", c.table, c.column, err)
		}
		type row struct {
			key  string
			blob []byte
		}
		var pending []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.key, &r.blob); err != nil {
				rows.Close()
				return err
			}
			pending = append(pending, r)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		for _, r := range pending {
			out, changed, err := reencrypt(r.blob, c.table+"."+c.column)
			if err != nil {
				return err
			}
			if !changed {
				continue
			}
			var value interface{} = out
			if c.text {
				value = string(out)
			}
			if _, err := tx.Exec(fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", c.table, c.column, c.key), value, r.key); err != nil {
				return fmt.Errorf("update %s.%s: %w", c.table, c.column, err)
			}
		}
	}
	return tx.Commit()
}
