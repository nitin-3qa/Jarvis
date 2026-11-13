@echo off
cd /d "%~dp0"
if not exist "local-stt\.venv-v3\Scripts\python.exe" (
 echo Offline STT not installed. Run SETUP-JARVIS-STT.cmd first.
 exit /b 1
)
echo Loading local Whisper. First launch may download model weights.
echo This window must remain open for local transcription.
"local-stt\.venv-v3\Scripts\python.exe" "local-stt\jarvis_stt_v3.py"
if errorlevel 1 echo Whisper failed; inspect error above.
exit /b %errorlevel%
