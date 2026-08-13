.PHONY: build-desktop build-macos-app build-desktop-macos-arm64 build-desktop-macos-x64 build-desktop-windows build-desktop-linux clean

VERSION ?= 1.0.0

build-desktop: build-desktop-macos-arm64

build-frontend:
	cd frontend && npm run build

embed-frontend: build-frontend
	rm -rf backend/internal/embedded/static
	cp -r frontend/dist backend/internal/embedded/static

build-desktop-macos-arm64: embed-frontend
	mkdir -p dist
	cd backend && GOOS=darwin GOARCH=arm64 go build -tags desktop -o ../dist/glcert-macos-arm64 ./cmd/desktop

build-desktop-macos-x64: embed-frontend
	mkdir -p dist
	cd backend && GOOS=darwin GOARCH=amd64 go build -tags desktop -o ../dist/glcert-macos-x64 ./cmd/desktop

build-desktop-windows: embed-frontend
	mkdir -p dist
	cd backend && GOOS=windows GOARCH=amd64 go build -tags desktop -o ../dist/glcert-windows.exe ./cmd/desktop

build-desktop-linux: embed-frontend
	mkdir -p dist
	cd backend && GOOS=linux GOARCH=amd64 go build -tags desktop -o ../dist/glcert-linux ./cmd/desktop

build-macos-app: embed-frontend
	mkdir -p dist

	# Build arm64
	cd backend && GOOS=darwin GOARCH=arm64 go build -tags desktop -o /tmp/glcert-arm64 ./cmd/desktop

	# Build amd64
	cd backend && GOOS=darwin GOARCH=amd64 go build -tags desktop -o /tmp/glcert-amd64 ./cmd/desktop

	# Create universal binary
	lipo -create /tmp/glcert-arm64 /tmp/glcert-amd64 -output /tmp/glcert-universal
	rm -f /tmp/glcert-arm64 /tmp/glcert-amd64

	# Generate icon
	rm -rf /tmp/glcert.iconset /tmp/glcert.icns
	mkdir -p /tmp/glcert.iconset
	sips -z 16 16 ASSETS/IMG/glcert.png --out /tmp/glcert.iconset/icon_16x16.png
	sips -z 32 32 ASSETS/IMG/glcert.png --out /tmp/glcert.iconset/icon_16x16@2x.png
	sips -z 32 32 ASSETS/IMG/glcert.png --out /tmp/glcert.iconset/icon_32x32.png
	sips -z 64 64 ASSETS/IMG/glcert.png --out /tmp/glcert.iconset/icon_32x32@2x.png
	sips -z 128 128 ASSETS/IMG/glcert.png --out /tmp/glcert.iconset/icon_128x128.png
	sips -z 256 256 ASSETS/IMG/glcert.png --out /tmp/glcert.iconset/icon_128x128@2x.png
	sips -z 256 256 ASSETS/IMG/glcert.png --out /tmp/glcert.iconset/icon_256x256.png
	sips -z 512 512 ASSETS/IMG/glcert.png --out /tmp/glcert.iconset/icon_256x256@2x.png
	sips -z 512 512 ASSETS/IMG/glcert.png --out /tmp/glcert.iconset/icon_512x512.png
	cp ASSETS/IMG/glcert.png /tmp/glcert.iconset/icon_512x512@2x.png
	iconutil -c icns /tmp/glcert.iconset -o /tmp/glcert.icns
	rm -rf /tmp/glcert.iconset

	# Assemble .app bundle
	rm -rf dist/GLCert.app
	mkdir -p dist/GLCert.app/Contents/MacOS
	mkdir -p dist/GLCert.app/Contents/Resources
	cp /tmp/glcert-universal dist/GLCert.app/Contents/MacOS/glcert
	cp /tmp/glcert.icns dist/GLCert.app/Contents/Resources/glcert.icns
	chmod +x dist/GLCert.app/Contents/MacOS/glcert

	# Write Info.plist
	@cat > dist/GLCert.app/Contents/Info.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>GLCert</string>
	<key>CFBundleExecutable</key>
	<string>glcert</string>
	<key>CFBundleIconFile</key>
	<string>glcert</string>
	<key>CFBundleIdentifier</key>
	<string>com.glcert.glcert</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>GLCert</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$(VERSION)</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.15</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSHumanReadableCopyright</key>
	<string>GLCert - Certificate Management</string>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.utilities</string>
</dict>
</plist>
PLIST

	# Create distributable zip
	cd dist && ditto -c -k --sequesterRsrc --keepParent GLCert.app GLCert-macos.zip

	rm -f /tmp/glcert-universal /tmp/glcert.icns

	@echo ""
	@echo "Build complete:"
	@echo "  App:    dist/GLCert.app"
	@echo "  Zip:    dist/GLCert-macos.zip"
	@echo "  Size:   $$(du -sh dist/GLCert-macos.zip | cut -f1)"

clean:
	rm -rf dist/ backend/internal/embedded/static/
