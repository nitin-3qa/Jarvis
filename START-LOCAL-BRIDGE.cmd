@echo off
setlocal
cd /d "%~dp0"
echo.
echo JARVIS - local Ollama bridge (no Claude subscription)
echo ==================================================
if not exist "bridge\local-ollama.mjs" (
  echo ERROR: Local bridge files are missing. Install the patch first.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo ERROR: Project dependencies are missing.
  echo Please review your project and run npm.cmd install from the project directory if necessary.
  pause
  exit /b 1
)
node "bridge\local-ollama.mjs"
set "EXITCODE=%ERRORLEVEL%"
echo.
echo JARVIS local bridge stopped. Exit code: %EXITCODE%
pause
exit /b %EXITCODE%
