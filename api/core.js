const CFG = [
  {code:'360200', name:'ACE 미국S&P500', type:'future', primary:'ES=F', modelLabel:'S&P500 선물', confidence:'high'},
  {code:'381180', name:'TIGER 미국필라델피아반도체나스닥', type:'equity', primary:'SOXQ', future:'NQ=F', moveScale:0.75, modelLabel:'SOXQ + NQ 보정 ×0.75', confidence:'medium'},
  {code:'381170', name:'TIGER 미국테크TOP10 INDXX', type:'proxy', primary:'QQQ', future:'NQ=F', modelLabel:'QQQ + NQ 보정 (프록시)', confidence:'medium'},
  {code:'481190', name:'SOL 미국테크TOP10', type:'proxy', primary:'QQQ', future:'NQ=F', modelLabel:'QQQ + NQ 보정 (프록시)', confidence:'medium'},
  {code:'487230', name:'KODEX 미국AI전력핵심인프라', type:'basket', primary:'PAVE', future:'NQ=F', holdings:{BE:.1898,GEV:.1572,VRT:.1567,FIX:.1112,PWR:.1107,CCJ:.0870}, moveScale:0.80, modelLabel:'상위 6종목 + NQ 보정 ×0.80', confidence:'medium'},
  {code:'0183J0', name:'TIGER 미국우주테크', type:'proxy', primary:'ARKX', future:'NQ=F', backupFuture:'RTY=F', modelLabel:'ARKX + NQ 보정 (프록시)', confidence:'medium'},
  {code:'0072R0', name:'TIGER KRX금현물', type:'timed', primary:'GC=F', moveScale:0.80, modelLabel:'국제금 × 환율 ×0.80', confidence:'medium'}
];

const num = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = +v.replace(/[^0-9.+-]/g, '');
  return Number.isFinite(n) ? n : null;
};

function kstParts(date = new Date()) {
  const d = new Date(date.getTime() + 9 * 3600e3);
  return {y:d.getUTCFullYear(), m:d.getUTCMonth()+1, d:d.getUTCDate(), h:d.getUTCHours(), mi:d.getUTCMinutes()};
}
function epochKst(y,m,d,h,mi=0) { return Date.UTC(y,m-1,d,h-9,mi)/1000; }
function dateKey(y,m,d) { return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function parseRowDate(r) {
  const s = String(r?.localTradedAt || r?.tradeDate || r?.date || r?.businessDay || '');
  const m = s.match(/(20\d{2})[-.]?(\d{2})[-.]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function rowClose(r) {
  return [r?.closePrice, r?.close, r?.nowVal, r?.currentPrice].map(num).find(x => x > 0) || null;
}
function selectKrxReference(rows, now = new Date()) {
  const k = kstParts(now), today = dateKey(k.y,k.m,k.d);
  const afterClose = (k.h * 60 + k.mi) >= (15 * 60 + 35);
  const dates = rows.map(parseRowDate).filter(Boolean).filter(d => afterClose ? d <= today : d < today).sort().reverse();
  if (!dates[0]) return null;
  const [y,m,d] = dates[0].split('-').map(Number);
  return {date:dates[0], t:epochKst(y,m,d,15,30), source:'naver'};
}
function selectKrxReferenceConsensus(rowsByCode, now = new Date()) {
  const candidates = Object.entries(rowsByCode || {}).map(([code,rows]) => {
    const ref = selectKrxReference(Array.isArray(rows) ? rows : [], now);
    return ref ? {...ref, code} : null;
  }).filter(Boolean);
  if (!candidates.length) return null;
  const counts = new Map();
  for (const c of candidates) counts.set(c.date, (counts.get(c.date) || 0) + 1);
  const chosenDate = [...counts.entries()].sort((a,b) => b[1]-a[1] || b[0].localeCompare(a[0]))[0][0];
  const chosen = candidates.find(c => c.date === chosenDate);
  return {date:chosen.date,t:chosen.t,source:'naver-consensus',votes:counts.get(chosenDate),total:candidates.length,candidates:Object.fromEntries(candidates.map(c => [c.code,c.date]))};
}
function findExactClose(rows, date) {
  const r = (rows || []).find(x => parseRowDate(x) === date), v = rowClose(r);
  return v ? {v, date, source:'naver'} : null;
}
function atOrBefore(points, t, graceSec=60) {
  for (let i=(points?.length || 0)-1;i>=0;i--) if (points[i].t <= t + graceSec) return points[i];
  return null;
}
function latestAtOrBefore(points, t) {
  for (let i=(points?.length || 0)-1;i>=0;i--) if (points[i].t <= t) return points[i];
  return null;
}
function ratioLatest(points, anchorT, targetT, startMaxLagSec=90*60) {
  const start=atOrBefore(points,anchorT), end=latestAtOrBefore(points,targetT);
  if (!start?.p || !end?.p || end.t < start.t) return null;
  if (anchorT-start.t > startMaxLagSec) return null;
  return {factor:end.p/start.p,start,end,sourceAt:end.t,ageSec:Math.max(0,targetT-end.t)};
}
function etParts(t) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t*1000));
  return Object.fromEntries(parts.map(p => [p.type,p.value]));
}
function marketSession(t) {
  const p=etParts(t), min=+p.hour*60 + +p.minute, wk=p.weekday;
  let code='CLOSED', label='미국 휴장/주말';
  if (!['Sat','Sun'].includes(wk)) {
    if (min >= 4*60 && min < 9*60+30) {code='PRE';label='미국 프리마켓';}
    else if (min >= 9*60+30 && min < 16*60) {code='REG';label='미국 정규장';}
    else if (min >= 16*60 && min < 20*60) {code='POST';label='미국 애프터마켓';}
    else {code='OVERNIGHT';label='미국 장외 시간';}
  }
  return {code,label,et:`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ET`,calendarAware:false};
}
function regularCloseBefore(points, anchorT) {
  for (let i=(points?.length || 0)-1;i>=0;i--) {
    const x=points[i];
    if (x.t >= anchorT) continue;
    const p=etParts(x.t), min=+p.hour*60 + +p.minute;
    if (!['Sat','Sun'].includes(p.weekday) && min >= 15*60+50 && min <= 16*60+5) return x;
  }
  return null;
}
function fairEquity(eqPoints, futurePoints, anchorT, targetT) {
  if (!eqPoints?.length) return null;
  const reg=regularCloseBefore(eqPoints,anchorT), cur=latestAtOrBefore(eqPoints,targetT);
  if (!reg?.p || !cur?.p || cur.t < reg.t) return null;
  const raw=cur.p/reg.p;
  let factor=raw, adjusted=false, continuation=1, futureAt=null;
  if (futurePoints?.length) {
    const fr=atOrBefore(futurePoints,reg.t), fa=atOrBefore(futurePoints,anchorT);
    if (fr?.p && fa?.p && anchorT-fa.t <= 90*60) {
      const anchorMove=fa.p/fr.p;
      if (anchorMove > 0) {factor=raw/anchorMove;adjusted=true;}
    }
    const lag=targetT-cur.t;
    if (lag > 15*60) {
      const fc=atOrBefore(futurePoints,cur.t), ft=latestAtOrBefore(futurePoints,targetT);
      if (fc?.p && ft?.p && ft.t > cur.t && ft.t >= fc.t) {
        continuation=ft.p/fc.p; factor*=continuation; futureAt=ft.t;
      }
    }
  }
  const sourceAt=Math.max(cur.t,futureAt || 0);
  return {factor,adjusted,continuation,directFresh:(targetT-cur.t)<=15*60,equityAt:cur.t,futureAt,sourceAt,ageSec:Math.max(0,targetT-sourceAt),source:futureAt?'equity+future':(adjusted?'equity-adjusted':'equity')};
}
function classifyQuality(session, ageSec, {proxy=false, fxFallback=false}={}) {
  if (!Number.isFinite(ageSec)) return {quality:'unavailable',label:'미수신'};
  const active=['PRE','REG','POST'].includes(session?.code);
  let quality,label;
  if (!active) {quality='closed';label='장 마감값';}
  else if (ageSec <= 15*60) {quality='live';label='실시간';}
  else if (ageSec <= 90*60) {quality='delayed';label='지연';}
  else {quality='stale';label='오래된 시세';}
  if (proxy) label += '·프록시';
  if (fxFallback) {quality=quality==='unavailable'?quality:'partial';label += '·환율미반영';}
  return {quality,label};
}
function applyMoveScale(factor, scale=1) {
  if (!Number.isFinite(factor)) return null;
  const s=Number.isFinite(scale) ? scale : 1;
  return 1 + (factor - 1) * s;
}
function pct(f) { return (f - 1) * 100; }
module.exports={CFG,num,kstParts,epochKst,dateKey,parseRowDate,rowClose,selectKrxReference,selectKrxReferenceConsensus,findExactClose,atOrBefore,latestAtOrBefore,ratioLatest,marketSession,regularCloseBefore,fairEquity,classifyQuality,applyMoveScale,pct};
