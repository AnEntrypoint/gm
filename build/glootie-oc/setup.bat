@echo off
setlocal enabledelayedexpansion
set SCRIPT_DIR=%~dp0
if not exist "%SCRIPT_DIR%.opencode" mkdir "%SCRIPT_DIR%.opencode"
if not exist "%SCRIPT_DIR%.opencode\agents" mkdir "%SCRIPT_DIR%.opencode\agents"
copy "%SCRIPT_DIR%agents\gm.md" "%SCRIPT_DIR%.opencode\agents\" >nul 2>&1 || true
call npm install --save-dev >nul 2>&1 || true
echo Setup complete!
