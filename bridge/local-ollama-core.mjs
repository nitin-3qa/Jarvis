/** Pure functions and streaming utilities for JARVIS's local Ollama adapter. */
export const MODEL = process.env.JARVIS_MODEL || 'qwen3:4b-instruct';
export const OLLAMA_BASE = 'http://127.0.0.1:11434';
export const SYSTEM_PROMPT = `You are JARVIS, a helpful and precise personal desktop assistant. Speak clearly, naturally and concisely so your replies work well with text-to-speech. You have no access to files, applications, websites, smart devices, or shell commands through this local-only backend. Never claim to have performed a real-world action. If asked for a live fact, disclose that you cannot fetch live information in this mode. Do not emit internal reasoning.`;
export const MAX_PROMPT = 6000;
export const MAX_RESPONSE = 14000;
export const MAX_TURNS = 8;

export function validAsk(payload) {
  if (!payload || typeof payload !== 'object' || payload.type !== 'ask') return 'Expected an ask message.';
  if (typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(payload.id)) return 'Invalid request id.';
  if (typeof payload.text !== 'string' || !payload.text.trim()) return 'The request must contain text.';
  if (payload.text.length > MAX_PROMPT) return `Request exceeds ${MAX_PROMPT} characters.`;
  return null;
}

export function createConversation(history, prompt) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-MAX_TURNS * 2).map(({role, content}) => ({role,content})),
    { role: 'user', content: prompt },
  ];
}

export function addHistory(history, prompt, answer) {
  return [...history, { role: 'user', content: prompt }, { role: 'assistant', content: answer }].slice(-MAX_TURNS * 2);
}

/** Consume Ollama's streaming newline-delimited JSON, tolerating split UTF-8 and JSON chunks. */
export async function readOllamaStream(body, onDelta, signal) {
  if (!body) throw new Error('Ollama returned no response body.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let total = '';
  let completed = false;

  function processLine(line) {
    if (!line.trim()) return;
    let frame;
    try { frame = JSON.parse(line); }
    catch { throw new Error('Ollama returned malformed streaming JSON.'); }
    if (typeof frame.error === 'string') throw new Error(`Ollama: ${frame.error.slice(0, 300)}`);
    const delta = frame.message?.content;
    if (delta !== undefined && typeof delta !== 'string') throw new Error('Ollama returned an invalid content field.');
    if (delta) {
      if (total.length + delta.length > MAX_RESPONSE) throw new Error('Response length limit reached.');
      total += delta;
      onDelta(delta);
    }
    if (frame.done === true) completed = true;
  }

  try {
    while (!completed) {
      if (signal?.aborted) throw signal.reason || new Error('Request interrupted.');
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      if (pending.length > MAX_RESPONSE + 8192) throw new Error('Oversized Ollama streaming frame.');
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        processLine(line);
        if (completed) break;
      }
    }
    if (!completed) {
      pending += decoder.decode();
      if (pending.trim()) processLine(pending.trim());
    }
    if (!completed) throw new Error('Ollama stream ended without a completion event.');
    if (!total.trim()) throw new Error('Ollama completed without a usable text answer.');
    return total;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function allowedOrigin(origin) {
  // Browser connections must come from the expected local Vite development origin.
  // Non-browser clients without Origin are handled separately by the server.
  if (typeof origin !== 'string') return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(u.hostname)) return false;
    if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return false;
    const port = Number(u.port);
    return (port >= 5173 && port <= 5199) || (port >= 4173 && port <= 4199);
  } catch { return false; }
}

export function isLocalAddress(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
