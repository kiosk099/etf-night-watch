const {CFG,epochKst,findExactClose,ratioLatest,fairEquity}=require('../api/core');

const TARGET_HOUR_KST=8, TARGET_MIN_KST=50, DAYS=20;
const TRAIN_DAYS=14;
const AI_WEIGHTS={BE:.1898,GEV:.1572,VRT:.1567,FIX:.1112,PWR:.1107,CCJ:.0870};
const SPACE_WEIGHTS={RDW:.1708,LUNR:.1293,RKLB:.1226,ASTS:.0628,PL:.0455,VOYG:.0409};
const candidates={
  '487230':[
    {id:'PAVE_ES',label:'PAVE + ES',type:'equity',primary:'PAVE',future:'ES=F'},
    {id:'PAVE_NQ',label:'PAVE + NQ',type:'equity',primary:'PAVE',future:'NQ=F'},
    {id:'GRID_ES',label:'GRID + ES',type:'equity',primary:'GRID',future:'ES=F'},
    {id:'XLI_ES',label:'XLI + ES',type:'equity',primary:'XLI',future:'ES=F'},
    {id:'AI6_ES',label:'AI top6 basket + ES',type:'basket',weights:AI_WEIGHTS,future:'ES=F'},
    {id:'AI6_NQ',label:'AI top6 basket + NQ',type:'basket',weights:AI_WEIGHTS,future:'NQ=F'}
  ],
  '0183J0':[
    {id:'ARKX_RTY',label:'ARKX + RTY',type:'equity',primary:'ARKX',future:'RTY=F'},
    {id:'ARKX_NQ',label:'ARKX + NQ',type:'equity',primary:'ARKX',future:'NQ=F'},
    {id:'UFO_RTY',label:'UFO + RTY',type:'equity',primary:'UFO',future:'RTY=F'},
    {id:'ROKT_RTY',label:'ROKT + RTY',type:'equity',primary:'ROKT',future:'RTY=F'},
    {id:'SPACE6_RTY',label:'Space top6 basket + RTY',type:'basket',weights:SPACE_WEIGHTS,future:'RTY=F'},
    {id:'SPACE6_NQ',label:'Space top6 basket + NQ',type:'basket',weights:SPACE_WEIGHTS,future:'NQ=F'}
  ]
};
const num=v=>{
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  if(typeof v!=='string')return null;
  const n=+v.replace(/[^0-9.+-]/g,'');
  return Number.isFinite(n)?n:null;
};
const rowDate=r=>{
  const s=String(r?.localTradedAt||r?.tradeDate||r?.date||r?.businessDay||'');
  const m=s.match(/(20\d{2})[-.]?(\d{2})[-.]?(\d{2})/);
  return m?`${m[1]}-${m[2]}-${m[3]}`:null;
};
const rowOpen=r=>[r?.openPrice,r?.open,r?.openVal,r?.startPrice].map(num).find(x=>x>0)||null;
const parseDate=s=>s.split('-').map(Number);
const kstEpoch=(date,h,m)=>{const [y,mo,d]=parseDate(date);return epochKst(y,mo,d,h,m);};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const median=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),n=b.length;return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2;};
const f3=n=>Number.isFinite(n)?+n.toFixed(3):null;
const abs=n=>Math.abs(n);

async function json(url,headers={}){
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 ETF-Night-Watch-Backtest/2.0','Accept':'application/json,text/plain,*/*',...headers}});
  if(!r.ok)throw Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
async function daily(code){
  const u=`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/price?pageSize=60&page=1`;
  const j=await json(u,{Referer:`https://m.stock.naver.com/domestic/stock/${code}/total`});
  return Array.isArray(j)?j:(j.priceInfos||j.prices||j.result||j.items||[]);
}
async function chart(symbol){
  const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1mo&includePrePost=true&events=div%2Csplits`;
  const j=await json(u),r=j.chart?.result?.[0];
  if(!r)throw Error(`Yahoo ${symbol}: no result`);
  const q=r.indicators?.quote?.[0]?.close||[];
  const pts=(r.timestamp||[]).map((t,i)=>({t,p:q[i]})).filter(x=>Number.isFinite(x.p)&&x.p>0);
  if(!pts.length)throw Error(`Yahoo ${symbol}: no points`);
  return pts;
}
function currentSymbols(){
  const s=new Set(['KRW=X']);
  for(const c of CFG){s.add(c.primary);if(c.future)s.add(c.future);if(c.backupFuture)s.add(c.backupFuture);}
  for(const arr of Object.values(candidates)) for(const x of arr){
    if(x.primary)s.add(x.primary); if(x.future)s.add(x.future);
    if(x.weights)Object.keys(x.weights).forEach(k=>s.add(k));
  }
  return [...s];
}
function calcEquity(primary,future,charts,anchorT,targetT){
  return fairEquity(charts[primary]||[],charts[future]||[],anchorT,targetT)?.factor||null;
}
function calcBasket(weights,future,charts,anchorT,targetT){
  let weighted=0,covered=0,total=Object.values(weights).reduce((a,b)=>a+b,0);
  for(const [sym,w] of Object.entries(weights)){
    const x=fairEquity(charts[sym]||[],charts[future]||[],anchorT,targetT);
    if(x?.factor){weighted+=w*x.factor;covered+=w;}
  }
  if(!covered||covered/total<0.70)return null;
  return weighted/covered;
}
function calcCandidate(cand,charts,anchorT,targetT){
  if(cand.type==='equity')return calcEquity(cand.primary,cand.future,charts,anchorT,targetT);
  if(cand.type==='basket')return calcBasket(cand.weights,cand.future,charts,anchorT,targetT);
  return null;
}
function metric(obs){
  const valid=obs.filter(x=>Number.isFinite(x.errPct));
  const ae=valid.map(x=>abs(x.errPct));
  return {n:valid.length,mae:f3(mean(ae)),medianAE:f3(median(ae)),dir:f3(100*mean(valid.map(x=>x.direction?1:0)))};
}
function fitBeta(obs){
  let xy=0,xx=0; for(const o of obs){xy+=o.predGapPct*o.actualGapPct;xx+=o.predGapPct*o.predGapPct;}
  return xx?Math.max(.25,Math.min(1.75,xy/xx)):1;
}
function applyBeta(o,beta){
  const predGap=o.predGapPct*beta;
  const pred=o.baseClose*(1+predGap/100);
  const err=(pred/o.actualOpen-1)*100;
  return {...o,predicted:pred,predGapPct:predGap,errPct:err,direction:Math.sign(predGap)===Math.sign(o.actualGapPct)};
}

(async()=>{
  const dailyByCode=Object.fromEntries(await Promise.all(CFG.map(async c=>[c.code,await daily(c.code)])));
  const syms=currentSymbols(),charts={},chartErrors={};
  await Promise.all(syms.map(async s=>{try{charts[s]=await chart(s);}catch(e){chartErrors[s]=e.message;charts[s]=[];}}));

  const refRows=dailyByCode[CFG[0].code].map(r=>({date:rowDate(r),open:rowOpen(r)})).filter(r=>r.date&&r.open);
  const dates=refRows.map(r=>r.date);
  const targets=dates.slice(0,DAYS).reverse();
  const currentObs=[],candidateObs={};
  for(const code of Object.keys(candidates)) for(const cand of candidates[code])candidateObs[`${code}:${cand.id}`]=[];

  for(const targetDate of targets){
    const ti=dates.indexOf(targetDate),baseDate=dates[ti+1];
    if(!baseDate)continue;
    const anchorT=kstEpoch(baseDate,15,30),targetT=kstEpoch(targetDate,TARGET_HOUR_KST,TARGET_MIN_KST);
    const fx=ratioLatest(charts['KRW=X']||[],anchorT,targetT),fxFactor=fx?.factor||1;
    for(const c of CFG){
      const rows=dailyByCode[c.code],base=findExactClose(rows,baseDate),tr=rows.find(r=>rowDate(r)===targetDate),actualOpen=rowOpen(tr);
      if(!base?.v||!actualOpen)continue;
      let factor=null;
      if(c.type==='future'||c.type==='timed')factor=ratioLatest(charts[c.primary]||[],anchorT,targetT)?.factor||null;
      else factor=fairEquity(charts[c.primary]||[],charts[c.future]||charts[c.backupFuture]||[],anchorT,targetT)?.factor||null;
      if(factor){
        const predicted=base.v*factor*fxFactor,predGapPct=(predicted/base.v-1)*100,actualGapPct=(actualOpen/base.v-1)*100,errPct=(predicted/actualOpen-1)*100;
        currentObs.push({date:targetDate,code:c.code,name:c.name,baseClose:base.v,actualOpen,predicted,predGapPct,actualGapPct,errPct,direction:Math.sign(predGapPct)===Math.sign(actualGapPct)});
      }
      if(candidates[c.code]){
        for(const cand of candidates[c.code]){
          const cf=calcCandidate(cand,charts,anchorT,targetT);
          if(!cf)continue;
          const predicted=base.v*cf*fxFactor,predGapPct=(predicted/base.v-1)*100,actualGapPct=(actualOpen/base.v-1)*100,errPct=(predicted/actualOpen-1)*100;
          candidateObs[`${c.code}:${cand.id}`].push({date:targetDate,code:c.code,candidate:cand.id,label:cand.label,baseClose:base.v,actualOpen,predicted,predGapPct,actualGapPct,errPct,direction:Math.sign(predGapPct)===Math.sign(actualGapPct)});
        }
      }
    }
  }

  const allDates=[...new Set(currentObs.map(x=>x.date))].sort(),trainDates=allDates.slice(0,TRAIN_DAYS),testDates=allDates.slice(TRAIN_DAYS);
  const overall={all:metric(currentObs),train:metric(currentObs.filter(x=>trainDates.includes(x.date))),test:metric(currentObs.filter(x=>testDates.includes(x.date)))};
  const baselineObs=currentObs.map(o=>({...o,errPct:(o.baseClose/o.actualOpen-1)*100,direction:false}));
  overall.baselineAll=metric(baselineObs); overall.baselineTest=metric(baselineObs.filter(x=>testDates.includes(x.date)));

  const byEtf=CFG.map(c=>{
    const a=currentObs.filter(x=>x.code===c.code),tr=a.filter(x=>trainDates.includes(x.date)),te=a.filter(x=>testDates.includes(x.date));
    const beta=fitBeta(tr),cal=te.map(o=>applyBeta(o,beta));
    return {code:c.code,name:c.name,all:metric(a),train:metric(tr),test:metric(te),beta:f3(beta),calibratedTest:metric(cal)};
  });

  const candidateResults={};
  for(const code of Object.keys(candidates)){
    candidateResults[code]=candidates[code].map(cand=>{
      const a=candidateObs[`${code}:${cand.id}`],tr=a.filter(x=>trainDates.includes(x.date)),te=a.filter(x=>testDates.includes(x.date));
      const beta=fitBeta(tr),cal=te.map(o=>applyBeta(o,beta));
      return {id:cand.id,label:cand.label,all:metric(a),train:metric(tr),test:metric(te),beta:f3(beta),calibratedTest:metric(cal)};
    }).sort((a,b)=>(a.test.mae??999)-(b.test.mae??999));
  }

  console.log('BACKTEST20_JSON_START');
  console.log(JSON.stringify({config:{targetTimeKST:'08:50',days:DAYS,trainDays:trainDates,testDays},chartErrors,overall,byEtf,candidateResults},null,2));
  console.log('BACKTEST20_JSON_END');
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
