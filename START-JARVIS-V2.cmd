@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
cd /d "%ROOT%"
title JARVIS V2 START
echo === JARVIS V2 LOCAL START ===
if not exist "package.json" (echo ERROR: Put this launcher in the JARVIS project root.& pause & exit /b 1)
if not exist "bridge\ollama-local.mjs" (echo ERROR: Local Ollama bridge missing.& pause & exit /b 1)
if not exist "scripts\JARVIS-V2-DOCTOR.cjs" (echo ERROR: V2 doctor missing.& pause & exit /b 1)
where node.exe >nul 2>nul
if errorlevel 1 (echo ERROR: Node.js not found in PATH.& pause & exit /b 1)
where npm.cmd >nul 2>nul
if errorlevel 1 (echo ERROR: npm.cmd not found in PATH.& pause & exit /b 1)

REM Start processes in separate windows. Running servers are never terminated.
node -e "fetch('http://127.0.0.1:8787/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
if errorlevel 1 (
 node -e "const n=require('net').connect(8787,'127.0.0.1');n.on('connect',()=>process.exit(0));n.on('error',()=>process.exit(1));n.setTimeout(1500,()=>process.exit(1))"
 if not errorlevel 1 (
  echo WARNING: Port 8787 is occupied but its health endpoint is not ready.
  echo Will not create another bridge process. The Doctor will diagnose it.
 ) else (
  echo Launching local AI bridge in another window...
  start "JARVIS - BRIDGE" /D "%ROOT%" cmd.exe /k "node .\bridge\ollama-local.mjs"
 )
) else (
 echo Bridge already responds at 127.0.0.1:8787
)
node -e "fetch('http://127.0.0.1:5173/',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
if errorlevel 1 (
 node -e "const n=require('net').connect(5173,'127.0.0.1');n.on('connect',()=>process.exit(0));n.on('error',()=>process.exit(1));n.setTimeout(1500,()=>process.exit(1))"
 if not errorlevel 1 (
  echo WARNING: Port 5173 is occupied but HTTP is not ready.
  echo Will not create another frontend process. The Doctor will diagnose it.
 ) else (
  echo Launching frontend in another window...
  start "JARVIS - FRONTEND" /D "%ROOT%" cmd.exe /k "npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort"
 )
) else (
 echo Frontend already responds at 127.0.0.1:5173
)

echo.
echo Checking both live services and sending a REAL model question...
node "scripts\JARVIS-V2-DOCTOR.cjs"
if errorlevel 1 (
 echo.
 echo Diagnostic did not pass. Check the two server windows and messages above.
 pause
 exit /b 1
)
echo.
echo Starting JARVIS V2 console...
start "" "http://127.0.0.1:5173/jarvis-console-v2.html"
echo Leave the separate server terminals open.
pause
exit /b 0
