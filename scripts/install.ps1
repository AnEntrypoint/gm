param([string]$McpConfig = '')

$ErrorActionPreference = 'Stop'

$releaseBase = if ($env:GMNEW_RELEASE_BASE) { $env:GMNEW_RELEASE_BASE } else { 'https://github.com/AnEntrypoint/gm/releases/download/latest' }
$installRoot = Join-Path $env:USERPROFILE '.gmnew'
$currentDir = Join-Path $installRoot 'current'
$exeName = 'gmnew.exe'

$rawArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($rawArchitecture) {
    'AMD64' { 'x64' }
    'ARM64' { 'arm64' }
    default { throw "unsupported architecture: $rawArchitecture" }
}
$target = "$arch-windows"
$package = "gmnew-$target"

$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $manifestPath = Join-Path $work 'manifest.json'
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/manifest.json" -OutFile $manifestPath
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

    $asset = $manifest.assets.$target
    if (-not $asset) { throw "manifest has no asset for $target" }
    if ($asset.file -notlike "gmnew-*-$target.zip") { throw "unexpected asset name for ${target}: $($asset.file)" }

    $archive = Join-Path $work $asset.file
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$($asset.file)" -OutFile $archive

    $actualSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    $actualSize = (Get-Item -LiteralPath $archive).Length
    if ($actualSha -ne $asset.sha256) { throw "sha256 mismatch for $($asset.file): expected $($asset.sha256), got $actualSha" }
    if ($actualSize -ne [long]$asset.size) { throw "size mismatch for $($asset.file): expected $($asset.size), got $actualSize" }

    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    $stage = Join-Path $installRoot ("stage-" + [guid]::NewGuid().ToString())
    try {
        Expand-Archive -LiteralPath $archive -DestinationPath $stage -Force
        $newDir = Join-Path $stage $package
        if (-not (Test-Path -LiteralPath (Join-Path $newDir $exeName))) { throw "archive $($asset.file) does not contain $package\$exeName" }

        $oldDir = Join-Path $installRoot ("previous-" + [guid]::NewGuid().ToString())
        $movedOld = $false
        if (Test-Path -LiteralPath $currentDir) {
            Move-Item -LiteralPath $currentDir -Destination $oldDir
            $movedOld = $true
        }
        try {
            Move-Item -LiteralPath $newDir -Destination $currentDir
        }
        catch {
            if ($movedOld) { Move-Item -LiteralPath $oldDir -Destination $currentDir }
            throw
        }
        if ($movedOld) { Remove-Item -LiteralPath $oldDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
    finally {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }

    $exe = Join-Path $currentDir $exeName
    Write-Output "installed gmnew $($manifest.version) ($target) at $exe"

    if ($env:GMNEW_SKIP_REGISTER -eq '1') {
        Write-Output 'registration skipped (GMNEW_SKIP_REGISTER=1)'
    }
    else {
        $installArgs = @('install')
        if ($McpConfig) { $installArgs += @('--mcp-config', $McpConfig) }
        & $exe @installArgs
        if ($LASTEXITCODE -ne 0) { throw 'gm install failed' }
    }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
