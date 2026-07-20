package handlers

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/glcert/glcert/internal/backup"
)

type BackupHandler struct {
	dataDir string
}

func NewBackupHandler(dataDir string) *BackupHandler {
	return &BackupHandler{dataDir: dataDir}
}

func (h *BackupHandler) CreateBackup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
		http.Error(w, "password is required", http.StatusBadRequest)
		return
	}

	reader, _, err := backup.CreateBackup(h.dataDir, req.Password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+backup.GenerateBackupName()+"\"")

	io.Copy(w, reader)
}

func (h *BackupHandler) RestoreBackup(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "invalid form data", http.StatusBadRequest)
		return
	}

	password := r.FormValue("password")
	if password == "" {
		http.Error(w, "password is required", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("backup")
	if err != nil {
		http.Error(w, "backup file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	backupData, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "read backup file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	meta, err := backup.ValidateBackup(backupData, password)
	if err != nil {
		http.Error(w, "invalid backup: "+err.Error(), http.StatusBadRequest)
		return
	}

	result, err := backup.RestoreBackup(h.dataDir, backupData, password)
	if err != nil {
		http.Error(w, "restore failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	result.Message = "Backup restored from " + meta.Timestamp.Format("2006-01-02 15:04:05") + ". Restarting server..."

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)

	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	log.Printf("[restore] backup applied, restarting server...")
	time.AfterFunc(500*time.Millisecond, func() {
		os.Exit(0)
	})
}
