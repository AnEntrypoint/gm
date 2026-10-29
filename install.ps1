#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

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
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers (Get-GitHubAuthHeaders) -UseBasicParsing -TimeoutSec 15
    } catch {
        Write-Warning "GitHub API release lookup for $Repo failed: $($_.Exception.Message); refusing to install an older or unverified release"
        return $null
    }
    if (-not $release.tag_name) { return $null }
    if (-not ($release.assets | Where-Object { $_.name -eq $AssetName })) {
        Write-Warning "the latest release of $Repo ($($release.tag_name)) carries no $AssetName asset; refusing to install an older release"
        return $null
    }
    return $release.tag_name
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

function Install-McpServer {
    New-Item -ItemType Directory -Force -Path $GmToolsDir | Out-Null
    $dest = Join-Path $GmToolsDir "gm-mcp-server.mjs"
    $tmp = "$dest.tmp.$PID"
    $url = "https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js"
    try {
        Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
        Move-Item -Force $tmp $dest
        Write-Host "installed gm-mcp server -> $dest"
    } catch {
        Remove-Item -Force -ErrorAction SilentlyContinue $tmp
        Write-Error "could not download the gm-mcp server bundle: $($_.Exception.Message)"
        exit 1
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Error "Node.js is needed to run the gm MCP server. Install it from https://nodejs.org, then run: node `"$dest`" register"
        exit 1
    }
    # The bundle registers itself by absolute path, so no shell expands $HOME or ~ on the way.
    & node $dest register
    if ($LASTEXITCODE -ne 0) { throw "gm register failed (exit $LASTEXITCODE)" }
}

function Main {
    param([string[]]$RunnerArgs)

    if ($RunnerArgs.Count -eq 0 -or $RunnerArgs[0] -eq "install") {
        Install-McpServer
        Remove-RetiredJsHost
        Write-Host "skills are served over MCP only (prompts /mcp__gm__<name>, resources skill://); no skill files were installed."
        Write-Host "done. Restart Claude Code, then run /gm."
        return
    }

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
    Invoke-WebRequest -Uri "$base/$asset" -OutFile $tmp -UseBasicParsing
    Invoke-WebRequest -Uri "$base/$asset.sha256" -OutFile $shaFile -UseBasicParsing

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

    & $dest @RunnerArgs
    exit $LASTEXITCODE
}

Main -RunnerArgs $args
