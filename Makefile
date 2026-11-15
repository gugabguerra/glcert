.PHONY: build-desktop build-frontend embed-frontend build-macos-app build-desktop-macos-arm64 build-desktop-macos-x64 build-desktop-windows build-desktop-linux clean

VERSION ?= $(shell cat VERSION)
LDFLAGS := -s -w -X main.version=$(VERSION)

# The desktop shell uses webview_go, which needs cgo. Go turns cgo off when cross-compiling, so
# every desktop target turns it back on and names a C/C++ compiler for its platform.
#   macOS:   Apple clang builds either architecture with -arch.
#   Linux:   native gcc plus GTK 3 and WebKitGTK 4.0 dev packages (pkg-config gtk+-3.0 webkit2gtk-4.0).
#   Windows: mingw-w64; override WINDOWS_CC/WINDOWS_CXX if yours have other names. Older
#            mingw-w64 lacks EventToken.h, so assets/windows/include supplies it last.
WINDOWS_CC ?= x86_64-w64-mingw32-gcc
WINDOWS_CXX ?= x86_64-w64-mingw32-g++

DESKTOP_BUILD := go build -tags desktop -trimpath

build-desktop: build-desktop-macos-arm64

build-frontend:
	cd frontend && npm run build

embed-frontend: build-frontend
	rm -rf backend/internal/embedded/static
	cp -r frontend/dist backend/internal/embedded/static

build-desktop-macos-arm64: embed-frontend
	mkdir -p dist
	cd backend && CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 CC="clang -arch arm64" CXX="clang++ -arch arm64" \
		$(DESKTOP_BUILD) -ldflags "$(LDFLAGS)" -o ../dist/glcert-macos-arm64 ./cmd/desktop

build-desktop-macos-x64: embed-frontend
	mkdir -p dist
	cd backend && CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 CC="clang -arch x86_64" CXX="clang++ -arch x86_64" \
		$(DESKTOP_BUILD) -ldflags "$(LDFLAGS)" -o ../dist/glcert-macos-x64 ./cmd/desktop

build-desktop-windows: embed-frontend
	mkdir -p dist
	cd backend && CGO_ENABLED=1 GOOS=windows GOARCH=amd64 CC=$(WINDOWS_CC) CXX=$(WINDOWS_CXX) \
		CGO_CXXFLAGS="-idirafter $(CURDIR)/assets/windows/include" \
		$(DESKTOP_BUILD) -ldflags "$(LDFLAGS) -H windowsgui" -o ../dist/glcert-windows.exe ./cmd/desktop

build-desktop-linux: embed-frontend
	mkdir -p dist
	cd backend && CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
		$(DESKTOP_BUILD) -ldflags "$(LDFLAGS)" -o ../dist/glcert-linux ./cmd/desktop

# Universal macOS bundle (arm64 + x86_64) zipped for the release page.
build-macos-app: build-desktop-macos-arm64 build-desktop-macos-x64
	lipo -create dist/glcert-macos-arm64 dist/glcert-macos-x64 -output dist/glcert-macos-universal

	# Icon set from the 1024 px master
	rm -rf dist/glcert.iconset && mkdir -p dist/glcert.iconset
	for s in 16 32 128 256 512; do \
		sips -z $$s $$s assets/IMG/glcert.png --out dist/glcert.iconset/icon_$${s}x$${s}.png >/dev/null; \
		sips -z $$((s*2)) $$((s*2)) assets/IMG/glcert.png --out dist/glcert.iconset/icon_$${s}x$${s}@2x.png >/dev/null; \
	done
	iconutil -c icns dist/glcert.iconset -o dist/glcert.icns

	# Bundle
	rm -rf dist/GLcert.app
	mkdir -p dist/GLcert.app/Contents/MacOS dist/GLcert.app/Contents/Resources
	cp dist/glcert-macos-universal dist/GLcert.app/Contents/MacOS/glcert
	chmod +x dist/GLcert.app/Contents/MacOS/glcert
	cp dist/glcert.icns dist/GLcert.app/Contents/Resources/glcert.icns
	sed 's/@VERSION@/$(VERSION)/g' assets/macos/Info.plist > dist/GLcert.app/Contents/Info.plist
	plutil -lint dist/GLcert.app/Contents/Info.plist

	# Ad-hoc signature so Apple Silicon will launch the universal binary
	codesign --force --deep --sign - dist/GLcert.app

	rm -f dist/GLcert-macos.zip
	cd dist && ditto -c -k --sequesterRsrc --keepParent GLcert.app GLcert-macos.zip
	rm -rf dist/glcert.iconset dist/glcert.icns dist/glcert-macos-universal
	@echo "Built dist/GLcert.app and dist/GLcert-macos.zip ($$(du -sh dist/GLcert-macos.zip | cut -f1))"

clean:
	rm -rf dist/ backend/internal/embedded/static/
