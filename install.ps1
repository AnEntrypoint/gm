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

function Main {
    param([string[]]$RunnerArgs)

    if ($RunnerArgs.Count -gt 0 -and $RunnerArgs[0] -eq "install") {
        Install-Skill
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

    & $dest @RunnerArgs
    exit $LASTEXITCODE
}

Main -RunnerArgs $args
