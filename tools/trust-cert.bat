@echo off
chcp 65001 >nul
setlocal

REM 在其他电脑上运行此脚本以信任 zhihu_web 的自签名证书（当前用户）。
REM 需要管理员权限（或至少能写入 CurrentUser 证书存储）。

set ROOT=%~dp0..
set CER=%ROOT%\certs\zhihu_web-code-signing.cer

if not exist "%CER%" (
    echo [ERROR] 找不到证书: %CER%
    exit /b 1
)

echo [*] 导入证书到 当前用户\受信任的根证书颁发机构 ...
powershell -NoProfile -Command ^
  "$c=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('%CER%');" ^
  "$r=New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','CurrentUser');" ^
  "$r.Open('ReadWrite');$r.Add($c);$r.Close();" ^
  "$p=New-Object System.Security.Cryptography.X509Certificates.X509Store('TrustedPublisher','CurrentUser');" ^
  "$p.Open('ReadWrite');$p.Add($c);$p.Close();Write-Host '[OK] 证书已导入'"

echo [*] 验证签名:
powershell -NoProfile -Command "Get-AuthenticodeSignature '%ROOT%\build\zhihu_web\zhihu_web.exe' | Select-Object Status,StatusMessage | Format-List"

endlocal
