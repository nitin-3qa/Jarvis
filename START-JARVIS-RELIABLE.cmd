@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title JARVIS - Reliable Startup & Recovery
if not exist "package.json" (
  echo ERROR: This launcher must be in the JARVIS-Stage01 project folder.
  pause
  exit /b 1
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  pause
  exit /b 1
)
echo === JARVIS RELIABLE START / AUTO-RECOVERY ===
echo Keep this window open while using JARVIS.
echo It will open the holographic page when Vite and the AI bridge are ready.
echo Press Ctrl+C once to stop the supervisor.
echo.
node "%~dp0jarvis-supervisor.cjs"
echo.
echo Supervisor exited. See logs\jarvis-supervisor.log for details.
pause
