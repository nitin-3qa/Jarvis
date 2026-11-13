'use strict';
// Non-destructive diagnostic. Requires only the existing ws package in the JARVIS project.
const WebSocket = require('ws');
const sleep = ms => new Promise(r => setTimeout(r,ms));
const BASE = 'http://127.0.0.1:5173';
const BRIDGE = 'http://127.0.0.1:8787';

async function check(url,label,assertBody){
  let last='unknown';
  for(let attempt=0;attempt<16;attempt++){
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(2500)});
      if(!response.ok)throw Error('HTTP '+response.status);
      const body=await response.text();
      if(assertBody&&!assertBody.test(body))throw Error('Unexpected response body');
      console.log('PASS',label,'HTTP',response.status);
      return body;
    }catch(err){ last=err.message; await sleep(750); }
  }
  throw Error(label+' unavailable: '+last);
}
async function verifyWebSocket(){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket('ws://127.0.0.1:8787/',{
      origin:BASE,handshakeTimeout:6000
    });
    const id='doctor_'+Date.now();
    let answer='',completed=false,sent=false;
    const timer=setTimeout(()=>finish(Error('AI response timed out (120 seconds)')),120000);
    function finish(err){
      if(completed)return;
      completed=true;clearTimeout(timer);
      ws.terminate();
      err?reject(err):resolve(answer);
    }
    ws.on('error',e=>finish(Error('WebSocket handshake/network: '+e.message)));
    ws.on('unexpected-response',(_req,res)=>{
      res.resume();finish(Error('WebSocket rejected: HTTP '+res.statusCode));
    });
    ws.on('close',()=>{if(!completed)finish(Error('WebSocket closed before completion'));});
    ws.on('message',raw=>{
      let frame;
      try{frame=JSON.parse(raw.toString());}catch{return;}
      if(frame.type==='ready'&&!sent){
        sent=true;
        console.log('PASS Bridge ready event',String(frame.model||''));
        try{ws.send(JSON.stringify({type:'ask',id,text:'Hello JARVIS. Reply in a single short sentence.'}));}
        catch(e){finish(e);}return;
      }
      if(frame.type==='error'&&(!frame.ask||frame.ask===id)){
        finish(Error('AI returned error: '+String(frame.message||'unknown')));return;
      }
      if(frame.ask!==id)return;
      if(frame.type==='text')answer+=String(frame.delta??frame.text??'');
      if(frame.type==='done'){
        answer=answer||String(frame.text||'');
        if(!answer.trim())finish(Error('AI replied with empty text'));
        else finish();
      }
    });
  });
}
(async()=>{
  console.log('\n=== JARVIS V2 INTEGRATION CHECK ===');
  await check(BASE+'/','Vite frontend',/html|J\.A\.R\.V\.I\.S/i);
  await check(BASE+'/jarvis-console-v2.html','V2 console',/Local voice &amp; text control|id="log"/);
  const raw=await check(BRIDGE+'/health','Bridge health');
  try{const health=JSON.parse(raw);console.log('Bridge reports:',JSON.stringify(health).slice(0,500));}catch{console.log('Bridge health returned non-JSON content');}
  const answer=await verifyWebSocket();
  console.log('PASS WebSocket streaming and AI response');
  console.log('Model answer:',answer.slice(0,300));
  console.log('\nNETWORK + AI CHECKS PASSED.');
  console.log('Still check microphone recognition and audible speaker output manually in Chrome/Edge.');
})().catch(error=>{console.error('\nFAIL:',error.message);process.exitCode=1;});
