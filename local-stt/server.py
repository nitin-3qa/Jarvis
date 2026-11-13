"""Loopback-only Whisper STT. Not intended for hosting publicly."""
import json, os, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from faster_whisper import WhisperModel

HOST, PORT = '127.0.0.1', 8766
MODEL_NAME = os.environ.get('JARVIS_WHISPER_MODEL', 'tiny.en')
print(f'[JARVIS-STT] Loading {MODEL_NAME} (first launch may download model)', flush=True)
model = WhisperModel(MODEL_NAME, device='cpu', compute_type='int8', cpu_threads=4)
lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def send_json(self, code, payload):
        data=json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Access-Control-Allow-Origin',self.headers.get('Origin','http://localhost:5173'))
        self.send_header('Vary','Origin')
        self.end_headers()
        self.wfile.write(data)
    def authorized(self):
        origin=self.headers.get('Origin','')
        return not origin or origin in ('http://localhost:5173','http://127.0.0.1:5173')
    def do_OPTIONS(self):
        if not self.authorized(): return self.send_json(403,{'error':'origin_denied'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin',self.headers.get('Origin','http://localhost:5173'))
        self.send_header('Access-Control-Allow-Methods','POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()
    def do_GET(self):
        if self.path != '/health': return self.send_json(404,{'error':'not_found'})
        self.send_json(200,{'ready':True,'model':MODEL_NAME})
    def do_POST(self):
        if self.path != '/transcribe': return self.send_json(404,{'error':'not_found'})
        if not self.authorized(): return self.send_json(403,{'error':'origin_denied'})
        size=int(self.headers.get('Content-Length','0'))
        if not 100 <= size <= 8_000_000: return self.send_json(413,{'error':'invalid_audio_size'})
        mime=self.headers.get('Content-Type','')
        if not mime.startswith(('audio/webm','audio/mp4','audio/ogg')):
            return self.send_json(415,{'error':'unsupported_audio'})
        extension='.mp4' if 'mp4' in mime else '.webm'
        path=None
        try:
            with tempfile.NamedTemporaryFile(suffix=extension,delete=False) as temp:
                path=temp.name
                temp.write(self.rfile.read(size))
            with lock:
                segments, _ = model.transcribe(path, language='en', beam_size=1, vad_filter=True, condition_on_previous_text=False)
                output=' '.join(segment.text.strip() for segment in segments).strip()
            self.send_json(200,{'text':output[:1200]})
        except Exception as error:
            self.send_json(500,{'error':'transcription_failed','detail':str(error)[:200]})
        finally:
            if path and os.path.exists(path): os.unlink(path)

if __name__=='__main__':
    print(f'[JARVIS-STT] Ready: http://{HOST}:{PORT}/health',flush=True)
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
