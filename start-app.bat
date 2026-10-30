@echo off
title WUElev8 Smart Proctoring Browser Launcher
echo ========================================================
echo   Starting WUElev8 Smart Proctoring Browser
echo ========================================================
set ELECTRON_RUN_AS_NODE=

:: Clear any stale Electron lock or zombie instances
taskkill /f /im electron.exe >nul 2>&1

:: Check if backend server is already running on port 5000
netstat -ano | findstr :5000 | findstr LISTENING >nul
if %errorlevel% neq 0 (
    echo [1/2] Starting backend server...
    start /b "" node server/dist/index.js
    timeout /t 2 /nobreak >nul
) else (
    echo [1/2] Backend server is already running on port 5000.
)

echo [2/2] Launching Electron desktop window...
call npx electron .

