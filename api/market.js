const memory = new Map();
const stats = {hit:0, miss:0, stale:0, error:0};
async function fetchJson(url, {headers={}, timeoutMs=6500}={}) {
  const c=new AbortController(), timer=setTimeout(()=>c.abort(),timeoutMs);
  try {
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 ETF-Night-Watch/1.4','Accept':'application/json,text/plain,*/*',...headers},signal:c.signal});
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function cached(key, loader, {ttlMs, staleMs}) {
  const now=Date.now(), old=memory.get(key);
  if (old && now-old.savedAt <= ttlMs) {stats.hit++;return {value:old.value,cache:'hit',savedAt:old.savedAt};}
  try {
    const value=await loader(); memory.set(key,{value,savedAt:now}); stats.miss++;
    return {value,cache:'miss',savedAt:now};
  } catch(e) {
    if (old && now-old.savedAt <= staleMs) {stats.stale++;return {value:old.value,cache:'stale',savedAt:old.savedAt,warning:e.message};}
    stats.error++; throw e;
  }
}
async function daily(code) {
  const url=`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/price?pageSize=14&page=1`;
  return cached(`naver:${code}`,async()=>{
    const j=await fetchJson(url,{headers:{Referer:`https://m.stock.naver.com/domestic/stock/${code}/total`}});
    return Array.isArray(j)?j:(j.priceInfos||j.prices||j.result||j.items||[]);
  },{ttlMs:5*60e3,staleMs:24*3600e3});
}
async function chart(symbol, range='5d') {
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=${range}&includePrePost=true&events=div%2Csplits`;
  return cached(`yahoo:${symbol}:${range}`,async()=>{
    const j=await fetchJson(url), r=j.chart?.result?.[0];
    if (!r) throw Error(`Yahoo ${symbol}: no result`);
    const q=r.indicators?.quote?.[0]?.close || [];
    const points=(r.timestamp||[]).map((t,i)=>({t,p:q[i]})).filter(v=>Number.isFinite(v.p)&&v.p>0);
    if (!points.length) throw Error(`Yahoo ${symbol}: no points`);
    return points;
  },{ttlMs:45e3,staleMs:24*3600e3});
}
async function loadDailies(codes) {
  const rows={},errors={},cache={};
  await Promise.all(codes.map(async code=>{try{const x=await daily(code);rows[code]=x.value;cache[code]=x.cache;if(x.warning)errors[code]=`stale-cache: ${x.warning}`;}catch(e){rows[code]=[];errors[code]=e.message;}}));
  return {rows,errors,cache};
}
async function loadCharts(symbols, range='5d', concurrency=4) {
  const arr=[...symbols],charts={},errors={},cache={},cursor={i:0};
  const workers=Array.from({length:Math.min(concurrency,arr.length)},async()=>{for(;;){const i=cursor.i++;if(i>=arr.length)return;const symbol=arr[i];try{const x=await chart(symbol,range);charts[symbol]=x.value;cache[symbol]=x.cache;if(x.warning)errors[symbol]=`stale-cache: ${x.warning}`;}catch(e){charts[symbol]=null;errors[symbol]=e.message;}}});
  await Promise.all(workers); return {charts,errors,cache};
}
function cacheStats(){return {...stats,entries:memory.size};}
module.exports={daily,chart,loadDailies,loadCharts,cacheStats};
