# Windows Troubleshooting

## "Daemon not found" Error After Restart

**Symptom:** `agent-browser` works during a session but fails after restarting the terminal with:
```
✗ Daemon not found. Set AGENT_BROWSER_HOME environment variable or run from project directory.
```

**Root cause:** On Windows, npm installs `agent-browser.exe` into the npm bin folder (e.g. `C:\Users\<user>\AppData\Roaming\npm\`). The binary resolves `daemon.js` via a relative path from its own location (`exe_dir/../dist/daemon.js`), which points to the wrong directory. It then falls back to the `AGENT_BROWSER_HOME` environment variable — but if that's set to the data directory or the shell wrapper instead of the **package directory**, it can't find `daemon.js`.

**Fix:** Set `AGENT_BROWSER_HOME` to the actual npm package directory containing `dist/daemon.js`:

```cmd
:: Find the correct path
npm root -g
:: Output example: C:\Users\<user>\AppData\Roaming\npm\node_modules

:: Set permanently (append \agent-browser to the npm root output)
setx AGENT_BROWSER_HOME "C:\Users\<user>\AppData\Roaming\npm\node_modules\agent-browser"
```

For Git Bash / MSYS2 users, also add to `~/.bashrc`:
```bash
export AGENT_BROWSER_HOME="/c/Users/<user>/AppData/Roaming/npm/node_modules/agent-browser"
```

**Automated fix:** Run `fix-agent-browser.bat` which detects the correct path automatically:
```bat
@echo off
for /f "delims=" %%i in ('npm root -g') do set NPM_ROOT=%%i
setx AGENT_BROWSER_HOME "%NPM_ROOT%\agent-browser"
```

**Important:** Open a new terminal after running the fix — `setx` only affects new sessions.

## Stale Daemon Port File

**Symptom:** Daemon appears running but commands fail, or auto-start doesn't trigger.

**Root cause:** The daemon writes a port file (e.g. in `~/.agent-browser/`) that persists after a crash or restart. The auto-start logic sees the file and assumes the daemon is alive.

**Fix:** Check if the daemon is actually listening before trusting the port file:
```bash
# Check if port is live (Git Bash)
nc -z 127.0.0.1 $(cat ~/.agent-browser/port) 2>/dev/null || echo "Stale port file"

# Remove stale file and restart
rm ~/.agent-browser/port
agent-browser open about:blank
```
