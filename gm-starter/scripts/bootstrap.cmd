@echo off
setlocal
set "PLUGKIT=%CLAUDE_PLUGIN_ROOT%\bin\plugkit.exe"
set "BINDIR=%CLAUDE_PLUGIN_ROOT%\bin"
set "VERFILE=%BINDIR%\.plugkit-version"
if not exist "%BINDIR%" mkdir "%BINDIR%"
if not exist "%PLUGKIT%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$g=ConvertFrom-Json(Get-Content '%CLAUDE_PLUGIN_ROOT%\gm.json' -Raw);$v=$g.plugkitVersion;[Net.ServicePointManager]::SecurityProtocol='Tls12';$r=[Net.HttpWebRequest]::Create(\"https://github.com/AnEntrypoint/rs-plugkit/releases/download/v$v/plugkit-win32-x64.exe\");$r.Timeout=1000;$r.AllowAutoRedirect=$true;try{$rs=$r.GetResponse();$s=$rs.GetResponseStream();$f=[IO.File]::Create('%PLUGKIT%');$s.CopyTo($f);$f.Dispose();$rs.Dispose();Set-Content -NoNewline '%VERFILE%' $v}catch{}" 2>nul
)
if exist "%PLUGKIT%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$p=Split-Path '%CLAUDE_PLUGIN_ROOT%';Get-ChildItem $p -Directory|Where-Object{$_.FullName -ne '%CLAUDE_PLUGIN_ROOT%'}|ForEach-Object{Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue}}catch{}" 2>nul
  "%PLUGKIT%" bootstrap
)
endlocal
