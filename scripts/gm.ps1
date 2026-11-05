#!/usr/bin/env pwsh
param([Parameter(Position = 0)] [string]$Command)

$Root = Split-Path -Parent $PSScriptRoot
$Preset = if ($env:GMNEW_PRESET) { $env:GMNEW_PRESET } else { 'release' }
$Build = Join-Path $Root "build/$Preset"
$Binary = Join-Path $Build 'native/components/host/gm'

function Invoke-Checked {
    param([scriptblock]$Step)
    & $Step
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Invoke-Build {
    Invoke-Checked { cmake --preset $Preset -S $Root -DGMNEW_BUILD_TESTS=ON }
    Invoke-Checked { cmake --build $Build }
}

function Invoke-Test { Invoke-Checked { ctest --test-dir $Build --output-on-failure } }
function Invoke-Doctor { Invoke-Checked { & $Binary doctor } }

switch ($Command) {
    'build'  { Invoke-Build }
    'test'   { Invoke-Build; Invoke-Test }
    'doctor' { Invoke-Build; Invoke-Doctor }
    'all'    { Invoke-Build; Invoke-Test; Invoke-Doctor }
    default  { Write-Host 'usage: gm.ps1 build|test|doctor|all  (GMNEW_PRESET selects the preset, default release)'; exit 1 }
}
