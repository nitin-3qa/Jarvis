/** Opt-in, read-only OpenStreetMap places search for JARVIS. */
const COORD_RE = /\[JARVIS_GEO:([-+]?\d{1,2}\.\d{1,6}),([-+]?\d{1,3}\.\d{1,6})\]/;
const RAD = Math.PI / 180;
const distanceKm = (a,b,c,d) => 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin((c-a)*RAD/2)**2+Math.cos(a*RAD)*Math.cos(c*RAD)*Math.sin((d-b)*RAD/2)**2)));
export function parseNearbyCoords(text) {
 const m=String(text).match(COORD_RE); if(!m)return null;
 const lat=Number(m[1]),lon=Number(m[2]);
 return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon}:null;
}
export function placeCategory(question) {
 const q=String(question).toLowerCase();
 if(/\b(restaurant|restaurants|dining|food)\b/.test(q))return {name:'restaurants',key:'amenity',value:'restaurant'};
 if(/\b(coffee|cafe|cafes)\b/.test(q))return {name:'cafés',key:'amenity',value:'cafe'};
 if(/\b(pharmacy|pharmacies|chemist)\b/.test(q))return {name:'pharmacies',key:'amenity',value:'pharmacy'};
 if(/\b(hospital|hospitals)\b/.test(q))return {name:'hospitals',key:'amenity',value:'hospital'};
 if(/\b(atm|atms)\b/.test(q))return {name:'ATMs',key:'amenity',value:'atm'};
 if(/\b(park|parks)\b/.test(q))return {name:'parks',key:'leisure',value:'park'};
 if(/\b(hotel|hotels)\b/.test(q))return {name:'hotels',key:'tourism',value:'hotel'};
 if(/\b(petrol|gas station|fuel station)\b/.test(q))return {name:'fuel stations',key:'amenity',value:'fuel'};
 return null;
}
export function normalizePlaces(data,coords) {
 if(!Array.isArray(data?.elements))return [];
 const found=[]; const seen=new Set();
 for(const el of data.elements){
  const lat=Number(el.lat??el.center?.lat),lon=Number(el.lon??el.center?.lon);
  const name=String(el.tags?.name??'').trim().slice(0,100);
  if(!name||!Number.isFinite(lat)||!Number.isFinite(lon)||!['node','way','relation'].includes(el.type)||!Number.isInteger(el.id))continue;
  const distance=distanceKm(coords.lat,coords.lon,lat,lon);
  const key=`${name.toLowerCase()}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
  if(distance>3||seen.has(key))continue;
  seen.add(key);found.push({name,distance,url:`https://www.openstreetmap.org/${el.type}/${el.id}`});
 }
 return found.sort((a,b)=>a.distance-b.distance).slice(0,5);
}
export async function nearbyCoffeeSearch(question,{fetchFn=fetch,signal}={}) {
 const cat=placeCategory(question); if(!cat)return 'Specify what kind of nearby place you want to find.';
 const coords=parseNearbyCoords(question);
 if(!coords)return `To search nearby ${cat.name}, allow the browser location request, or tell me your city or area. I will not invent local places.`;
 const radius=2500;
 const query=`[out:json][timeout:10];(node["${cat.key}"="${cat.value}"](around:${radius},${coords.lat},${coords.lon});way["${cat.key}"="${cat.value}"](around:${radius},${coords.lat},${coords.lon}););out center 35;`;
 const ctl=new AbortController();const abort=()=>ctl.abort(); signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>ctl.abort(),12000);
 try{
  const response=await fetchFn('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:query}),signal:ctl.signal});
  if(!response.ok)throw new Error(`Places service HTTP ${response.status}`);
  const places=normalizePlaces(await response.json(),coords);
  if(!places.length)return `I searched OpenStreetMap for ${cat.name} within about 2.5 km of your permitted location but found no named matches. Check https://www.openstreetmap.org/ for more options.`;
  return `Nearby ${cat.name} from OpenStreetMap (approximate straight-line distances):\n`+places.map((p,i)=>`${i+1}. ${p.name} — ${p.distance.toFixed(1)} km — ${p.url}`).join('\n')+'\nConfirm opening hours and details before travelling.';
 }catch(err){
  if(signal?.aborted)return 'The nearby search was cancelled.';
  return `Live OpenStreetMap ${cat.name} search is unavailable now. Try again or use https://www.openstreetmap.org/. I will not invent results.`;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
