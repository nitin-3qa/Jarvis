/**
 * Pure, testable Ollama inference layer for the original adewaskar/jarvis UI.
 * Zero cloud API calls, zero tool access, zero dependency on Claude.
 * Ollama remains loopback-only.
 */
export const OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_MODEL = 'qwen3:4b-instruct';
export const MAX_PROMPT = 5000;
export const MAX_HISTORY_MESSAGES = 12;
export const MAX_ANSWER_CHARS = 12000;
export const LOCAL_SYSTEM_PROMPT = `You are J.A.R.V.I.S., a professional local voice assistant. Respond clearly and helpfully in concise, natural, spoken English, preferably one to three sentences and under 65 words. You have no laptop control, internet access, email, personal file access, or smart-home tools in this version. Never claim to have performed those actions. You may explain how to do things, but cannot do them for the user. When asked about current events, say you may not have current information. Do not include markdown tables, code fences, or raw JSON in spoken replies.`;

export function safeModelName(raw) {
  if (typeof raw !== 'string' || !/^[\w.:-]{1,90}$/.test(raw)) throw new Error('Invalid JARVIS_LOCAL_MODEL.');
  return raw;
}
export function isAllowedOrigin(origin) {
  return origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173';
}
export function validAsk(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame) || frame.type !== 'ask') return { ok:false, message:'Invalid request.' };
  if (typeof frame.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(frame.id)) return { ok:false, message:'Invalid request ID.' };
  if (typeof frame.text !== 'string' || !frame.text.trim() || frame.text.trim().length > MAX_PROMPT) return {ok:false, message:'The question must contain 1–5,000 characters.'};
  return {ok:true, id:frame.id, text:frame.text.trim()};
}
export function scrubError(err) {
  const msg = String(err?.message || err);
  if (/abort|timeout|timed out/i.test(msg)) return 'Local model request timed out or was cancelled.';
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH/i.test(msg)) return 'Ollama is unavailable at 127.0.0.1:11434. Start Ollama and try again.';
  if (/model.*not found|404/.test(msg.toLowerCase())) return 'Local AI model is not installed. Run ollama pull for the selected model.';
  if (/no response|empty response/i.test(msg.toLowerCase())) return 'The model produced no response.';
  return 'Local inference failed. Check the JARVIS server terminal for details.';
}
export async function probeOllama({fetchFn=fetch, model=DEFAULT_MODEL, signal}={}) {
  try {
    const res = await fetchFn(`${OLLAMA_URL}/api/tags`, {signal:signal ?? AbortSignal.timeout(3000)});
    if (!res.ok) return {ok:false, backend:'ollama', status:'unavailable', model, reason:`HTTP ${res.status}`, tts:false, stt:false};
    const data = await res.json();
    const installed = Array.isArray(data.models) && data.models.some(x => x && x.name === model);
    return {ok:installed, backend:'ollama', status:installed?'ready':'model-missing', model, tts:false, stt:false};
  } catch {
    return {ok:false, backend:'ollama', status:'offline', model, tts:false, stt:false};
  }
}

/** Chat via Ollama's newline-delimited JSON stream; commit history only on success. */
export async function streamLocalAnswer({prompt, history=[], model=DEFAULT_MODEL, signal, onDelta=()=>{}, fetchFn=fetch}) {
  if (!prompt || typeof prompt !== 'string' || prompt.length > MAX_PROMPT) throw new Error('Invalid prompt.');
  const previous = history.filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-MAX_HISTORY_MESSAGES);
  const newHistory = [...previous, {role:'user', content:prompt}];
  const res = await fetchFn(`${OLLAMA_URL}/api/chat`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    signal,
    body:JSON.stringify({model, messages:[{role:'system',content:LOCAL_SYSTEM_PROMPT},...newHistory], stream:true, keep_alive:'20m', options:{temperature:0.45, num_predict: 768, num_ctx: 4096}}),
  });
  if (!res.ok) {
    if (res.status===404) throw new Error('model not found');
    throw new Error(`Ollama returned HTTP ${res.status}`);
  }
  if (!res.body) throw new Error('Empty response stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending=''; let answer=''; let sawDone=false;
  const accept=(line)=>{
    if (!line.trim()) return;
    let evt;
    try {evt=JSON.parse(line);} catch {throw new Error('Malformed Ollama JSON stream');}
    if (evt.error) throw new Error(`Local inference error`);
    if (typeof evt.message?.content==='string') {
      const delta=evt.message.content;
      if (delta) {
        if (answer.length+delta.length>MAX_ANSWER_CHARS) throw new Error('Response length exceeded');
        answer+=delta; if (!signal?.aborted) onDelta(delta);
      }
    }
    if (evt.done) sawDone=true;
  };
  try {
    while(!sawDone){
      if(signal?.aborted) throw signal.reason??new Error('Aborted');
      const {value,done}=await reader.read();
      pending+=decoder.decode(value??new Uint8Array(),{stream:!done});
      if(pending.length>128*1024) throw new Error('Stream packet too large');
      const lines=pending.split('\n'); pending=lines.pop()??'';
      for(const l of lines) {accept(l.trim()); if(sawDone) break;}
      if(done){if(pending.trim()) accept(pending.trim()); break;}
    }
    if (!sawDone) throw new Error('Incomplete Ollama stream');
    if (!answer.trim()) throw new Error('Empty response');
    return {text:answer.trim(), history:[...newHistory,{role:'assistant',content:answer.trim()}].slice(-MAX_HISTORY_MESSAGES)};
  } finally {await reader.cancel().catch(()=>{});}
}
