#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"
$installer = Join-Path $PSScriptRoot "bin/gm-install.js"
if (-not (Test-Path $installer)) { throw "Use a local SolutionsAsService/gm checkout/package; bundled installer missing." }
if ($args.Count -ge 2 -and $args[0] -eq '--with-runtime' -and $args[1] -eq '--runner-only') {
    $args = @($args | Select-Object -Skip 2)
    if ($args.Count -ne 1 -or $args[0] -ne "spool") { throw "Internal runner path accepts only spool; use Node CLI for help/dry-run." }
} else {
    & node $installer @args
    exit $LASTEXITCODE
}


$Repo = "AnEntrypoint/agentplug-bin"
$GmToolsDir = Join-Path $env:USERPROFILE ".gm-tools"

function Resolve-AssetName {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
    switch ($arch) {
        "AMD64" { return "agentplug-runner-windows-x64.exe" }
        "ARM64" { return "agentplug-runner-windows-arm64.exe" }
        default { return $null }
    }
}

function Get-GitHubAuthHeaders {
    $token = $env:GITHUB_TOKEN
    if (-not $token) { $token = $env:GH_TOKEN }
    if ($token) { return @{ Authorization = "Bearer $token" } }
    return @{}
}

function Resolve-InstallableTag {
    param([string]$AssetName)
    try {
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=10" -Headers (Get-GitHubAuthHeaders) -UseBasicParsing -TimeoutSec 15
        foreach ($release in $releases) {
            if (-not $release.tag_name) { continue }
            $hasAsset = $release.assets | Where-Object { $_.name -eq $AssetName }
            if ($hasAsset) { return $release.tag_name }
            Write-Warning "release $($release.tag_name) has no $AssetName asset -- trying the next older release"
        }
        Write-Warning "no release in the 10 most recent carries a $AssetName asset"
    } catch {
        Write-Warning "GitHub API release lookup failed: $($_.Exception.Message)"
    }
    return $null
}

function Get-Sha256 {
    param([string]$Path)
    (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Remove-RetiredJsHost {
    $retiredDir = Join-Path $GmToolsDir "retired-js-host"
    $names = @("plugkit-wasm-wrapper.js", "supervisor.js", "bootstrap.js")
    $moved = $false
    foreach ($name in $names) {
        $src = Join-Path $GmToolsDir $name
        if (-not (Test-Path $src)) { continue }
        if (-not $moved) {
            New-Item -ItemType Directory -Force -Path $retiredDir | Out-Null
            $moved = $true
        }
        Move-Item -Force $src (Join-Path $retiredDir $name)
        Write-Host "quarantined retired JS host file $name -> $retiredDir (cannot link env:host_plugin_call)"
    }
    $wrapperDir = Join-Path $GmToolsDir "wrapper"
    if (Test-Path $wrapperDir) {
        if (-not $moved) {
            New-Item -ItemType Directory -Force -Path $retiredDir | Out-Null
        }
        $destDir = Join-Path $retiredDir "wrapper"
        if (Test-Path $destDir) { Remove-Item -Recurse -Force $destDir }
        Move-Item -Force $wrapperDir $destDir
        Write-Host "quarantined retired JS host directory wrapper -> $retiredDir"
    }
}

function Main {
    param([string[]]$RunnerArgs)

    $asset = Resolve-AssetName
    if (-not $asset) {
        Write-Error "FATAL: no published agentplug-runner binary for platform=windows arch=$($env:PROCESSOR_ARCHITECTURE)"
        exit 1
    }

    $tag = Resolve-InstallableTag -AssetName $asset
    if (-not $tag) {
        Write-Error "FATAL: no release of $Repo (checked the 10 most recent) carries a $asset asset"
        exit 1
    }
    Write-Host "agentplug-runner: resolved installable release $tag"

    New-Item -ItemType Directory -Force -Path $GmToolsDir | Out-Null
    $base = "https://github.com/$Repo/releases/download/$tag"
    $dest = Join-Path $GmToolsDir "agentplug-runner.exe"
    $tmp = "$dest.tmp.$PID"
    $shaFile = "$dest.sha256.tmp.$PID"

    Write-Host "downloading $base/$asset"
    Invoke-WebRequest -Uri "$base/$asset" -OutFile $tmp -UseBasicParsing -TimeoutSec 30
    Invoke-WebRequest -Uri "$base/$asset.sha256" -OutFile $shaFile -UseBasicParsing -TimeoutSec 30

    $expected = (Get-Content $shaFile -Raw).Trim().Split()[0].ToLowerInvariant()
    $actual = Get-Sha256 -Path $tmp
    if (-not $expected -or $actual -ne $expected) {
        Write-Error "FATAL: sha256 mismatch for $asset (expected $expected, got $actual)"
        Remove-Item -Force -ErrorAction SilentlyContinue $tmp, $shaFile
        exit 1
    }
    Remove-Item -Force $shaFile

    try {
        if (Test-Path $dest) { Remove-Item -Force $dest }
        Move-Item -Force $tmp $dest
        Set-Content -Path (Join-Path $GmToolsDir "agentplug-runner.version") -Value $tag -NoNewline
        Write-Host "installed agentplug-runner $tag -> $dest"
    } catch {
        $staged = "$dest.new"
        Move-Item -Force $tmp $staged
        Write-Warning "agentplug-runner is currently running and locked; staged update at $staged (adopted on its next self-update handoff)"
        if (-not (Test-Path $dest)) {
            Write-Error "FATAL: no existing agentplug-runner at $dest to fall back to"
            exit 1
        }
    }

    Remove-RetiredJsHost

    $runner = Start-Process -FilePath $dest -ArgumentList $RunnerArgs -PassThru -NoNewWindow
    if (-not $runner.WaitForExit(120000)) {
        $runner.Kill()
        throw "agentplug-runner timed out after 120 seconds"
    }
    exit $runner.ExitCode
}

Main -RunnerArgs $args
