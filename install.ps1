#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$Repo = "AnEntrypoint/agentplug-bin"
$GmRepo = "AnEntrypoint/gm"
$GmToolsDir = Join-Path $env:USERPROFILE ".gm-tools"
$ClaudeSkillsDir = Join-Path $env:USERPROFILE ".claude\skills"
$AgentsSkillsDir = Join-Path $env:USERPROFILE ".agents\skills"
$SkillInstallRoots = @($ClaudeSkillsDir, $AgentsSkillsDir)
$SkillModeLedger = ".gm-skill-install-modes"
$SkillPreLinkDir = ".gm-skill-prelink"

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

function Resolve-LatestGmTag {
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$GmRepo/releases/latest" -Headers (Get-GitHubAuthHeaders) -UseBasicParsing -TimeoutSec 15
        if ($release.tag_name) { return $release.tag_name }
    } catch {
        Write-Warning "GitHub API tag lookup failed: $($_.Exception.Message)"
    }
    return $null
}

function Install-SkillAssets {
    param([string]$SourceRoot, [string]$DestRoot)

    $manifest = Join-Path $SourceRoot "skills/skill-assets.txt"
    if (-not (Test-Path $manifest)) {
        Write-Warning "no skill asset manifest at $manifest"
        return
    }
    foreach ($line in @(Get-Content $manifest)) {
        $rel = ($line.Trim()) -replace '/', [IO.Path]::DirectorySeparatorChar
        if (-not $rel -or $rel.StartsWith("#")) { continue }
        $src = Join-Path $SourceRoot (Join-Path "skills" $rel)
        if (-not (Test-Path $src)) {
            Write-Warning "skill asset absent at $src"
            continue
        }
        $dest = Join-Path $DestRoot $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Path $dest -Parent) | Out-Null
        Copy-Item -Force $src $dest
        Write-Host "installed skill asset $rel -> $dest"
    }
}

function Write-SkillModeLedger {
    param([string]$Root, [string]$Name, [string]$Mode, [string]$Source)

    $file = Join-Path $Root $SkillModeLedger
    $kept = @()
    if (Test-Path $file) {
        foreach ($line in @(Get-Content $file)) {
            $t = $line.Trim()
            if (-not $t -or $t.StartsWith("#")) { continue }
            if (($t -split '\s+')[0] -ne $Name) { $kept += $t }
        }
    }
    $kept += "$Name $Mode $([DateTime]::UtcNow.ToString('o')) $Source"
    $tmp = "$file.tmp.$PID"
    Set-Content -Path $tmp -Value (@("# gm skill install modes: <name> <linked|copied|refused> <iso-ts> <source>") + $kept) -Encoding utf8
    Move-Item -Force $tmp $file
    Remove-Item -Force -ErrorAction SilentlyContinue $tmp
}

function Resolve-LocalSkillSource {
    $override = $env:GM_SKILL_SOURCE_DIR
    if ($override -and (Test-Path (Join-Path $override "gm\SKILL.md"))) { return $override }
    if (-not $PSScriptRoot) { return $null }
    $local = Join-Path $PSScriptRoot "skills"
    if (Test-Path (Join-Path $local "gm\SKILL.md")) { return $local }
    return $null
}

function Remove-SkillTarget {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if (-not $item) { return }
    if ($item.LinkType) { Remove-Item -LiteralPath $Path -Force; return }
    Remove-Item -LiteralPath $Path -Recurse -Force
}

# Clears the way for a copy install. A displaced directory is parked under the
# dotted prelink dir, never deleted; deletion needs GM_SKILL_LINK_FORCE=1.
function Clear-ReleaseTarget {
    param([string]$Root, [string]$Name)
    $dest = Join-Path $Root $Name
    $item = Get-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
    if (-not $item) { return $true }
    if ($item.LinkType) { Remove-Item -LiteralPath $dest -Force; return $true }
    $park = Join-Path $Root $SkillPreLinkDir
    New-Item -ItemType Directory -Force -Path $park | Out-Null
    $aside = Join-Path $park "$Name-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    try {
        Move-Item -LiteralPath $dest -Destination $aside -Force -ErrorAction Stop
        Write-Host "parked displaced $Name at $aside"
        return $true
    } catch {
        if ($env:GM_SKILL_LINK_FORCE -eq '1') {
            Remove-Item -LiteralPath $dest -Recurse -Force
            return $true
        }
        Write-Warning "REFUSED $Name -> ${dest}: could not park the existing install ($($_.Exception.Message)); rerun with GM_SKILL_LINK_FORCE=1 to replace it"
        return $false
    }
}

function Install-OneSkill {
    param([string]$SourceDir, [string]$Name, [string]$Root)

    $dest = Join-Path $Root $Name
    $item = Get-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType) {
        $current = if ($item.Target) { ($item.Target -join '') } else { $null }
        if ($current -and $current.TrimEnd('\') -eq $SourceDir.TrimEnd('\')) {
            Write-SkillModeLedger -Root $Root -Name $Name -Mode "linked" -Source $SourceDir
            Write-Host "linked $Name -> $dest => $SourceDir (already the source directory)"
            return
        }
        Remove-Item -LiteralPath $dest -Force
    } elseif ($item) {
        $park = Join-Path $Root $SkillPreLinkDir
        New-Item -ItemType Directory -Force -Path $park | Out-Null
        $aside = Join-Path $park "$Name-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        try {
            Move-Item -LiteralPath $dest -Destination $aside -Force -ErrorAction Stop
        } catch {
            Write-SkillModeLedger -Root $Root -Name $Name -Mode "refused" -Source $SourceDir
            Write-Warning "REFUSED $Name -> ${dest}: could not move the existing install aside ($($_.Exception.Message)); it stays a COPY and will drift from $SourceDir -- rerun with -ForceLink to replace it"
            return
        }
    }

    try {
        New-Item -ItemType Junction -Path $dest -Value $SourceDir -ErrorAction Stop | Out-Null
        Write-SkillModeLedger -Root $Root -Name $Name -Mode "linked" -Source $SourceDir
        Write-Host "linked $Name (junction) -> $dest => $SourceDir (edits to the source are served immediately)"
        return
    } catch {
        $junctionError = $_.Exception.Message
    }
    try {
        New-Item -ItemType SymbolicLink -Path $dest -Value $SourceDir -ErrorAction Stop | Out-Null
        Write-SkillModeLedger -Root $Root -Name $Name -Mode "linked" -Source $SourceDir
        Write-Host "linked $Name (symlink) -> $dest => $SourceDir (edits to the source are served immediately)"
        return
    } catch {
        $symlinkError = $_.Exception.Message
    }
    Copy-Item -Recurse -Force $SourceDir $dest
    Write-SkillModeLedger -Root $Root -Name $Name -Mode "copied" -Source $SourceDir
    Write-Warning "$Name -> ${dest} is a COPY (junction failed: $junctionError; symlink failed: $symlinkError); it is NOT the file at $SourceDir and will drift silently -- recorded in $(Join-Path $Root $SkillModeLedger)"
}

function Test-InstalledSkills {
    param([string]$SourceRoot)

    $drift = @()
    foreach ($root in $SkillInstallRoots) {
        foreach ($d in Get-ChildItem -Directory $SourceRoot | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") }) {
            $dest = Join-Path $root (Join-Path $d.Name "SKILL.md")
            if (-not (Test-Path $dest)) { continue }
            $src = Join-Path $d.FullName "SKILL.md"
            if ((Get-Sha256 -Path $src) -ne (Get-Sha256 -Path $dest)) {
                Write-Warning "DRIFT $($d.Name) at ${dest}: contents differ from $src"
                $drift += $dest
                continue
            }
            $a = Get-Item -LiteralPath $src
            $b = Get-Item -LiteralPath $dest
            if (-not $b.LinkType -and $a.FullName -ne $b.FullName) {
                Write-Warning "DRIFT $($d.Name) at ${dest}: contents match but it is a SEPARATE file, so the next source edit will not reach it"
                $drift += $dest
            }
        }
    }
    if ($drift.Count -eq 0) { Write-Host "skill check: every installed skill is the source file" }
}

function Install-SkillFromSource {
    param([string]$SourceRoot)

    Write-Host "gm-skill source: $SourceRoot -- installing from the checkout, not a release tarball"
    foreach ($root in $SkillInstallRoots) {
        New-Item -ItemType Directory -Force -Path $root | Out-Null
        foreach ($d in Get-ChildItem -Directory $SourceRoot | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") }) {
            Install-OneSkill -SourceDir $d.FullName -Name $d.Name -Root $root
        }
    }
    Test-InstalledSkills -SourceRoot $SourceRoot
}

function Install-Skill {
    $localSource = Resolve-LocalSkillSource
    if ($localSource) {
        Install-SkillFromSource -SourceRoot $localSource
        return
    }

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
        # Windows' own bsdtar: a Git or MSYS tar on PATH reads "C:\..." as a remote host and fails.
        $tar = Join-Path $env:SystemRoot "System32\tar.exe"
        if (-not (Test-Path $tar)) { $tar = "tar" }
        & $tar -xzf $assetPath -C $extractDir
        if ($LASTEXITCODE -ne 0) { throw "could not extract $asset (tar exit $LASTEXITCODE)" }

        foreach ($root in $SkillInstallRoots) {
            New-Item -ItemType Directory -Force -Path $root | Out-Null
            Get-ChildItem -Directory (Join-Path $extractDir "skills") | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") } | ForEach-Object {
                $target = Join-Path $root $_.Name
                if (-not (Clear-ReleaseTarget -Root $root -Name $_.Name)) {
                    Write-SkillModeLedger -Root $root -Name $_.Name -Mode "refused" -Source "release:$tag"
                    return
                }
                Copy-Item -Recurse -Force $_.FullName $target
                Write-SkillModeLedger -Root $root -Name $_.Name -Mode "copied" -Source "release:$tag"
                Write-Warning "$($_.Name) -> ${target} is a COPY with no local source beside this installer; it will not track a checkout -- set GM_SKILL_SOURCE_DIR (or run from a gm checkout) to install it as a link"
            }
            Install-SkillAssets -SourceRoot $extractDir -DestRoot $root
        }
    } finally {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $work
    }
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
        Install-Skill
        Install-McpServer
        Remove-RetiredJsHost
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
