JARVIS RELIABLE START / RECOVERY

Purpose: Fix recurring ERR_CONNECTION_REFUSED from Vite on 127.0.0.1:5173.

Extract into existing JARVIS-Stage01 project folder (containing package.json).
Do not replace bridge/ollama-local.mjs, src/, or local-stt code.
Double-click START-JARVIS-RELIABLE.cmd and keep the window open.

The supervisor starts only services that are not healthy / not listening:
  - Vite on 127.0.0.1:5173 using your existing node_modules/vite
  - Local AI bridge on 127.0.0.1:8787 using existing bridge/ollama-local.mjs
  - Optional Whisper on 127.0.0.1:8766 if its existing .venv-v3 is installed

It checks HTTP status every 4 seconds, restarts services it owns when they crash,
and refuses to kill unrelated processes occupying a port.
It opens the original hologram only when frontend and bridge are ready.
It does not reinstall software, change security policy, or modify source.

Windows-specific notes:
  - Node.js >=20 required, and project node_modules must already be installed.
  - Ollama Windows app must be running; this tool does not reinstall or restart Ollama.
  - The command window must stay open; Windows sign-out or shutdown stops the supervisor.
  - Do not concurrently run an old JARVIS launcher as it may compete for ports.
  - Logs at logs/jarvis-supervisor.log (rolls over at approx 3 MB on next start).
  - CHECK-JARVIS-STATUS.cmd performs a read-only health check.

The original holographic page is http://127.0.0.1:5173/
To stop, press Ctrl+C in the supervisor window.

Limitations: HTTP ready does not prove microphone, Whisper transcription, or speech output.
Those require a real Windows hardware test. This is a launcher/availability repair only.
