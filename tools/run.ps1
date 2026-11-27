# zhihu_web launcher (ASCII only: no BOM means ANSI for powershell.exe).
#
#   powershell -File tools\run.ps1              # start the app
#   powershell -File tools\run.ps1 -Diagnose    # API self-test, print report
#   powershell -File tools\run.ps1 -DataDir     # open the local data folder
#
# Processes are detached through `cmd /c start` on purpose: a GUI app inheriting
# the caller's console/handles keeps some shells waiting forever.

[CmdletBinding()]
param(
    [switch]$Diagnose,
    [switch]$DataDir
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'build\zhihu_web\zhihu_web.exe'

if (-not (Test-Path $exe)) {
    & (Join-Path $PSScriptRoot 'build.ps1')
}

function Start-Detached([string]$Path, [string]$Arguments) {
    if ($Arguments) {
        & cmd.exe /c "start `"`" `"$Path`" $Arguments"
    } else {
        & cmd.exe /c "start `"`" `"$Path`""
    }
}

$data = Join-Path $env:LOCALAPPDATA 'zhihu_web\data'
if ($env:ZHIHU_WEB_DATA) { $data = $env:ZHIHU_WEB_DATA }

if ($DataDir) {
    if (-not (Test-Path $data)) { New-Item -ItemType Directory -Force $data | Out-Null }
    Start-Process explorer.exe $data
    return
}

if ($Diagnose) {
    $report = Join-Path $data 'diagnose.json'
    if (Test-Path $report) { Remove-Item $report -Force }
    Start-Detached $exe '--diagnose'
    for ($i = 0; $i -lt 160; $i++) {
        if (Test-Path $report) { break }
        Start-Sleep -Milliseconds 500
    }
    if (Test-Path $report) {
        Get-Content $report -Raw
    } else {
        Write-Warning "self-test produced no report: $report"
        $log = Join-Path $data 'app.log'
        if (Test-Path $log) { Get-Content $log -Tail 20 }
    }
    return
}

Start-Detached $exe ''
Write-Host "zhihu_web started: $exe"
