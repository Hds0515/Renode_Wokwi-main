param(
    [ValidateSet('dev', 'start', 'smoke')]
    [string]$Mode = 'dev',
    [switch]$Install,
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$checkScript = Join-Path $PSScriptRoot 'check-env.ps1'
$nodeModulesPath = Join-Path $repoRoot 'node_modules'
$distIndexPath = Join-Path $repoRoot 'dist\index.html'

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host $Message -ForegroundColor Cyan
    & $Action
    if($LASTEXITCODE -ne 0) {
        throw "Step failed: $Message"
    }
}

Push-Location $repoRoot
try {
    if($Install -or -not (Test-Path $nodeModulesPath)) {
        Invoke-Step -Message 'Installing npm dependencies...' -Action { npm install }
    }

    Invoke-Step -Message 'Checking local toolchain...' -Action { powershell -NoProfile -ExecutionPolicy Bypass -File $checkScript }

    if($Mode -eq 'start' -and -not $SkipBuild -and -not (Test-Path $distIndexPath)) {
        Invoke-Step -Message 'Building renderer bundle for desktop launch...' -Action { npm run build }
    }

    if($Mode -eq 'dev') {
        Write-Host 'Starting development mode...' -ForegroundColor Green
        npm run dev
    } elseif($Mode -eq 'start') {
        Write-Host 'Starting packaged desktop mode...' -ForegroundColor Green
        npm run start
    } else {
        Write-Host 'Running smoke test...' -ForegroundColor Green
        npm run smoke
    }
} finally {
    Pop-Location
}
