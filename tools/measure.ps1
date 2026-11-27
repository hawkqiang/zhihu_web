# Measure startup speed, memory, CPU, disk footprint, and capture a window screenshot.
[CmdletBinding()]
param(
    [string]$OutShot = '',
    [int]$WaitSec = 8
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'build\zhihu_web\zhihu_web.exe'
$data = Join-Path $root '.testdata'
if (-not $OutShot) { $OutShot = Join-Path $root '.work\app-hot.png' }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutShot) | Out-Null
if (Test-Path $data) { Remove-Item $data -Recurse -Force -EA SilentlyContinue }
New-Item -ItemType Directory -Force -Path $data | Out-Null

Get-Process zhihu_web -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Start-Sleep -Milliseconds 400

$env:ZHIHU_WEB_DATA = $data
$beforeWv = @(Get-Process msedgewebview2 -EA SilentlyContinue | Select-Object -ExpandProperty Id)

& cmd.exe /c "start `"`" `"$exe`""
Start-Sleep -Seconds $WaitSec

$p = Get-Process zhihu_web -EA SilentlyContinue | Select-Object -First 1
if (-not $p) {
    Write-Warning "zhihu_web.exe is not running"
    if (Test-Path (Join-Path $data 'app.log')) { Get-Content (Join-Path $data 'app.log') }
    return
}

Write-Host ("APP pid={0} title=[{1}] responding={2} cpu={3:N3}s ws={4:N2}MB pm={5:N2}MB" -f `
    $p.Id, $p.MainWindowTitle, $p.Responding, $p.CPU, ($p.WorkingSet64 / 1MB), ($p.PrivateMemorySize64 / 1MB))

$newWv = @(Get-Process msedgewebview2 -EA SilentlyContinue | Where-Object { $beforeWv -notcontains $_.Id })
$wvWs = (($newWv | Measure-Object WorkingSet64 -Sum).Sum) / 1MB
$wvPm = (($newWv | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB
$wvCpu = ($newWv | Measure-Object CPU -Sum).Sum
Write-Host ("WV2 procs={0} totalWS={1:N2}MB totalPM={2:N2}MB totalCPU={3:N3}s" -f $newWv.Count, $wvWs, $wvPm, $wvCpu)

$cpu1 = $p.CPU + $wvCpu
Start-Sleep -Seconds 3
$p.Refresh()
$wvCpu2 = 0.0
foreach ($w in $newWv) {
    $w.Refresh()
    $wvCpu2 += $w.CPU
}
$cpu2 = $p.CPU + $wvCpu2
Write-Host ("IDLE_CPU_3S={0:N3}s ({1:N2}% of 1 core)" -f ($cpu2 - $cpu1), (($cpu2 - $cpu1) / 3.0 * 100.0))

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[WinApi]::SetProcessDPIAware() | Out-Null

$p.Refresh()
if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    [WinApi]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
    [WinApi]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 700
    $r = New-Object WinApi+RECT
    [WinApi]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left
    $h = $r.Bottom - $r.Top
    Write-Host "RECT=${w}x${h} at $($r.Left),$($r.Top)"
    if ($w -gt 100 -and $h -gt 100) {
        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
        $bmp.Save($OutShot, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose()
        $bmp.Dispose()
        Write-Host "SHOT=$OutShot"
    }
}

Write-Host "--- metrics.jsonl ---"
$mf = Join-Path $data 'metrics.jsonl'
if (Test-Path $mf) { Get-Content $mf } else { Write-Host "(none)" }

Write-Host "--- app.log ---"
$lf = Join-Path $data 'app.log'
if (Test-Path $lf) { Get-Content $lf } else { Write-Host "(none)" }

$p.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 2
if (-not $p.HasExited) { $p.Kill() }

$buildMb = [math]::Round(((Get-ChildItem (Join-Path $root 'build\zhihu_web') -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
$dataMb = [math]::Round(((Get-ChildItem $data -Recurse -File -EA SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Host ("DISK build={0}MB profile={1}MB" -f $buildMb, $dataMb)
