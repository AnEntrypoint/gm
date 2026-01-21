#!/usr/bin/env bash
set -e

REPO_NAME="glootie-${PLATFORM}"
WORK_DIR="/tmp/${REPO_NAME}"
BUILD_DIR="/tmp/build/glootie-${PLATFORM}"

gh repo create AnEntrypoint/${REPO_NAME} --public 2>/dev/null || true

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"
git init
git remote add origin "https://github.com/AnEntrypoint/${REPO_NAME}.git" || git remote set-url origin "https://github.com/AnEntrypoint/${REPO_NAME}.git"
git fetch origin main 2>/dev/null || true
git checkout main 2>/dev/null || git checkout -b main

shopt -s dotglob
rm -rf ./*
cp -r "$BUILD_DIR"/* .

git add -A
if ! git diff-index --quiet HEAD --; then
  git commit -m "Auto-build: ${NAME} plugin from plugforge"
  git push -u origin main -f || git push -u origin HEAD:main -f
fi
