# plugkit-bin migration: rs-plugkit & plugkit-bin patch instructions

This file is a one-time migration playbook for moving plugkit native binaries out of every downstream gm-* plugin clone and into a dedicated `AnEntrypoint/plugkit-bin` repo whose **GitHub Releases** are the canonical distribution channel. Consumed at runtime by `gm-starter/bin/bootstrap.js` (in this repo).

The gm side of the migration is already in this repo. This file documents the changes you need to apply in two other repos:

- `AnEntrypoint/rs-plugkit` — rewrite `release.yml` to publish to `plugkit-bin` instead of force-pushing into `AnEntrypoint/gm`.
- `AnEntrypoint/plugkit-bin` — new repo, holds nothing but Releases.

## 1. Create `AnEntrypoint/plugkit-bin`

```bash
gh repo create AnEntrypoint/plugkit-bin --public --description "plugkit native binaries — distributed via GitHub Releases, consumed by gm bootstrap"
```

The repo's main branch can stay empty (a single README is fine). All payload lives in Releases.

Release tag convention: `v{plugkitVersion}` (e.g. `v0.1.218`). Each release has these assets:

```
plugkit-win32-x64.exe
plugkit-win32-arm64.exe
plugkit-darwin-x64
plugkit-darwin-arm64
plugkit-linux-x64
plugkit-linux-arm64
plugkit.sha256
plugkit.version
```

`plugkit.sha256` is a multi-line manifest:

```
<sha256-hex>  plugkit-win32-x64.exe
<sha256-hex>  plugkit-win32-arm64.exe
<sha256-hex>  plugkit-darwin-x64
... (one line per binary)
```

`plugkit.version` is the bare version string (e.g. `0.1.218\n`).

## 2. `PUBLISHER_TOKEN` for plugkit-bin

```bash
gh secret set PUBLISHER_TOKEN --repo AnEntrypoint/rs-plugkit
```

Token must have `contents:write` on `AnEntrypoint/plugkit-bin`.

## 3. Rewrite `rs-plugkit/.github/workflows/release.yml::publish-binaries`

**Replace the existing publish-binaries job** (the one that copies into `gm-build-latest/gm-cc/bin/` and force-pushes to `AnEntrypoint/gm`) with a job that:

1. Reads `plugkit-VERSION` (whatever rs-plugkit's existing version source is — `Cargo.toml` package.version).
2. Builds all 6 platform binaries via the matrix already in place (`win32-x64`, `win32-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`).
3. Computes sha256 over each file, accumulates into a `plugkit.sha256` manifest.
4. Writes `plugkit.version` containing the bare version.
5. Uploads all 8 assets to the corresponding `v{version}` release in `AnEntrypoint/plugkit-bin` (creating the release if missing).
6. Bumps `gm-starter/gm.json::plugkitVersion` in `AnEntrypoint/gm` via a PR or direct push (existing pattern preserved — only the upload destination changes).

Skeleton:

```yaml
publish-binaries:
  needs: build
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Download all platform binaries (artifacts uploaded by build matrix)
      uses: actions/download-artifact@v4
      with:
        path: ./bins

    - name: Stage release assets
      id: stage
      run: |
        set -e
        VER=$(cargo pkgid | sed 's/.*#//')
        mkdir -p ./release-assets
        # Map artifact-name → final-asset-name
        cp bins/plugkit-win32-x64/plugkit.exe        release-assets/plugkit-win32-x64.exe
        cp bins/plugkit-win32-arm64/plugkit.exe      release-assets/plugkit-win32-arm64.exe
        cp bins/plugkit-darwin-x64/plugkit            release-assets/plugkit-darwin-x64
        cp bins/plugkit-darwin-arm64/plugkit          release-assets/plugkit-darwin-arm64
        cp bins/plugkit-linux-x64/plugkit             release-assets/plugkit-linux-x64
        cp bins/plugkit-linux-arm64/plugkit           release-assets/plugkit-linux-arm64
        chmod +x release-assets/plugkit-darwin-* release-assets/plugkit-linux-*
        # Manifest
        cd release-assets
        sha256sum plugkit-* > plugkit.sha256
        echo "$VER" > plugkit.version
        ls -la
        echo "version=$VER" >> "$GITHUB_OUTPUT"

    - name: Upload to plugkit-bin release
      env:
        GH_TOKEN: ${{ secrets.PUBLISHER_TOKEN }}
        VER: ${{ steps.stage.outputs.version }}
      run: |
        set -e
        # Create release if missing (idempotent)
        if ! gh release view "v$VER" --repo AnEntrypoint/plugkit-bin >/dev/null 2>&1; then
          gh release create "v$VER" --repo AnEntrypoint/plugkit-bin \
            --title "plugkit v$VER" \
            --notes "Auto-published by rs-plugkit CI"
        fi
        gh release upload "v$VER" --repo AnEntrypoint/plugkit-bin \
          --clobber \
          release-assets/plugkit-win32-x64.exe \
          release-assets/plugkit-win32-arm64.exe \
          release-assets/plugkit-darwin-x64 \
          release-assets/plugkit-darwin-arm64 \
          release-assets/plugkit-linux-x64 \
          release-assets/plugkit-linux-arm64 \
          release-assets/plugkit.sha256 \
          release-assets/plugkit.version

    - name: Bump gm-starter/gm.json::plugkitVersion
      env:
        GH_TOKEN: ${{ secrets.PUBLISHER_TOKEN }}
        VER: ${{ steps.stage.outputs.version }}
      run: |
        set -e
        git clone --depth 1 https://x-access-token:${GH_TOKEN}@github.com/AnEntrypoint/gm.git gm-src
        cd gm-src
        CURR=$(jq -r '.plugkitVersion' gm-starter/gm.json)
        if [ "$CURR" = "$VER" ]; then
          echo "plugkitVersion already at $VER"; exit 0
        fi
        jq --arg v "$VER" '.plugkitVersion = $v' gm-starter/gm.json > /tmp/gm.json
        mv /tmp/gm.json gm-starter/gm.json
        # Also write the canonical bin/plugkit.version so dev builds work without CI
        echo "$VER" > gm-starter/bin/plugkit.version
        git config user.email "noreply@github.com"
        git config user.name "rs-plugkit-bot"
        git add gm-starter/gm.json gm-starter/bin/plugkit.version
        git commit -m "chore: bump plugkitVersion to $VER [skip ci]"
        # Push, tolerating concurrent pushes (race noted in gm/AGENTS.md)
        for i in 1 2 3 4 5; do
          if git push origin main; then break; fi
          git pull --rebase origin main
        done
```

**Removed steps** (no longer needed):
- Soft-reset of prior binary-update commits in gm history
- `git add -f gm-build-latest/gm-cc/bin/`
- `git push --force-with-lease` to `AnEntrypoint/gm` from rs-plugkit
- Copying into `gm-starter/bin/` directly

`AnEntrypoint/gm` is no longer touched as a binary sink. Only `gm-starter/gm.json::plugkitVersion` and `gm-starter/bin/plugkit.version` get a 2-line metadata bump.

## 4. Re-enable all tree-sitter languages in rs-codeinsight

The 108MB binary cap that drove the language-stripping in rs-codeinsight was a **GitHub push-blob constraint** — files >100MB cannot be pushed to a repo. **It does not apply to Release assets** (which can be up to 2 GB per asset). Once binaries no longer ride inside any pushed git history, that constraint disappears.

Action items in `AnEntrypoint/rs-codeinsight`:

- Restore the full tree-sitter grammar set in `Cargo.toml`: `rust`, `go`, `c`, `cpp`, `python`, `typescript`, `javascript`, `ruby`, `php`, `java`, `c-sharp`, `json`. C and C++ are required for our work and were the largest cuts.
- Remove any `cfg(feature = ...)` gates that conditionally exclude grammars.
- Verify scanner dispatch in `src/scanner.rs` recognises the restored extensions.

Expected binary size after restore: ~100–110MB linux-x64. Acceptable now.

Also update the AGENTS.md caveat in this repo (the "rs-plugkit binary size (108MB) root cause" entry) to note the constraint is gone — see task 6.

## 5. First manual release (one-time, before CI flips over)

Until rs-plugkit's release.yml is updated and runs once, downstream `bootstrap.js` calls will 404. To bridge:

1. Manually attach existing binaries from `gm-build-latest/` (or your local Rust build) to the first `plugkit-bin` release matching the current `plugkitVersion` in `gm-starter/gm.json` (currently `0.1.217`):

```bash
cd /path/to/gm
VER=$(jq -r '.plugkitVersion' gm-starter/gm.json)
mkdir -p /tmp/plugkit-stage
cp gm-build-latest/gm-cc/bin/plugkit-win32-x64.exe   /tmp/plugkit-stage/
cp gm-build-latest/gm-cc/bin/plugkit-win32-arm64.exe /tmp/plugkit-stage/
cp gm-build-latest/gm-cc/bin/plugkit-darwin-x64      /tmp/plugkit-stage/
cp gm-build-latest/gm-cc/bin/plugkit-darwin-arm64    /tmp/plugkit-stage/
cp gm-build-latest/gm-cc/bin/plugkit-linux-x64       /tmp/plugkit-stage/
cp gm-build-latest/gm-cc/bin/plugkit-linux-arm64     /tmp/plugkit-stage/
cd /tmp/plugkit-stage
sha256sum plugkit-* > plugkit.sha256
echo "$VER" > plugkit.version
gh release create "v$VER" --repo AnEntrypoint/plugkit-bin \
  --title "plugkit v$VER" --notes "First plugkit-bin release" \
  plugkit-win32-x64.exe plugkit-win32-arm64.exe \
  plugkit-darwin-x64 plugkit-darwin-arm64 \
  plugkit-linux-x64 plugkit-linux-arm64 \
  plugkit.sha256 plugkit.version
```

After this, every downstream gm clone (gm-cc, gm-oc, ...) bootstraps from `plugkit-bin` on first session.

## 6. Verification

- Clone any downstream (e.g. `gh repo clone AnEntrypoint/gm-cc`); confirm clone size is <1MB and contains no native binaries (`find . -type f -size +1M` should be empty).
- Run a session in any harness; observe `[plugkit-bootstrap] downloading: ... MiB ...%` on stderr exactly once, then cached.
- Delete `~/.cache/plugkit/bin/` (or `%LOCALAPPDATA%\plugkit\bin\`) and re-run; bootstrap re-downloads.
- Throttle network to 0.5 Mbps; confirm one download completes within the 30-min/attempt window. If it doesn't, raise `ATTEMPT_TIMEOUT_MS` in `gm-starter/bin/bootstrap.js`.
