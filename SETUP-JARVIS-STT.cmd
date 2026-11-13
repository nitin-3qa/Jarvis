@echo off
setlocal
cd /d "%~dp0"
set "PYTHON_EXE="
echo === OPTIONAL LOCAL WHISPER SETUP ===
echo This installs Python packages only in this project's local-stt\.venv-v3.
echo No global Windows security settings, backend, or Ollama files are changed.
echo First voice model download requires internet. Type Y to continue.
choice /C YN /N /M "Install offline STT dependencies? [Y/N] "
if errorlevel 2 exit /b 1
if not exist "local-stt\jarvis_stt_v3.py" (
 echo ERROR: V3 speech server missing. Run INSTALL-JARVIS-V3.cmd first.
 exit /b 1
)
if not exist "local-stt\.venv-v3\Scripts\python.exe" (
 where py >nul 2>&1
 if not errorlevel 1 (
  py -3.12 -m venv "local-stt\.venv-v3" >nul 2>&1
  if errorlevel 1 py -3.11 -m venv "local-stt\.venv-v3" >nul 2>&1
  if errorlevel 1 py -3 -m venv "local-stt\.venv-v3"
 ) else (
  where python >nul 2>&1
  if errorlevel 1 (
   echo ERROR: Python missing. Install supported Python 3.11/3.12 from python.org.
   exit /b 1
  )
  python -m venv "local-stt\.venv-v3"
 )
)
if not exist "local-stt\.venv-v3\Scripts\python.exe" (
 echo ERROR: Could not create Python virtual environment.
 exit /b 1
)
"local-stt\.venv-v3\Scripts\python.exe" -m pip install --disable-pip-version-check "faster-whisper>=1.1,<2" "av<19"
if errorlevel 1 (
 echo ERROR: Python package installation failed. See output above.
 exit /b 1
)
echo SUCCESS: STT libraries installed inside project.
echo Run START-JARVIS-STT.cmd and let it download model on first launch.
exit /b 0
