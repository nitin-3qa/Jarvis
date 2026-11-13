/** Real laptop smoke test: run AFTER starting bridge and Ollama. Node 22+. */
import assert from 'node:assert/strict';
const URL_BASE = 'http://127.0.0.1:8787';
const timeout = AbortSignal.timeout(8000);
console.log('1. Checking bridge /health...');
let response;
try { response = await fetch(`${URL_BASE}/health`, { signal: timeout }); }
catch (err) { console.error('FAIL: Bridge cannot be reached:', err.message); process.exit(1); }
const health = await response.json();
console.log(JSON.stringify(health, null, 2));
if (!response.ok) { console.error('FAIL: Ollama or model not ready.'); process.exit(1); }
assert.equal(health.bridge, 'running');
assert.equal(health.model, 'installed');
console.log('2. Testing streaming WebSocket chat...');
const ws = new WebSocket('ws://127.0.0.1:8787');
let deltas = '', ready = false, settled = false;
const timer = setTimeout(() => fail('Timed out waiting for JARVIS answer.'), 190_000);
function fail(message) {
  if (settled) return;
  settled = true;
  console.error('FAIL:', message);
  clearTimeout(timer);
  ws.close();
  process.exitCode = 1;
}
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'ask', id: 'smoke1', text: 'Introduce yourself as Jarvis in one short sentence.' }));
});
ws.addEventListener('message', event => {
  let m;
  try { m = JSON.parse(event.data); } catch { return fail('Invalid JSON from bridge.'); }
  if (m.type === 'ready') ready = true;
  if (m.ask !== 'smoke1') return;
  if (m.type === 'text') deltas += m.delta || '';
  if (m.type === 'error') fail(m.message);
  if (m.type === 'done' && !settled) {
    if (!ready || !deltas.trim()) return fail('Missing ready event or streamed text.');
    settled = true;
    clearTimeout(timer);
    console.log('PASS: Model generated streamed response:\n' + deltas.trim());
    console.log('NOTE: This test does NOT test speakers, microphone, or browser rendering.');
    ws.close();
  }
});
ws.addEventListener('error', () => fail('WebSocket handshake failed.'));
ws.addEventListener('close', () => { if (!settled) fail('WebSocket disconnected before completion.'); });
