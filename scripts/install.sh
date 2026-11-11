#!/bin/sh
set -eu

RELEASE_BASE="${GMNEW_RELEASE_BASE:-https://github.com/AnEntrypoint/gm/releases/download/latest}"
INSTALL_ROOT="$HOME/.gmnew"
CURRENT_DIR="$INSTALL_ROOT/current"
VERSIONS_DIR="$INSTALL_ROOT/versions"
MCP_CONFIG=""
LOCAL_BUILD=""
SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

die() {
    printf 'install: %s\n' "$*" >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --mcp-config) [ $# -ge 2 ] || die "--mcp-config needs a path"; MCP_CONFIG="$2"; shift ;;
        --local) [ $# -ge 2 ] || die "--local needs a build directory, e.g. build/release"; LOCAL_BUILD="$2"; shift ;;
        *) die "unknown argument: $1" ;;
    esac
    shift
done

case "$(uname -s)" in
    Darwin) MV_NOFOLLOW="-fh" ;;
    *) MV_NOFOLLOW="-fT" ;;
esac

register() {
    EXE="$CURRENT_DIR/gm"
    if [ "${GMNEW_SKIP_REGISTER:-0}" = 1 ]; then
        printf 'registration skipped (GMNEW_SKIP_REGISTER=1)\n'
    elif [ -n "$MCP_CONFIG" ]; then
        "$EXE" install --mcp-config "$MCP_CONFIG" || die "gm install failed"
    else
        "$EXE" install || die "gm install failed"
    fi
}

swap_in() {
    NEW_ID="$2"
    mkdir -p "$VERSIONS_DIR"
    PREV=""
    if [ -L "$CURRENT_DIR" ]; then
        PREV="$(readlink "$CURRENT_DIR")"
        PREV="${PREV##*/}"
    elif [ -d "$CURRENT_DIR" ]; then
        PREV="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$CURRENT_DIR/.gmnew-update.json" 2>/dev/null | head -1)"
        [ -n "$PREV" ] || PREV="legacy-$(date -u +%s)"
        mv "$CURRENT_DIR" "$VERSIONS_DIR/$PREV"
    fi
    if [ -e "$VERSIONS_DIR/$NEW_ID" ]; then
        mv "$VERSIONS_DIR/$NEW_ID" "$VERSIONS_DIR/$NEW_ID.retired-$(date -u +%s)"
    fi
    mv "$1" "$VERSIONS_DIR/$NEW_ID"
    if [ -n "$PREV" ] && [ "$PREV" != "$NEW_ID" ]; then
        ln -sfn "versions/$PREV" "$INSTALL_ROOT/previous-$PREV"
        printf 'kept the previous install at %s\n' "$INSTALL_ROOT/previous-$PREV"
    fi
    ln -sfn "versions/$NEW_ID" "$INSTALL_ROOT/current.next"
    mv $MV_NOFOLLOW "$INSTALL_ROOT/current.next" "$CURRENT_DIR"
}

install_local() {
    HOST="$LOCAL_BUILD/native/components/host"
    [ -x "$HOST/gm" ] && [ -x "$HOST/gm-core" ] || die "no gm and gm-core in $HOST: build the gm target first"
    [ -d "$HOST/skills" ] || die "no skills in $HOST: build the gm_skills target first"
    diff -r "$HOST/skills" "$SOURCE_ROOT/skills" >/dev/null 2>&1 || die "the build skills in $HOST differ from $SOURCE_ROOT/skills: run cmake --build with the gm_skills target, then install again"
    [ -d "$SOURCE_ROOT/native/leaves" ] && [ -d "$SOURCE_ROOT/defaults" ] || die "no native/leaves or defaults in $SOURCE_ROOT"
    VERSION="$("$HOST/gm" --version | awk '{print $1}')"
    case "$VERSION" in
        ""|*[!A-Za-z0-9._-]*) die "unexpected build version: $VERSION" ;;
    esac

    mkdir -p "$INSTALL_ROOT"
    STAGE="$(mktemp -d "$INSTALL_ROOT/stage.XXXXXX")"
    trap 'rm -rf "$STAGE"' EXIT
    mkdir "$STAGE/new"
    cp "$HOST/gm" "$HOST/gm-core" "$STAGE/new/"
    cp -R "$HOST/skills" "$STAGE/new/skills"
    cp -R "$SOURCE_ROOT/native/leaves" "$STAGE/new/leaves"
    cp -R "$SOURCE_ROOT/defaults" "$STAGE/new/defaults"
    printf '{"checked_ms":%s000,"etag":"","version":"%s"}\n' "$(date -u +%s)" "$VERSION" > "$STAGE/new/.gmnew-update.json"

    swap_in "$STAGE/new" "$VERSION"
    printf 'installed local build %s from %s at %s\n' "$VERSION" "$LOCAL_BUILD" "$CURRENT_DIR/gm"
    register
}

if [ -n "$LOCAL_BUILD" ]; then
    install_local
    exit 0
fi

case "$(uname -s)" in
    Linux) OS=linux ;;
    Darwin) OS=macos ;;
    *) die "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
    x86_64 | amd64) ARCH=x64 ;;
    arm64 | aarch64) ARCH=arm64 ;;
    *) die "unsupported architecture: $(uname -m)" ;;
esac

if [ "$OS" = macos ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then
    ARCH=arm64
fi

TARGET="$ARCH-$OS"
PACKAGE="gmnew-$TARGET"
EXE_NAME=gm
CORE_NAME=gm-core

WORK="$(mktemp -d)"
STAGE=""
trap 'rm -rf "$WORK" "$STAGE"' EXIT

curl --retry 3 --retry-delay 1 --retry-all-errors -fsSL -o "$WORK/manifest.json" "$RELEASE_BASE/manifest.json" || die "cannot fetch $RELEASE_BASE/manifest.json"
MANIFEST="$(tr -d ' \t\r\n' < "$WORK/manifest.json")"

VERSION="$(printf '%s' "$MANIFEST" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
ASSET="$(printf '%s' "$MANIFEST" | sed -n "s/.*\"$TARGET\":{\"file\":\"\([^\"]*\)\",\"sha256\":\"\([0-9a-f]*\)\",\"size\":\([0-9]*\).*/\1 \2 \3/p")"
[ -n "$ASSET" ] || die "manifest has no asset for $TARGET"
set -- $ASSET
FILE="$1"
EXPECTED_SHA="$2"
EXPECTED_SIZE="$3"
case "$FILE" in gmnew-*-"$TARGET".tar.gz) ;; *) die "unexpected asset name for $TARGET: $FILE" ;; esac
[ -n "$VERSION" ] || die "manifest has no version"
case "$VERSION" in
    *[!A-Za-z0-9._-]*) die "unexpected version in manifest: $VERSION" ;;
esac

ARCHIVE="$WORK/$FILE"
curl --retry 3 --retry-delay 1 --retry-all-errors -fsSL -o "$ARCHIVE" "$RELEASE_BASE/$FILE" || die "cannot fetch $FILE"

if [ "$OS" = macos ]; then
    ACTUAL_SHA="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
else
    ACTUAL_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
fi
ACTUAL_SIZE="$(wc -c < "$ARCHIVE" | tr -d ' ')"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || die "sha256 mismatch for $FILE: expected $EXPECTED_SHA, got $ACTUAL_SHA"
[ "$ACTUAL_SIZE" = "$EXPECTED_SIZE" ] || die "size mismatch for $FILE: expected $EXPECTED_SIZE, got $ACTUAL_SIZE"

mkdir -p "$INSTALL_ROOT"
STAGE="$(mktemp -d "$INSTALL_ROOT/stage.XXXXXX")"
tar -xzf "$ARCHIVE" -C "$STAGE"
for name in "$EXE_NAME" "$CORE_NAME"; do
    [ -f "$STAGE/$PACKAGE/$name" ] || die "archive $FILE does not contain $PACKAGE/$name"
    chmod +x "$STAGE/$PACKAGE/$name"
done

swap_in "$STAGE/$PACKAGE" "$VERSION"
STATE="$CURRENT_DIR/.gmnew-update.json"
if [ ! -e "$STATE" ]; then
    printf '{"checked_ms":%s000,"etag":"","version":"%s"}\n' "$(date -u +%s)" "$VERSION" > "$STATE"
fi

printf 'installed gmnew %s (%s) at %s\n' "$VERSION" "$TARGET" "$CURRENT_DIR/$EXE_NAME"
register
