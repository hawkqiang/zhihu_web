@echo off
chcp 65001 >nul
setlocal

REM zhihu_web sign script (Windows).
REM Signs build\zhihu_web\zhihu_web.exe with an Authenticode certificate.
REM
REM The certificate PRIVATE KEY is never committed to the public repository.
REM This script uses the "zhihu_web Code Signing" certificate already installed
REM in the current user's certificate store. Run tools\trust-cert.bat once, or
REM install your own purchased code-signing certificate, before signing.
REM
REM For a production release with public trust, install a purchased code-signing
REM certificate (EV/OV) into Cert:\CurrentUser\My and change $subject below.

set ROOT=%~dp0..
set EXE=%ROOT%\build\zhihu_web\zhihu_web.exe

if not exist "%EXE%" (
    echo [ERROR] Executable not found: %EXE%
    exit /b 1
)

echo [*] Signing %EXE% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$subject='CN=zhihu_web Code Signing';" ^
  "$cert=Get-ChildItem Cert:\CurrentUser\My | Where-Object {$_.Subject -eq $subject -and $_.HasPrivateKey} | Select-Object -First 1;" ^
  "if(-not $cert){Write-Host '[ERROR] No code-signing certificate found. Run tools\\trust-cert.bat first.';exit 1};" ^
  "$r=Set-AuthenticodeSignature -FilePath '%EXE%' -Certificate $cert -HashAlgorithm SHA256;" ^
  "Write-Host ('Sign status: ' + $r.Status + ' - ' + $r.StatusMessage);" ^
  "if($r.Status -ne 'Valid'){exit 1}"

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Signing failed.
    exit /b 1
)

echo [OK] Signing complete.
powershell -NoProfile -Command "Get-AuthenticodeSignature '%EXE%' | Select-Object Status,StatusMessage,SignerCertificate | Format-List"

endlocal
