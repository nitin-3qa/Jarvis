@echo off
setlocal
cd /d "%~dp0"
echo === JARVIS V3 LAUNCHER ===
if not exist "package.json" (
 echo ERROR: Project not found.
 exit /b 1
)
netstat -ano -p TCP | findstr /R /C:":8787 .*LISTENING" >nul
if errorlevel 1 (
 echo Starting local Ollama bridge in a separate terminal...
 start "JARVIS Bridge 8787" /D "%CD%" cmd /k "node bridge\ollama-local.mjs"
) else echo Found listener on port 8787 (verify it is JARVIS).
netstat -ano -p TCP | findstr /R /C:":5173 .*LISTENING" >nul
if errorlevel 1 (
 echo Starting Vite in a separate terminal...
 start "JARVIS Vite 5173" /D "%CD%" cmd /k "npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort"
) else echo Found listener on port 5173 (verify it is Vite).
if exist "local-stt\.venv-v3\Scripts\python.exe" (
 netstat -ano -p TCP | findstr /R /C:":8766 .*LISTENING" >nul
 if errorlevel 1 (
  echo Starting offline Whisper in a separate terminal...
  start "JARVIS Whisper 8766" /D "%CD%" cmd /k "START-JARVIS-STT.cmd"
 ) else echo Found listener on port 8766.
) else echo Offline Whisper is not installed. Browser speech fallback will be available.
echo Running real bridge diagnostic...
node scripts\JARVIS-V3-DOCTOR.cjs
if errorlevel 1 (
 echo Some checks failed. Read diagnostic errors. The webpage may still open.
) else echo AI diagnostic passed.
start "" "http://127.0.0.1:5173/jarvis-console-v3.html"
echo Keep the bridge, Vite and optional Whisper windows running.
exit /b 0
