package handlers

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
)

type BundleFile struct {
	Name    string
	Content []byte
}

func WriteBundle(w io.Writer, files []BundleFile, format string) error {
	switch format {
	case "tgz":
		return writeTgz(w, files)
	default:
		return writeZip(w, files)
	}
}

func writeZip(w io.Writer, files []BundleFile) error {
	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	for _, f := range files {
		fw, err := zipWriter.Create(f.Name)
		if err != nil {
			return fmt.Errorf("create zip entry %s: %w", f.Name, err)
		}
		if _, err := fw.Write(f.Content); err != nil {
			return fmt.Errorf("write zip entry %s: %w", f.Name, err)
		}
	}
	return nil
}

func writeTgz(w io.Writer, files []BundleFile) error {
	gzWriter := gzip.NewWriter(w)
	defer gzWriter.Close()

	tarWriter := tar.NewWriter(gzWriter)
	defer tarWriter.Close()

	for _, f := range files {
		header := &tar.Header{
			Name: f.Name,
			Mode: 0644,
			Size: int64(len(f.Content)),
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			return fmt.Errorf("write tar header %s: %w", f.Name, err)
		}
		if _, err := tarWriter.Write(f.Content); err != nil {
			return fmt.Errorf("write tar entry %s: %w", f.Name, err)
		}
	}
	return nil
}

func BundleContentType(format string) string {
	if format == "tgz" {
		return "application/gzip"
	}
	return "application/zip"
}

func BundleExtension(format string) string {
	if format == "tgz" {
		return ".tar.gz"
	}
	return ".zip"
}
