Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$bundledRenode = Join-Path $repoRoot 'renode\renode\renode.exe'

function Find-ToolPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    try {
        $command = Get-Command $Name -ErrorAction Stop
        return $command.Source
    } catch {
        return $null
    }
}

function Write-Status {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [bool]$Found,
        [string]$Detail = ''
    )

    $prefix = if($Found) { '[OK] ' } else { '[Missing] ' }
    $color = if($Found) { 'Green' } else { 'Yellow' }
    if([string]::IsNullOrWhiteSpace($Detail)) {
        Write-Host "$prefix$Label" -ForegroundColor $color
    } else {
        Write-Host "$prefix$Label - $Detail" -ForegroundColor $color
    }
}

$nodePath = Find-ToolPath 'node'
$npmPath = Find-ToolPath 'npm'
$gccPath = Find-ToolPath 'arm-none-eabi-gcc'
$gdbPath = Find-ToolPath 'arm-none-eabi-gdb'
$renodePath = if(Test-Path $bundledRenode) { $bundledRenode } else { Find-ToolPath 'renode' }
$nodeModulesPath = Join-Path $repoRoot 'node_modules'
$electronPath = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe'
$nodeDetail = if($nodePath) { $nodePath } else { 'Install Node.js 16+ and expose it on PATH.' }
$npmDetail = if($npmPath) { $npmPath } else { 'npm is usually installed together with Node.js.' }
$renodeDetail = if($renodePath) { $renodePath } else { 'Install Renode and expose `renode` on PATH.' }
$gccDetail = if($gccPath) { $gccPath } else { 'Install arm-none-eabi-gcc and expose it on PATH.' }
$gdbDetail = if($gdbPath) { $gdbPath } else { 'Optional for stepping and breakpoints, but recommended.' }
$nodeModulesDetail = if(Test-Path $nodeModulesPath) { $nodeModulesPath } else { 'Run `npm install` in the repo root.' }
$electronDetail = if(Test-Path $electronPath) { $electronPath } else { 'Run `npm install` to download Electron.' }

Write-Host 'Renode Local Visualizer environment check' -ForegroundColor Cyan
Write-Host "Repo: $repoRoot" -ForegroundColor DarkGray
Write-Host ''

Write-Status -Label 'Node.js' -Found ([bool]$nodePath) -Detail $nodeDetail
Write-Status -Label 'npm' -Found ([bool]$npmPath) -Detail $npmDetail
Write-Status -Label 'Renode' -Found ([bool]$renodePath) -Detail $renodeDetail
Write-Status -Label 'ARM GCC' -Found ([bool]$gccPath) -Detail $gccDetail
Write-Status -Label 'ARM GDB' -Found ([bool]$gdbPath) -Detail $gdbDetail
Write-Status -Label 'node_modules' -Found (Test-Path $nodeModulesPath) -Detail $nodeModulesDetail
Write-Status -Label 'Electron binary' -Found (Test-Path $electronPath) -Detail $electronDetail

$missingRequired = @()
if(-not $nodePath) { $missingRequired += 'Node.js' }
if(-not $npmPath) { $missingRequired += 'npm' }
if(-not $renodePath) { $missingRequired += 'Renode' }
if(-not $gccPath) { $missingRequired += 'arm-none-eabi-gcc' }

Write-Host ''
if($missingRequired.Count -gt 0) {
    Write-Host ('Required tools missing: ' + ($missingRequired -join ', ')) -ForegroundColor Red
    exit 1
}

Write-Host 'Required tools are ready.' -ForegroundColor Green
exit 0
