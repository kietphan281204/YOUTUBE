@echo off
cd /d "%~dp0"
chcp 65001 >nul
echo ========================================================
echo   HE THONG TU DONG CHAY WEBSITE VA CAP NHAT LINK (CLOUDFLARE)
echo ========================================================
echo.

echo [1/3] Kiem tra may chu Server (Port 8080)...
netstat -ano | findstr LISTENING | findstr :8080 >nul
if %errorlevel% neq 0 (
    echo =^> May chu chua chay. Dang tu dong bat NodeJS len...
    start "Trai Tim Server - CAM TAT" cmd /k "npm.cmd run dev"
    ping 127.0.0.1 -n 4 >nul
) else (
    echo =^> Trang web Server van dang mo tot, bo qua buoc nay!
)

echo.
echo [2/3] Dang mo duong ong Cloudflare de lay link xuyen the gioi...
if exist tunnel.log del tunnel.log
taskkill /F /IM cloudflared.exe >nul 2>&1
start "Nguoi Van Chuyen (Cloudflare) - CAM TAT" cmd /c "cloudflared tunnel --url http://localhost:8080 > tunnel.log 2>&1"

echo Dang cho Cloudflare cap link moi (Mat khoang 5-8 giay, vui long doi...)
:waitloop
ping 127.0.0.1 -n 3 >nul
powershell -Command "if((Select-String -Path tunnel.log -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' -Quiet -ErrorAction SilentlyContinue)){exit 0}else{exit 1}"
if %errorlevel% neq 0 goto waitloop

echo.
echo [3/3] Dang lay link, ap vao Code va day len MANG... (Doi chut nhe)

powershell -Command "$log = Get-Content tunnel.log | Out-String; $match = [regex]::Match($log, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'); if ($match.Success) { $url = $match.Value; Write-Host '=> Da bat duoc link: ' $url; (Get-Content config.js) -replace 'window.API_BASE = \".*\";', \"window.API_BASE = `\"$url`\";\" | Set-Content config.js; } else { Write-Host 'Loi gi do khong tim thay link' }"

git add .
git commit -m "Update system (server logic and stats display)"
git push

echo.
echo ========================================================
echo HOAN THANH XUAT SAC ROI DO BAN OI!!!
echo Vui long cho dung 1 PHUT de Github cap nhat.
echo Sau 1 phut, vao trang web kietphan281204.github.io xem phim thoi!
echo (Vui long THU NHO cac bang mau den xuong day man hinh, KHONG duoc an dau X tat)
echo ========================================================
pause
