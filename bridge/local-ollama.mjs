/**
 * JARVIS local Ollama bridge. This is a standalone alternative to bridge/server.mjs,
 * not a replacement for or modification to the original Claude Agent SDK backend.
 * Requires the existing `ws` dependency already declared in package.json.
 */
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  MODEL, OLLAMA_BASE, MAX_RESPONSE, MAX_PROMPT,
  allowedOrigin, isLocalAddress, validAsk, createConversation,
  addHistory, readOllamaStream,
} from './local-ollama-core.mjs';

// Bind dual-stack loopback names so browsers using localhost (often ::1 on Windows)
// and clients using 127.0.0.1 both reach the same bridge. HTTP and WS handlers
// still reject non-loopback peers; this is not a LAN service.
const HOST = '::';
const PORT = 8787;
const REQUEST_TIMEOUT_MS = 180_000;
const OLLAMA_IDLE_MS = 80_000;
const MAX_ACTIVE_CLIENTS = 4;
const clients = new Set();
let shuttingDown = false;

const send = (ws, frame) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
};

const safeError = (err) => {
  if (err?.name === 'AbortError') return 'Local AI request cancelled or timed out.';
  if (err instanceof TypeError && /fetch|connect/i.test(err.message)) return 'Cannot reach local Ollama on port 11434.';
  return String(err?.message || err || 'Unknown local AI failure.').slice(0, 350);
};

async function getModelStatus() {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 2500);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: ac.signal });
    if (!res.ok) return { ollama: 'unavailable', model: 'unknown' };
    const data = await res.json();
    const installed = Array.isArray(data.models) && data.models.some(m => m.name === MODEL || m.model === MODEL);
    return { ollama: 'reachable', model: installed ? 'installed' : 'missing' };
  } catch {
    return { ollama: 'unavailable', model: 'unknown' };
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!isLocalAddress(req.socket.remoteAddress)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Loopback clients only');
    return;
  }
  if (req.url !== '/health' || req.method !== 'GET') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const status = await getModelStatus();
  const healthy = status.ollama === 'reachable' && status.model === 'installed';
  res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ backend: 'jarvis-local-ollama', bridge: 'running', modelName: MODEL, ...status, activeClients: clients.size }));
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  // Browser requests have Origin. A local diagnostic CLI may omit it.
  if (shuttingDown || req.url !== '/' || !isLocalAddress(req.socket.remoteAddress) ||
      (origin !== undefined && !allowedOrigin(origin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (clients.size >= MAX_ACTIVE_CLIENTS) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  clients.add(ws);
  let history = [];
  let active = null;
  const completedIds = new Set();
  send(ws, { type: 'ready', servers: [], provider: 'ollama', model: MODEL });

  function abortActive() {
    if (active) {
      const current = active;
      active = null;                 // Invalidate pending callbacks before aborting.
      current.abort.abort();
      clearTimeout(current.totalTimer);
      clearTimeout(current.idleTimer);
    }
  }

  function refreshIdle(task) {
    clearTimeout(task.idleTimer);
    task.idleTimer = setTimeout(() => task.abort.abort(new Error('Ollama stopped streaming.')), OLLAMA_IDLE_MS);
  }

  async function handleAsk(message) {
    const error = validAsk(message);
    if (error) {
      send(ws, { type: 'error', ask: typeof message?.id === 'string' ? message.id : undefined, message: error });
      return;
    }
    const { id } = message;
    if (active?.id === id) return; // A retransmitted active turn must not fail the original.
    if (completedIds.has(id)) {
      send(ws, { type: 'error', ask: id, message: 'Duplicate request ID.' });
      return;
    }
    abortActive();
    const prompt = message.text.trim();
    const task = { id, abort: new AbortController(), totalTimer: null, idleTimer: null };
    active = task;
    completedIds.add(id);
    if (completedIds.size > 128) completedIds.delete(completedIds.values().next().value);
    task.totalTimer = setTimeout(() => task.abort.abort(new Error('Local AI request exceeded its time limit.')), REQUEST_TIMEOUT_MS);
    refreshIdle(task);

    try {
      const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        signal: task.abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, stream: true, think: false,
          messages: createConversation(history, prompt),
          options: { num_predict: 512, temperature: 0.5 },
          keep_alive: '5m',
        }),
      });
      if (!response.ok) {
        const responseBody = (await response.text().catch(() => '')).slice(0, 200);
        throw new Error(response.status === 404 ? `Ollama model ${MODEL} not available.` : `Ollama HTTP ${response.status}: ${responseBody}`);
      }
      const answer = await readOllamaStream(response.body, delta => {
        if (active !== task) return;
        refreshIdle(task);
        send(ws, { type: 'text', ask: id, delta });
      }, task.abort.signal);
      if (active !== task) return;
      history = addHistory(history, prompt, answer.slice(0, MAX_RESPONSE));
      send(ws, { type: 'done', ask: id, text: answer });
    } catch (err) {
      if (active !== task) return; // Cancellation and superseded turns stay silent.
      send(ws, { type: 'error', ask: id, message: safeError(err) });
    } finally {
      clearTimeout(task.totalTimer);
      clearTimeout(task.idleTimer);
      if (active === task) active = null;
    }
  }

  ws.on('message', (raw, binary) => {
    if (binary) { send(ws, { type: 'error', message: 'Binary frames are unsupported.' }); return; }
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); }
    catch { send(ws, { type: 'error', message: 'Invalid JSON.' }); return; }
    if (payload?.type === 'interrupt') { abortActive(); return; }
    if (payload?.type === 'reset') { abortActive(); history = []; send(ws, { type: 'ready', servers: [], provider: 'ollama', model: MODEL }); return; }
    if (payload?.type !== 'ask') {
      send(ws, { type: 'error', ask: payload?.id, message: 'Unsupported message type in local-only mode.' });
      return;
    }
    void handleAsk(payload);
  });
  ws.on('close', () => { abortActive(); clients.delete(ws); history = []; });
  ws.on('error', () => { abortActive(); clients.delete(ws); history = []; });
});

server.on('error', err => {
  console.error(`[JARVIS] Cannot start local bridge on ${HOST}:${PORT}: ${err.message}`);
  process.exitCode = 1;
});
server.listen(PORT, HOST, () => {
  console.log(`[JARVIS] Local Ollama bridge ws://localhost:${PORT} (dual-stack loopback)`);
  console.log(`[JARVIS] Diagnostics: http://127.0.0.1:${PORT}/health`);
  console.log(`[JARVIS] Model: ${MODEL} | No Claude calls | No desktop tools`);
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const ws of clients) ws.close(1001, 'Server shutting down');
  wss.close();
  server.close();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
