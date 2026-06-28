#!/usr/bin/env pwsh
$gmsniffPath = (Get-ChildItem -Path @($PSScriptRoot, (npm root -g)) -Filter "gmsniff" -Type Directory -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $gmsniffPath -or -not (Test-Path "$gmsniffPath/src/cli.js")) {
  Write-Error "gmsniff not found. Install with: npm install -g gmsniff or bun add -g gmsniff"
  exit 1
}
& node "$gmsniffPath/src/cli.js" @args
