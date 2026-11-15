/*
 * Stand-in for the Windows SDK's EventToken.h, which WebView2.h includes but older mingw-w64
 * releases (Debian bookworm, Ubuntu 22.04) do not ship. Used only by `make build-desktop-windows`
 * through CGO_CXXFLAGS; newer toolchains that have the real header find it first.
 */
#ifndef GLCERT_EVENTTOKEN_SHIM_H
#define GLCERT_EVENTTOKEN_SHIM_H
#ifndef __eventtoken_h__
#define __eventtoken_h__

typedef struct EventRegistrationToken {
    __int64 value;
} EventRegistrationToken;

#endif
#endif
