/** Opt-in, public, read-only RSS retrieval; no API key or account required. */
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff))).trim();
const field=(s,key)=>decode(s.match(new RegExp(`<${key}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${key}>`,'i'))?.[1]??'');
export function liveIntent(text){
  const q=text.toLowerCase();
  if(/\b(near me|nearby|closest|around me)\b/.test(q) && /\b(coffee|cafe|cafes|coffee shops?)\b/.test(q))return 'nearby';
  if(/\b(weather|temperature|forecast)\b/.test(q))return 'weather';
  if(/\b(news|headlines|current events|breaking|hacker news)\b/.test(q))return 'news';
  if(/\b(today|latest|live|yesterday|tonight|recent|score|result|match)\b/.test(q) && /\b(match|sports?|football|soccer|cricket|ipl|nba|tennis|score|game)\b/.test(q))return 'sports';
  return null;
}
export async function getLiveBrief(intent,question,{fetchFn=fetch}={}){
  if(intent==='nearby')return 'I can help find nearby places, but this local JARVIS build does not have your location or a verified places database. Tell me your city or area, or open OpenStreetMap and search for coffee shops near your location: https://www.openstreetmap.org/ . I will not invent businesses or distances.';
  if(intent==='weather')return 'For a live weather report, tell me the city. Weather lookup is not enabled in this build.';
  const topic=intent==='sports'?'sports match results today':/hacker news/i.test(question)?'technology Hacker News today':'top world news today';
  const url='https://news.google.com/rss/search?q='+encodeURIComponent(topic)+'&hl=en-IN&gl=IN&ceid=IN:en';
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),9000);
  try{
    const response=await fetchFn(url,{signal:controller.signal,headers:{'User-Agent':'JARVIS-Local-RSS/1.0'}});
    if(!response.ok)throw new Error('Feed status '+response.status);
    const xml=await response.text();if(xml.length>1000000)throw new Error('Feed too large');
    const items=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,5).map(m=>({title:field(m[1],'title').slice(0,180),link:field(m[1],'link'),date:field(m[1],'pubDate')})).filter(x=>x.title&&/^https:\/\//.test(x.link));
    if(!items.length)throw new Error('No headlines');
    return `Here are recent ${intent==='sports'?'sports headlines (not verified live scores)':'headlines'} from a public news feed, retrieved ${new Date().toLocaleString('en-IN')}:\n`+items.slice(0,4).map((x,i)=>`${i+1}. ${x.title} (${x.date||'publication time unavailable'}) — ${x.link}`).join('\n')+'\nI cannot confirm final scores or breaking updates beyond these linked reports.';
  }catch{return 'I could not retrieve current public headlines right now. Please check your internet connection or try again later; I will not invent live results.';}
  finally{clearTimeout(timeout);}
}
