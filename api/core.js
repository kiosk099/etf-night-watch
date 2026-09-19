const CFG = [
  {code:'360200', name:'ACE 미국S&P500', type:'future', primary:'ES=F', modelLabel:'S&P500 선물', confidence:'high'},
  {code:'381180', name:'TIGER 미국필라델피아반도체나스닥', type:'equity', primary:'SOXQ', future:'NQ=F', modelLabel:'SOXQ + NQ 보정', confidence:'medium'},
  {code:'381170', name:'TIGER 미국테크TOP10 INDXX', type:'basket', primary:'QQQ', future:'NQ=F', modelLabel:'TOP10 + NQ 보정', confidence:'high', holdingsDate:'2026-09-11', holdings:[
    ['NVDA',.198],['AAPL',.176],['GOOGL',.152],['MSFT',.137],['AMZN',.094],['AVGO',.065],['META',.063],['MU',.043],['TSLA',.041],['AMD',.032]
  ]},
  {code:'481190', name:'SOL 미국테크TOP10', type:'basket', primary:'QQQ', future:'NQ=F', modelLabel:'TOP10 + NQ 보정', confidence:'high', holdingsDate:'2026-09-11', holdings:[
    ['NVDA',.1971],['AAPL',.1786],['GOOGL',.1508],['MSFT',.1366],['AMZN',.0952],['AVGO',.0652],['META',.0631],['MU',.0445],['TSLA',.0400],['AMD',.0307]
  ]},
  {code:'487230', name:'KODEX 미국AI전력핵심인프라', type:'basket', primary:'PAVE', future:'ES=F', modelLabel:'AI전력 TOP10 + ES 보정', confidence:'high', holdingsDate:'2026-09-11', holdings:[
    ['BE',.1898],['GEV',.1572],['VRT',.1567],['FIX',.1112],['PWR',.1107],['CCJ',.0870],['STRL',.0566],['FPS',.0412],['MTZ',.0400],['POWL',.0393]
  ]},
  {code:'0183J0', name:'TIGER 미국우주테크', type:'basket', primary:'ARKX', future:'RTY=F', backupFuture:'NQ=F', modelLabel:'우주 TOP10 + RTY 보정', confidence:'medium', holdingsDate:'2026-09-15', holdings:[
    ['SPCX',.2879],['RDW',.1708],['LUNR',.1293],['RKLB',.1226],['ECHO',.0860],['ASTS',.0628],['PL',.0455],['VOYG',.0409],['FLY',.0289],['MDA',.0278]
  ]},
  {code:'0072R0', name:'TIGER KRX금현물', type:'timed', primary:'GC=F', modelLabel:'국제금 × 환율', confidence:'medium'}
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
  const k = kstParts(now);
  const today = dateKey(k.y,k.m,k.d);
  const afterClose = (k.h * 60 + k.mi) >= (15 * 60 + 35);
  const dates = rows.map(parseRowDate).filter(Boolean).filter(d => afterClose ? d <= today : d < today).sort().reverse();
  if (!dates[0]) return null;
  const [y,m,d] = dates[0].split('-').map(Number);
  return {date: dates[0], t: epochKst(y,m,d,15,30), source:'naver'};
}

function findExactClose(rows, date) {
  const r = rows.find(x => parseRowDate(x) === date);
  const v = rowClose(r);
  return v ? {v, date, source:'naver'} : null;
}

function at(points, t) {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].t <= t + 60) return points[i];
  return null;
}

function ratio(points, a, b, maxLagSec = 45 * 60) {
  const x = at(points,a), y = at(points,b);
  if (!x?.p || !y?.p) return null;
  if (a - x.t > maxLagSec || b - y.t > maxLagSec) return null;
  return {factor:y.p/x.p, start:x, end:y};
}

function etParts(t) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:'America/New_York', weekday:'short', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  }).formatToParts(new Date(t*1000));
  return Object.fromEntries(parts.map(p => [p.type,p.value]));
}

function marketSession(t) {
  const p = etParts(t), min = +p.hour * 60 + +p.minute, wk = p.weekday;
  let code='CLOSED', label='미국 휴장/장외';
  if (!['Sat','Sun'].includes(wk)) {
    if (min >= 4*60 && min < 9*60+30) {code='PRE';label='미국 프리마켓';}
    else if (min >= 9*60+30 && min < 16*60) {code='REG';label='미국 정규장';}
    else if (min >= 16*60 && min < 20*60) {code='POST';label='미국 애프터마켓';}
    else {code='OVERNIGHT';label='미국 오버나이트';}
  }
  return {code,label,et:`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ET`};
}

function regularCloseBefore(points, anchorT) {
  for (let i = points.length - 1; i >= 0; i--) {
    const x = points[i];
    if (x.t >= anchorT) continue;
    const p = etParts(x.t), min = +p.hour * 60 + +p.minute;
    if (!['Sat','Sun'].includes(p.weekday) && min >= 15*60+50 && min <= 16*60+5) return x;
  }
  return null;
}

function fairEquity(eqPoints, futurePoints, anchorT, targetT) {
  if (!eqPoints?.length) return null;
  const reg = regularCloseBefore(eqPoints, anchorT);
  const cur = at(eqPoints, targetT);
  if (!reg?.p || !cur?.p) return null;

  const raw = cur.p / reg.p;
  if (!futurePoints?.length) return {factor:raw, adjusted:false, directFresh:(targetT-cur.t)<=15*60, equityAt:cur.t, source:'equity-only'};

  const fr = at(futurePoints, reg.t), fa = at(futurePoints, anchorT);
  if (!fr?.p || !fa?.p || anchorT-fa.t > 45*60) return {factor:raw, adjusted:false, directFresh:(targetT-cur.t)<=15*60, equityAt:cur.t, source:'equity-only'};

  let continuation = 1;
  const lag = targetT - cur.t;
  if (lag > 15*60) {
    const fc = at(futurePoints, cur.t), ft = at(futurePoints, targetT);
    if (fc?.p && ft?.p && targetT-ft.t <= 45*60) continuation = ft.p / fc.p;
  }

  return {
    factor: raw * continuation / (fa.p / fr.p),
    adjusted:true,
    directFresh: lag <= 15*60,
    equityAt:cur.t,
    source: lag <= 15*60 ? 'direct' : 'direct+future'
  };
}

function pct(f) { return (f - 1) * 100; }

module.exports = {
  CFG,num,kstParts,epochKst,dateKey,parseRowDate,rowClose,selectKrxReference,findExactClose,
  at,ratio,marketSession,regularCloseBefore,fairEquity,pct
};
