#!/usr/bin/env pwsh
$ccsniffPath = (Get-ChildItem -Path @($PSScriptRoot, (npm root -g)) -Filter "ccsniff" -Type Directory -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $ccsniffPath -or -not (Test-Path "$ccsniffPath/src/cli.js")) {
  Write-Error "ccsniff not found. Install with: npm install -g ccsniff or bun add -g ccsniff"
  exit 1
}
& node "$ccsniffPath/src/cli.js" @args
