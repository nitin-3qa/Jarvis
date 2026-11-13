'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
let WebSocket;
try{WebSocket=require('ws')}catch{console.error('ERROR: ws dependency not found; run npm.cmd install only if the project truly lacks it.');process.exit(1)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,timeout=2500){return new Promise((resolve,reject)=>{const req=http.get(url,res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.setTimeout(timeout,()=>req.destroy(Error('timeout')))} )}
async function waitGet(url,attempts=20){let last;for(let i=0;i<attempts;i++){try{let status=await get(url);if(status===200)return status;last=`HTTP ${status}`}catch(e){last=e.message}await sleep(1000)}throw Error(`${url}: ${last}`)}
async function wsTest(){return new Promise((resolve,reject)=>{const sock=new WebSocket('ws://127.0.0.1:8787/',{origin:'http://127.0.0.1:5173',handshakeTimeout:8000});const id='doctor_'+Date.now();let answer='';let finished=false;const timer=setTimeout(()=>finish(false,'AI test timed out after 75 seconds'),75000);
  function finish(ok,msg){if(finished)return;finished=true;clearTimeout(timer);sock.terminate();ok?resolve(msg):reject(Error(msg))}
  sock.on('message',raw=>{let f;try{f=JSON.parse(raw.toString())}catch{return}if(f.type==='ready'){sock.send(JSON.stringify({type:'ask',id,text:'Answer with just one short greeting sentence.'}));return}if(f.type==='error'&&(!f.ask||f.ask===id)){finish(false,'Bridge error: '+f.message);return}if(f.ask!==id)return;if(f.type==='text')answer+=String(f.delta||f.text||'');if(f.type==='done'){answer=answer||String(f.text||'');finish(Boolean(answer.trim()),'AI reply: '+answer.slice(0,300))}});
  sock.on('error',e=>finish(false,'WebSocket error: '+e.message));sock.on('close',()=>finish(false,'Connection closed early'));
})}
(async()=>{console.log('=== JARVIS V3 LIVE CHECK ===');let failed=false;
  for(const [name,url] of [['Vite','http://127.0.0.1:5173/'],['V3 page','http://127.0.0.1:5173/jarvis-console-v3.html'],['Bridge','http://127.0.0.1:8787/health']]){
    try{await waitGet(url);console.log('PASS',name)}catch(e){failed=true;console.error('FAIL',name,e.message)}}
  try{console.log('PASS',await wsTest())}catch(e){failed=true;console.error('FAIL',e.message)}
  try{const s=await get('http://127.0.0.1:8766/health',1500);console.log(s===200?'PASS':'WARN','Offline Whisper health:',s)}catch{console.log('INFO Offline Whisper not running; optional')} 
  console.log(failed?'RESULT: NEEDS ATTENTION':'RESULT: NETWORK + AI VERIFIED. AUDIO NEEDS A REAL MICROPHONE TEST.');process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1});
