#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$Repo = "AnEntrypoint/agentplug-bin"
$GmRepo = "AnEntrypoint/gm"
$GmToolsDir = Join-Path $env:USERPROFILE ".gm-tools"
$ClaudeSkillsDir = Join-Path $env:USERPROFILE ".claude\skills"

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
        Write-Warning "no release in the 10 most recent carries a $AssetName asset -- falling back to git ls-remote (asset-unverified)"
    } catch {
        Write-Warning "GitHub API release lookup failed: $($_.Exception.Message) -- falling back to git ls-remote (asset-unverified)"
    }
    try {
        $refs = git ls-remote --tags --refs "https://github.com/$Repo.git" 2>$null
        $tags = $refs | ForEach-Object {
            if ($_ -match 'refs/tags/(.+)$') { $Matches[1] }
        } | Sort-Object { [version]($_ -replace '^v','') } -ErrorAction SilentlyContinue
        if ($tags) { return ($tags | Select-Object -Last 1) }
    } catch {}
    return $null
}

function Get-Sha256 {
    param([string]$Path)
    (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Resolve-LatestGmTag {
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$GmRepo/releases/latest" -Headers (Get-GitHubAuthHeaders) -UseBasicParsing -TimeoutSec 15
        if ($release.tag_name) { return $release.tag_name }
    } catch {
        Write-Warning "GitHub API tag lookup failed: $($_.Exception.Message)"
    }
    return $null
}

function Install-Skill {
    $tag = Resolve-LatestGmTag
    if (-not $tag) {
        Write-Error "FATAL: could not resolve latest release tag for $GmRepo"
        exit 1
    }
    $ver = $tag -replace '^v', ''
    Write-Host "gm-skill: resolved latest release $tag"

    $work = Join-Path $env:TEMP "gm-skill-install-$PID"
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    try {
        $base = "https://github.com/$GmRepo/releases/download/$tag"
        $asset = "gm-skill-$ver.tar.gz"
        $assetPath = Join-Path $work $asset
        $shaPath = "$assetPath.sha256"

        Invoke-WebRequest -Uri "$base/$asset" -OutFile $assetPath -UseBasicParsing
        Invoke-WebRequest -Uri "$base/$asset.sha256" -OutFile $shaPath -UseBasicParsing

        $expected = (Get-Content $shaPath -Raw).Trim().Split()[0].ToLowerInvariant()
        $actual = Get-Sha256 -Path $assetPath
        if (-not $expected -or $actual -ne $expected) {
            Write-Error "FATAL: sha256 mismatch for $asset (expected $expected, got $actual)"
            exit 1
        }

        $extractDir = Join-Path $work "extract"
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
        tar -xzf $assetPath -C $extractDir

        New-Item -ItemType Directory -Force -Path $ClaudeSkillsDir | Out-Null
        $target = Join-Path $ClaudeSkillsDir "gm"
        if (Test-Path $target) { Remove-Item -Recurse -Force $target }
        Copy-Item -Recurse -Force (Join-Path $extractDir "skills\gm") $target
        Write-Host "installed gm skill $tag -> $target"
    } finally {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $work
    }
}

# The gm MCP server must start from a LOCAL file, never `npx -y github:...`.
# An `npx` github spec re-resolves the git ref over the network and reinstalls on
# every single (re)connect -- measured 9.1s on an idle machine against 0.75s for
# the same bundle launched locally. An MCP host allows 30s for the whole connect
# handshake, so on a machine under real load (several concurrent gm sessions, the
# runner's wasm pools resident) that network path blows the budget and the host
# reports CONNECT_TIMEOUT. The session then loses the gm tool for the rest of its
# life and falls back to hand-writing spool files. Vendoring the bundle here
# makes connect a plain local `node` start that reaches no network at all.
# Current gm.wasm imports env:host_plugin_call. The retired JS wasm host
# never registered that import, so any boot that still spawned
# plugkit-wasm-wrapper.js died with LinkError and self-healed into a
# restart loop. agentplug-runner already provides the import. Quarantine
# leftover wrapper files so that path cannot be re-entered.
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
    $dest = Join-Path $GmToolsDir "gm-mcp-server.js"
    $tmp = "$dest.tmp.$PID"
    $url = "https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js"
    try {
        Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
        Move-Item -Force $tmp $dest
        Write-Host "installed gm-mcp server -> $dest"
        Write-Host "register it (once) with:"
        Write-Host "  claude mcp remove gm 2>`$null; claude mcp add gm -- node `"$dest`""
    } catch {
        Remove-Item -Force -ErrorAction SilentlyContinue $tmp
        Write-Warning "could not download the gm-mcp server bundle: $($_.Exception.Message) -- the spool protocol still works without it"
    }
}

function Main {
    param([string[]]$RunnerArgs)

    if ($RunnerArgs.Count -gt 0 -and $RunnerArgs[0] -eq "install") {
        Install-Skill
        Install-McpServer
        Remove-RetiredJsHost
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
