@echo off
setlocal
cd /d "%~dp0"

set "APP_PORT=4173"

if not exist "apps\web\dist\index.html" goto :nobuild
if not exist "apps\server\dist\index.js" goto :nobuild

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-local.ps1" -Port %APP_PORT%
if errorlevel 1 goto :problem

start "" "http://127.0.0.1:%APP_PORT%/"
exit /b 0

:problem
echo.
echo 本机服务未能启动。若端口 %APP_PORT% 被其他应用占用，请关闭该应用后重试；
echo 服务日志位于 data\logs\ 目录。
pause
exit /b 1

:nobuild
echo 尚未构建应用，请先在本目录运行：npm run build
pause
exit /b 1
