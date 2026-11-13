"""JARVIS optional local STT. Binds only to loopback; no credential/file tools.
Run from a project-specific virtual environment after installing faster-whisper.
"""
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HOST = '127.0.0.1'
PORT = 8766
MAX_BYTES = 8_000_000
MODEL = os.environ.get('JARVIS_STT_MODEL', 'tiny.en')
ALLOWED_ORIGINS = {'http://127.0.0.1:5173', 'http://localhost:5173'}
LOCK = threading.Lock()

try:
    from faster_whisper import WhisperModel
except ImportError:
    raise SystemExit('[JARVIS-STT] Missing faster-whisper. Run SETUP-JARVIS-STT.cmd first.')

print(f'[JARVIS-STT] Loading {MODEL}; first run may download model weights.', flush=True)
engine = WhisperModel(MODEL, device='cpu', compute_type='int8', cpu_threads=4)

class Handler(BaseHTTPRequestHandler):
    # Keep payloads and transcripts out of logs.
    def log_message(self, *args):
        pass

    def origin_allowed(self):
        return self.headers.get('Origin', '') in ALLOWED_ORIGINS

    def send_json(self, status, obj):
        payload = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        origin = self.headers.get('Origin', '')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        if not self.origin_allowed():
            return self.send_json(403, {'error': 'origin_denied'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '600')
        self.end_headers()

    def do_GET(self):
        if urlsplit(self.path).path != '/health':
            return self.send_json(404, {'error': 'not_found'})
        # CORS health information is only visible to the allowed frontend origins.
        if 'Origin' in self.headers and not self.origin_allowed():
            return self.send_json(403, {'error': 'origin_denied'})
        self.send_json(200, {'ready': True, 'model': MODEL, 'offline_after_download': True})

    def do_POST(self):
        if urlsplit(self.path).path != '/transcribe':
            return self.send_json(404, {'error': 'not_found'})
        if not self.origin_allowed():
            return self.send_json(403, {'error': 'origin_denied'})
        content_type = self.headers.get('Content-Type', '').lower()
        if not any(content_type.startswith(fmt) for fmt in ('audio/webm', 'audio/ogg', 'audio/mp4')):
            return self.send_json(415, {'error': 'unsupported_audio_type'})
        try:
            size = int(self.headers.get('Content-Length', '-1'))
        except ValueError:
            size = -1
        if not 100 <= size <= MAX_BYTES:
            return self.send_json(413, {'error': 'audio_size_invalid'})
        if not LOCK.acquire(blocking=False):
            return self.send_json(429, {'error': 'transcriber_busy'})
        filename = None
        try:
            extension = '.mp4' if 'mp4' in content_type else '.ogg' if 'ogg' in content_type else '.webm'
            blob = self.rfile.read(size)
            if len(blob) != size:
                return self.send_json(400, {'error': 'incomplete_audio'})
            with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as temp:
                filename = Path(temp.name)
                temp.write(blob)
            segments, info = engine.transcribe(
                str(filename), language='en', beam_size=1, condition_on_previous_text=False,
                vad_filter=True, vad_parameters={'min_silence_duration_ms': 400},
            )
            transcript = ' '.join(s.text.strip() for s in segments).strip()
            self.send_json(200, {'text': transcript[:2000], 'language': 'en'})
        except Exception:
            # Do not expose local paths, driver details, or audio in HTTP responses.
            self.send_json(500, {'error': 'transcription_failed', 'hint': 'See STT service window; check input format and model installation.'})
        finally:
            if filename:
                try:
                    filename.unlink(missing_ok=True)
                except OSError:
                    pass
            LOCK.release()

if __name__ == '__main__':
    print(f'[JARVIS-STT] Ready at http://{HOST}:{PORT}/health; model={MODEL}', flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
