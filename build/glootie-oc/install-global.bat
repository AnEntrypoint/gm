@echo off
setlocal enabledelayedexpansion
set SCRIPT_DIR=%~dp0
if "%APPDATA%"=="" (
    echo Error: APPDATA not set
    exit /b 1
)
set OPENCODE_CONFIG_DIR=%APPDATA%\opencode\plugins
if not exist "%OPENCODE_CONFIG_DIR%" mkdir "%OPENCODE_CONFIG_DIR%"
xcopy /E /I /Y "%SCRIPT_DIR%" "%OPENCODE_CONFIG_DIR%\glootie" >nul 2>&1
echo Global installation complete!
