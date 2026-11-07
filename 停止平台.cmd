@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not defined APP_PORT set "APP_PORT=4173"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-local.ps1" -Port %APP_PORT%
exit /b %ERRORLEVEL%
