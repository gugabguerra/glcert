package handlers

import (
	"bytes"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type StaticHandler struct {
	root string
	efs  fs.FS
}

func NewStaticHandler(dir string) *StaticHandler {
	return &StaticHandler{root: dir}
}

func NewEmbeddedStaticHandler(efs fs.FS) *StaticHandler {
	return &StaticHandler{efs: efs}
}

func (h *StaticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.efs != nil {
		h.serveEmbedded(w, r)
		return
	}
	h.serveDisk(w, r)
}

func (h *StaticHandler) serveDisk(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(h.root, r.URL.Path)

	info, err := os.Stat(path)
	if err == nil && !info.IsDir() {
		http.FileServer(http.Dir(h.root)).ServeHTTP(w, r)
		return
	}

	http.ServeFile(w, r, filepath.Join(h.root, "index.html"))
}

func (h *StaticHandler) serveEmbedded(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}

	data, err := fs.ReadFile(h.efs, path)
	if err != nil {
		// fallback to index.html for SPA routing
		data, err = fs.ReadFile(h.efs, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		path = "index.html"
	}

	http.ServeContent(w, r, path, time.Time{}, bytes.NewReader(data))
}
