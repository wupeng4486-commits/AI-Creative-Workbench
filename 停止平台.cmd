@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-local.ps1" -Port 4173
timeout /t 1 /nobreak >nul
exit /b 0
