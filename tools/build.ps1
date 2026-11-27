# zhihu_web build script (Windows PowerShell 5.1 compatible, ASCII only on purpose:
# .ps1 files without a BOM are read as ANSI by powershell.exe).
#
# Deliberately boring toolchain: the C# compiler that ships with .NET Framework
# plus the vendored WebView2 SDK. No dotnet SDK, no MSBuild project, no NuGet
# restore, no node_modules, no bundler.
#
#   powershell -File tools\build.ps1              # x64 -> build\zhihu_web
#   powershell -File tools\build.ps1 -Arch x86    # 32-bit build
#   powershell -File tools\build.ps1 -Run         # build and start
#   powershell -File tools\build.ps1 -Diagnose    # build and run the API self-test

[CmdletBinding()]
param(
    [ValidateSet('x64', 'x86', 'arm64')]
    [string]$Arch = 'x64',
    [switch]$Run,
    [switch]$Diagnose,
    [switch]$Clean,
    [switch]$SideBySide
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'src'
$hostDir = Join-Path $src 'desktop-win'
$web = Join-Path $src 'web'
$lib = Join-Path $root 'lib\webview2'
$out = Join-Path $root $(if ($SideBySide) { 'build\zhihu_web-network-fix' } else { 'build\zhihu_web' })
$exe = Join-Path $out 'zhihu_web.exe'

if ($Clean -and (Test-Path $out)) {
    Remove-Item $out -Recurse -Force
}

if ($Arch -eq 'x86') {
    $frameworkDir = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319'
} else {
    $frameworkDir = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
}
$csc = Join-Path $frameworkDir 'csc.exe'
if (-not (Test-Path $csc)) {
    throw "C# compiler not found: $csc (.NET Framework 4.x is required)."
}

$dotnetRelease = 0
try {
    $dotnetRelease = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction Stop).Release
} catch { }
if ($dotnetRelease -lt 528040) {
    Write-Warning ".NET Framework 4.8 not detected (Release=$dotnetRelease). The app may not start."
}

New-Item -ItemType Directory -Force -Path $out | Out-Null

# --- 1. web assets -----------------------------------------------------------
$webOut = Join-Path $out 'web'
if (Test-Path $webOut) { Remove-Item $webOut -Recurse -Force }
Copy-Item $web $webOut -Recurse -Force

# --- 2. dependencies --------------------------------------------------------
Copy-Item (Join-Path $lib 'net462\Microsoft.Web.WebView2.Core.dll') $out -Force
Copy-Item (Join-Path $lib 'net462\Microsoft.Web.WebView2.WinForms.dll') $out -Force
Copy-Item (Join-Path $lib "loader\$Arch\WebView2Loader.dll") $out -Force
Copy-Item (Join-Path $lib 'LICENSE-WebView2SDK.txt') $out -Force
Copy-Item (Join-Path $hostDir 'zhihu_web.exe.config') $out -Force

$iconSource = Join-Path $hostDir 'res\app.ico'
if (Test-Path $iconSource) { Copy-Item $iconSource $out -Force }

# --- 3. compile -------------------------------------------------------------
$sources = @(Get-ChildItem (Join-Path $hostDir '*.cs') | ForEach-Object { $_.FullName })
$referenceNames = @(
    'System.dll',
    'System.Core.dll',
    'System.Drawing.dll',
    'System.Windows.Forms.dll',
    'System.Net.Http.dll',
    'System.Web.Extensions.dll',
    (Join-Path $lib 'net462\Microsoft.Web.WebView2.Core.dll'),
    (Join-Path $lib 'net462\Microsoft.Web.WebView2.WinForms.dll')
)
$references = @()
foreach ($name in $referenceNames) {
    if (Test-Path $name) {
        $references += (Resolve-Path $name).Path
    } else {
        $references += (Join-Path $frameworkDir $name)
    }
}

$arguments = @(
    '/nologo',
    '/target:winexe',
    "/platform:$Arch",
    '/langversion:5',
    '/optimize+',
    '/debug-',
    "/out:$exe",
    "/win32manifest:$(Join-Path $hostDir 'app.manifest')"
)
foreach ($reference in $references) { $arguments += "/r:$reference" }
if (Test-Path $iconSource) { $arguments += "/win32icon:$iconSource" }
$arguments += $sources

Write-Host "compiling zhihu_web ($Arch) ..." -ForegroundColor Cyan
& $csc @arguments
if ($LASTEXITCODE -ne 0) { throw "compile failed (exit $LASTEXITCODE)" }
if (-not (Test-Path $exe)) { throw "compiler did not produce $exe" }

# --- 4. ship docs next to the binary ---------------------------------------
foreach ($name in 'LICENSE', 'NOTICE.md', 'README.md') {
    $file = Join-Path $root $name
    if (Test-Path $file) { Copy-Item $file $out -Force }
}

$totalMb = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Host ("done: {0}  ({1} MB)" -f $exe, $totalMb) -ForegroundColor Green

# --- 5. optional actions ----------------------------------------------------
if ($Run) {
    Start-Process -FilePath $exe
}

if ($Diagnose) {
    Write-Host "running self-test (up to 70s) ..." -ForegroundColor Cyan
    $report = Join-Path $env:LOCALAPPDATA 'zhihu_web\data\diagnose.json'
    if (Test-Path $report) { Remove-Item $report -Force }
    $process = Start-Process -FilePath $exe -ArgumentList '--diagnose' -PassThru
    $deadline = (Get-Date).AddSeconds(70)
    while ((Get-Date) -lt $deadline -and -not (Test-Path $report)) {
        Start-Sleep -Milliseconds 500
    }
    if (Test-Path $report) {
        Get-Content $report -Raw
    } else {
        Write-Warning "self-test produced no report: $report"
    }
    if (-not $process.HasExited) { $process.Kill() }
}
