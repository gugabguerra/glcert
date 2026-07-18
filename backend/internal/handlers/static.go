package handlers

import (
	"net/http"
	"os"
	"path/filepath"
)

type StaticHandler struct {
	root string
}

func NewStaticHandler(dir string) *StaticHandler {
	return &StaticHandler{root: dir}
}

func (h *StaticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(h.root, r.URL.Path)

	info, err := os.Stat(path)
	if err == nil && !info.IsDir() {
		http.FileServer(http.Dir(h.root)).ServeHTTP(w, r)
		return
	}

	http.ServeFile(w, r, filepath.Join(h.root, "index.html"))
}
