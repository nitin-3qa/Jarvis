import {spawn} from 'node:child_process';
import process from 'node:process';
import {existsSync} from 'node:fs';

if(!existsSync('bridge/ollama-local.mjs') || !existsSync('node_modules/vite/bin/vite.js')){
  console.error('Missing JARVIS local bridge or Vite dependencies. Run Install-Phase01.ps1 first.');
  process.exit(1);
}
const env={...process.env,VITE_BRIDGE_URL:'ws://127.0.0.1:8787', VITE_TTS_ENGINE:process.env.JARVIS_VOICE_ENGINE || 'system', VITE_KOKORO_VOICE:'bm_george',JARVIS_ALLOW_WRITES:'0'};
let closing=false;
const children=[];
function launch(tag,args){
  const child=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:false});
  children.push(child);
  child.stdout.on('data',data=>process.stdout.write(`[${tag}] ${data}`));
  child.stderr.on('data',data=>process.stderr.write(`[${tag}] ${data}`));
  child.on('error',err=>{console.error(`[${tag}] startup error: ${err.message}`);stop(1);});
  child.on('exit',code=>{if(!closing){console.error(`[${tag}] process ended (${code}). Shutting down the session.`);stop(code||1);}});
}
function stop(code=0){
  if(closing)return;
  closing=true;
  for(const child of children){if(child.exitCode===null)try{child.kill();}catch{}}
  setTimeout(()=>process.exit(code),450);
}
process.on('SIGINT',()=>stop(0));
process.on('SIGTERM',()=>stop(0));
console.log('JARVIS FREE LOCAL MODE — no Claude, no paid APIs, no computer tools');
launch('local-AI',['bridge/ollama-local.mjs']);
launch('hologram',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort']);
console.log('Open http://127.0.0.1:5173 in Chrome; click INITIALISE; press T to test audio.');
