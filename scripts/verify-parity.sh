#!/usr/bin/env bash
set -e

PLATFORM="${1:-cc}"
REPO_NAME="glootie-${PLATFORM}"
BUILD_DIR="/tmp/build/${REPO_NAME}"
REMOTE_DIR="/tmp/verify-${REPO_NAME}"

if [ ! -d "$BUILD_DIR" ]; then
  echo "Build directory not found: $BUILD_DIR"
  exit 1
fi

rm -rf "$REMOTE_DIR"
git clone https://github.com/AnEntrypoint/${REPO_NAME}.git "$REMOTE_DIR" 2>/dev/null

shopt -s dotglob
DIFF_COUNT=$(diff -r "$BUILD_DIR" "$REMOTE_DIR" --exclude=.git 2>/dev/null | wc -l || true)

if [ "$DIFF_COUNT" -eq 0 ]; then
  echo "✓ $PLATFORM parity verified"
  exit 0
else
  echo "✗ $PLATFORM parity mismatch - differences found:"
  diff -r "$BUILD_DIR" "$REMOTE_DIR" --exclude=.git || true
  exit 1
fi
