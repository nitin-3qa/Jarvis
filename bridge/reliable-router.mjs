/** Priority read-only routing. Never model-generate numeric live facts. */
import {classifyLive,getLiveContext} from './web-intelligence.mjs';
import {placeCategory,nearbyCoffeeSearch} from './nearby.mjs';
const hasNearby = q => /\b(near me|nearby|closest|around me|around here)\b/i.test(q) && Boolean(placeCategory(q));
const timeoutMs = 14000;
export async function routeQuestion(question,{fetchFn=fetch,signal,searchKey}={}) {
 const q=String(question||'').slice(0,2000);
 const kind=hasNearby(q)?'nearby':classifyLive(q);
 if(!kind)return null;
 const ctl=new AbortController();
 const onAbort=()=>ctl.abort(); signal?.addEventListener('abort',onAbort,{once:true});
 const timer=setTimeout(()=>ctl.abort(),timeoutMs);
 const started=Date.now();
 try {
  if(kind==='nearby')return {kind, text:await nearbyCoffeeSearch(q,{fetchFn,signal:ctl.signal}),source:'OpenStreetMap',elapsedMs:Date.now()-started};
  const result=await getLiveContext(q,{fetchFn,signal:ctl.signal,searchKey});
  return {kind,text:result?.text??'No live data available.',source:result?.sources?.[0]??null,elapsedMs:Date.now()-started,ok:result?.ok===true};
 } catch(err) {
  return {kind,text:'The live service is temporarily unavailable. I cannot verify the requested information right now.',ok:false,elapsedMs:Date.now()-started,error:String(err?.message??err)};
 } finally {clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
