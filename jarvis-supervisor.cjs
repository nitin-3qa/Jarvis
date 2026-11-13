'use strict';
/* JARVIS local supervisor: monitors the existing project without modifying source code.
 * Node 20+, Windows 11. Loopback-only. Does not install packages or kill unrelated processes.
 */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const project = path.resolve(__dirname);
const checkOnly = process.argv.includes('--check');
const noBrowser = process.env.JARVIS_NO_BROWSER === '1';
const POLL_MS = 4000;
const RETRY_MS = 6000;
const BROWSER_URL = 'http://127.0.0.1:5173/';
const rootPkg = path.join(project, 'package.json');
const viteBin = path.join(project, 'node_modules', 'vite', 'bin', 'vite.js');
const bridgeBin = path.join(project, 'bridge', 'ollama-local.mjs');
const sttBin = path.join(project, 'local-stt', 'jarvis_stt_v3.py');
const pyBin = path.join(project, 'local-stt', '.venv-v3', 'Scripts', 'python.exe');
const logsDir = path.join(project, 'logs');
let logPath;

function stamp() { return new Date().toISOString(); }
function write(text) {
  const line = `[${stamp()}] ${text}`;
  console.log(line);
  if (logPath) try { fs.appendFileSync(logPath, line + '\n'); } catch { /* best effort */ }
}
function exists(file) { return fs.existsSync(file); }
function initLog() {
  fs.mkdirSync(logsDir, { recursive: true });
  logPath = path.join(logsDir, 'jarvis-supervisor.log');
  if (exists(logPath) && fs.statSync(logPath).size > 3_000_000) {
    fs.renameSync(logPath, path.join(logsDir, 'jarvis-supervisor.previous.log'));
  }
}
function safeHttp(url, timeoutMs=1800) {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(async r => {
    const body = await r.text();
    return { status: r.status, body };
  }).catch(e => ({ status: 0, error: String(e.message || e) }));
}
function isPortListening(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = v => { if (settled) return; settled = true; socket.destroy(); resolve(v); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1200, () => finish(false));
  });
}
function watchOutput(child, label) {
  for (const [streamName, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
    if (!stream) continue;
    let partial = '';
    stream.on('data', chunk => {
      partial += chunk.toString();
      let i;
      while ((i = partial.indexOf('\n')) !== -1) {
        const line = partial.slice(0, i).replace(/\r/g, '').trim();
        partial = partial.slice(i + 1);
        if (line) write(`${label} ${streamName}: ${line.slice(0, 500)}`);
      }
      if (partial.length > 4096) partial = partial.slice(-1024);
    });
  }
}
const defs = [
  {
    id: 'BRIDGE', port: 8787, url: 'http://127.0.0.1:8787/health',
    runnable: () => exists(bridgeBin),
    command: () => process.execPath,
    args: () => [bridgeBin],
    graceMs: 35000,
    validate: r => r.status === 200 && /"(bridge|model|ollama|ok|status)"\s*:/.test(r.body)
  },
  {
    id: 'FRONTEND', port: 5173, url: BROWSER_URL,
    runnable: () => exists(viteBin),
    command: () => process.execPath,
    args: () => [viteBin, '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    graceMs: 35000,
    validate: r => r.status === 200 && /<html|<!doctype/i.test(r.body)
  },
  {
    id: 'WHISPER', port: 8766, url: 'http://127.0.0.1:8766/health',
    runnable: () => exists(pyBin) && exists(sttBin),
    command: () => pyBin,
    args: () => ['-u', sttBin],
    graceMs: 300000,
    validate: r => {
      if (r.status !== 200) return false;
      try { return JSON.parse(r.body).ready === true; } catch { return false; }
    },
    optional: true
  }
];
const states = Object.fromEntries(defs.map(d => [d.id, {
  child: null, active: false, lastLaunch: 0, launches: [], lastStatus: '', unhealthySince: 0,
}]));
let launchedBrowser = false;
let shuttingDown = false;
let busy = false;
let interval;

function setStatus(d, value) {
  const s = states[d.id];
  if (s.lastStatus !== value) { s.lastStatus = value; write(`${d.id}: ${value}`); }
}
function startOwned(d) {
  const s = states[d.id];
  const now = Date.now();
  s.launches = s.launches.filter(t => now - t < 5 * 60_000);
  if (s.launches.length >= 8) { setStatus(d, 'RESTART LIMIT: check logs; no more automatic attempts this session'); return; }
  s.launches.push(now);
  s.lastLaunch = now;
  s.unhealthySince = 0;
  try {
    const child = spawn(d.command(), d.args(), {
      cwd: project, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true, shell: false,
    });
    s.child = child;
    s.active = true;
    write(`Started ${d.id}: PID ${child.pid || 'pending'}`);
    watchOutput(child, d.id);
    child.on('error', e => { s.active = false; s.child = null; write(`${d.id} process error: ${e.message}`); });
    child.on('exit', (code, signal) => {
      s.active = false;
      s.child = null;
      if (!shuttingDown) write(`${d.id} process exited: ${code ?? signal ?? 'unknown'}. Will retry if port is free.`);
    });
  } catch (e) { s.active = false; s.child = null; write(`Cannot start ${d.id}: ${e.message}`); }
}
async function check(d) {
  const response = await safeHttp(d.url);
  return {ok: d.validate(response), response};
}
async function tick() {
  if (shuttingDown || busy) return;
  busy = true;
  try {
    const outcomes = {};
    for (const d of defs) {
      const s = states[d.id];
      const result = await check(d);
      outcomes[d.id] = result.ok;
      if (result.ok) { s.unhealthySince = 0; setStatus(d, 'READY (HTTP 200)'); continue; }
      if (checkOnly) { setStatus(d, `${result.response.status ? 'HTTP ' + result.response.status : 'OFFLINE'}`); continue; }
      if (!d.runnable()) {
        setStatus(d, d.optional ? 'OPTIONAL, files not installed' : 'MISSING required project executable');
        continue;
      }
      if (s.active) {
        // A live HTTP error means the service itself is responding. Restarting
        // it would hide an application / dependency error, not solve it.
        if (result.response.status > 0) {
          setStatus(d, `HTTP ${result.response.status} (service is running; inspect its output)`);
          s.unhealthySince = 0;
          continue;
        }
        s.unhealthySince ||= Date.now();
        if (Date.now() - s.lastLaunch > d.graceMs && Date.now() - s.unhealthySince > 18000) {
          setStatus(d, 'UNRESPONSIVE owned process; requesting restart');
          s.child?.kill();
          s.unhealthySince = Date.now();
        } else setStatus(d, 'STARTING / waiting for health');
        continue;
      }
      if (await isPortListening(d.port)) {
        setStatus(d, `PORT ${d.port} occupied but health check failed. Not killing unknown process`);
        continue;
      }
      if (Date.now() - s.lastLaunch < RETRY_MS) {
        setStatus(d, 'RETRYING soon');
        continue;
      }
      startOwned(d);
    }
    if (!checkOnly && !launchedBrowser && outcomes.FRONTEND && outcomes.BRIDGE) {
      launchedBrowser = true;
      write('Frontend and AI bridge ready. Opening original JARVIS hologram.');
      if (process.platform === 'win32' && !noBrowser) {
        const launcher = spawn('cmd.exe', ['/d', '/c', 'start', '""', BROWSER_URL], {
          cwd: project, stdio: 'ignore', detached: true, windowsHide: true,
        });
        launcher.on('error', e => write(`Browser launch warning: ${e.message}`));
        launcher.unref();
      } else write('Open: ' + BROWSER_URL);
    }
  } catch (err) { write('Unexpected monitor error: ' + err.message); }
  finally { busy = false; }
}
function stop(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (interval) clearInterval(interval);
  write(`Stopping supervisor (${reason}); stopping only processes it started.`);
  for (const d of defs) {
    const s = states[d.id];
    if (s.active && s.child) {
      try { s.child.kill(); } catch { }
    }
  }
  setTimeout(() => process.exit(0), 400).unref();
}
async function main() {
  if (!exists(rootPkg)) { console.error('ERROR: Keep this script in the JARVIS-Stage01 project root with package.json.'); process.exitCode=2; return; }
  if (!checkOnly) initLog();
  write(`JARVIS ${checkOnly ? 'READ-ONLY STATUS CHECK' : 'RELIABLE SUPERVISOR'} — ${project}`);
  if (checkOnly) {
    await tick();
    const required = ['BRIDGE','FRONTEND'];
    process.exitCode = required.every(x=>states[x].lastStatus.startsWith('READY')) ? 0 : 1;
    return;
  }
  write('Keep this window open. Ctrl+C stops supervisor-owned services; existing services are not killed.');
  const ollama = await safeHttp('http://127.0.0.1:11434/api/tags');
  if (ollama.status !== 200) write('OLLAMA: not ready. Start the Ollama Windows application; supervisor will keep checking bridge.');
  process.on('SIGINT', () => stop('Ctrl+C'));
  process.on('SIGTERM', () => stop('terminate'));
  process.on('SIGHUP', () => stop('hangup'));
  await tick();
  interval = setInterval(() => { void tick(); }, POLL_MS);
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode=1; });
module.exports = {safeHttp, isPortListening};
