#!/bin/sh
set -eu

RELEASE_BASE="${GMNEW_RELEASE_BASE:-https://github.com/AnEntrypoint/gm/releases/download/latest}"
INSTALL_ROOT="$HOME/.gmnew"
CURRENT_DIR="$INSTALL_ROOT/current"
MCP_CONFIG=""

die() {
    printf 'install: %s\n' "$*" >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --mcp-config) [ $# -ge 2 ] || die "--mcp-config needs a path"; MCP_CONFIG="$2"; shift ;;
        *) die "unknown argument: $1" ;;
    esac
    shift
done

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

curl -fsSL -o "$WORK/manifest.json" "$RELEASE_BASE/manifest.json" || die "cannot fetch $RELEASE_BASE/manifest.json"
MANIFEST="$(tr -d ' \t\r\n' < "$WORK/manifest.json")"

VERSION="$(printf '%s' "$MANIFEST" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
ASSET="$(printf '%s' "$MANIFEST" | sed -n "s/.*\"$TARGET\":{\"file\":\"\([^\"]*\)\",\"sha256\":\"\([0-9a-f]*\)\",\"size\":\([0-9]*\).*/\1 \2 \3/p")"
[ -n "$ASSET" ] || die "manifest has no asset for $TARGET"
set -- $ASSET
FILE="$1"
EXPECTED_SHA="$2"
EXPECTED_SIZE="$3"
case "$FILE" in gmnew-*-"$TARGET".tar.gz) ;; *) die "unexpected asset name for $TARGET: $FILE" ;; esac

ARCHIVE="$WORK/$FILE"
curl -fsSL -o "$ARCHIVE" "$RELEASE_BASE/$FILE" || die "cannot fetch $FILE"

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

OLD_DIR="$INSTALL_ROOT/previous.$$"
if [ -e "$CURRENT_DIR" ]; then
    mv "$CURRENT_DIR" "$OLD_DIR"
fi
if ! mv "$STAGE/$PACKAGE" "$CURRENT_DIR"; then
    if [ -e "$OLD_DIR" ]; then
        mv "$OLD_DIR" "$CURRENT_DIR"
    fi
    die "cannot move the new build into $CURRENT_DIR"
fi
rm -rf "$OLD_DIR" "$STAGE"

EXE="$CURRENT_DIR/$EXE_NAME"
printf 'installed gmnew %s (%s) at %s\n' "$VERSION" "$TARGET" "$EXE"

if [ "${GMNEW_SKIP_REGISTER:-0}" = 1 ]; then
    printf 'registration skipped (GMNEW_SKIP_REGISTER=1)\n'
elif [ -n "$MCP_CONFIG" ]; then
    npx -y add-mcp@2.6.1 "$EXE" --args serve --args --mcp-config --args "$MCP_CONFIG" -n gm -g -a claude-code -y || die "add-mcp failed"
    printf 'registered gm MCP server (user scope, add-mcp) at %s\n' "$EXE"
else
    npx -y add-mcp@2.6.1 "$EXE" --args serve -n gm -g -a claude-code -y || die "add-mcp failed"
    printf 'registered gm MCP server (user scope, add-mcp) at %s\n' "$EXE"
fi
