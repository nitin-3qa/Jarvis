@echo off
setlocal
cd /d "%~dp0"
node "%~dp0jarvis-supervisor.cjs" --check
pause
