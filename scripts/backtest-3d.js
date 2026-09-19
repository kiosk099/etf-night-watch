const {CFG,epochKst,findExactClose,ratioLatest,fairEquity}=require('../api/core');

const TARGET_HOUR_KST=8, TARGET_MIN_KST=50;
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
const rowClose=r=>[r?.closePrice,r?.close,r?.nowVal,r?.currentPrice].map(num).find(x=>x>0)||null;
const parseDate=s=>s.split('-').map(Number);
const kstEpoch=(date,h,m)=>{const [y,mo,d]=parseDate(date);return epochKst(y,mo,d,h,m);};

async function json(url,headers={}){
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 ETF-Night-Watch-Backtest/1.0','Accept':'application/json,text/plain,*/*',...headers}});
  if(!r.ok)throw Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
async function daily(code){
  const u=`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/price?pageSize=20&page=1`;
  const j=await json(u,{Referer:`https://m.stock.naver.com/domestic/stock/${code}/total`});
  return Array.isArray(j)?j:(j.priceInfos||j.prices||j.result||j.items||[]);
}
async function chart(symbol){
  const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1mo&includePrePost=true&events=div%2Csplits`;
  const j=await json(u),r=j.chart?.result?.[0];
  if(!r)throw Error(`Yahoo ${symbol}: no result`);
  const q=r.indicators?.quote?.[0]?.close||[];
  return (r.timestamp||[]).map((t,i)=>({t,p:q[i]})).filter(x=>Number.isFinite(x.p)&&x.p>0);
}
function symbols(){
  const s=new Set(['KRW=X']);
  for(const c of CFG){s.add(c.primary);if(c.future)s.add(c.future);if(c.backupFuture)s.add(c.backupFuture);}
  return [...s];
}
function mean(a){return a.reduce((x,y)=>x+y,0)/a.length;}
function median(a){const b=[...a].sort((x,y)=>x-y),n=b.length;return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2;}
function f2(n){return Number.isFinite(n)?+n.toFixed(3):null;}

(async()=>{
  const dailyByCode=Object.fromEntries(await Promise.all(CFG.map(async c=>[c.code,await daily(c.code)])));
  const allSymbols=symbols();
  const chartBySymbol=Object.fromEntries(await Promise.all(allSymbols.map(async s=>[s,await chart(s)])));

  const refRows=dailyByCode[CFG[0].code].map(r=>({date:rowDate(r),open:rowOpen(r),close:rowClose(r)})).filter(r=>r.date&&r.open&&r.close);
  const targets=refRows.slice(0,3).map(r=>r.date).reverse();
  const dates=refRows.map(r=>r.date);

  const observations=[];
  const days=[];
  for(const targetDate of targets){
    const ti=dates.indexOf(targetDate);
    const baseDate=dates[ti+1];
    if(!baseDate)throw Error(`No previous KRX date for ${targetDate}`);
    const anchorT=kstEpoch(baseDate,15,30);
    const targetT=kstEpoch(targetDate,TARGET_HOUR_KST,TARGET_MIN_KST);
    const fx=ratioLatest(chartBySymbol['KRW=X']||[],anchorT,targetT);
    const fxFactor=fx?.factor||1;
    const fxFallback=!fx;
    const dayObs=[];

    for(const c of CFG){
      const rows=dailyByCode[c.code];
      const base=findExactClose(rows,baseDate);
      const tr=rows.find(r=>rowDate(r)===targetDate);
      const actualOpen=rowOpen(tr);
      if(!base?.v||!actualOpen)continue;
      let calc=null;
      if(c.type==='future'||c.type==='timed'){
        calc=ratioLatest(chartBySymbol[c.primary]||[],anchorT,targetT);
      }else{
        const fut=chartBySymbol[c.future]||chartBySymbol[c.backupFuture]||null;
        calc=fairEquity(chartBySymbol[c.primary]||[],fut,anchorT,targetT);
      }
      if(!calc?.factor)continue;
      const predicted=base.v*calc.factor*fxFactor;
      const modelErrPct=(predicted/actualOpen-1)*100;
      const baselineErrPct=(base.v/actualOpen-1)*100;
      const actualGapPct=(actualOpen/base.v-1)*100;
      const predictedGapPct=(predicted/base.v-1)*100;
      const direction=(Math.sign(actualGapPct)===Math.sign(predictedGapPct))||(Math.abs(actualGapPct)<0.02&&Math.abs(predictedGapPct)<0.02);
      const o={date:targetDate,baseDate,code:c.code,name:c.name,baseClose:base.v,predicted:f2(predicted),actualOpen,modelErrPct:f2(modelErrPct),modelAbsErrPct:f2(Math.abs(modelErrPct)),baselineAbsErrPct:f2(Math.abs(baselineErrPct)),actualGapPct:f2(actualGapPct),predictedGapPct:f2(predictedGapPct),direction,fxFallback};
      observations.push(o);dayObs.push(o);
    }
    days.push({date:targetDate,baseDate,n:dayObs.length,modelMAE:f2(mean(dayObs.map(x=>x.modelAbsErrPct))),baselineMAE:f2(mean(dayObs.map(x=>x.baselineAbsErrPct))),directionAccuracy:f2(100*mean(dayObs.map(x=>x.direction?1:0))),fxFallback});
  }
  const byEtf=CFG.map(c=>{
    const a=observations.filter(x=>x.code===c.code);
    return {code:c.code,name:c.name,n:a.length,modelMAE:f2(mean(a.map(x=>x.modelAbsErrPct))),baselineMAE:f2(mean(a.map(x=>x.baselineAbsErrPct))),improvementPct:f2(100*(1-mean(a.map(x=>x.modelAbsErrPct))/mean(a.map(x=>x.baselineAbsErrPct)))),directionAccuracy:f2(100*mean(a.map(x=>x.direction?1:0)))};
  });
  const modelAbs=observations.map(x=>x.modelAbsErrPct),baseAbs=observations.map(x=>x.baselineAbsErrPct);
  const summary={
    targetTimeKST:'08:50',
    targetDates:targets,
    observations:observations.length,
    modelMAE:f2(mean(modelAbs)),
    modelMedianAE:f2(median(modelAbs)),
    baselineMAE:f2(mean(baseAbs)),
    baselineMedianAE:f2(median(baseAbs)),
    improvementPct:f2(100*(1-mean(modelAbs)/mean(baseAbs))),
    directionAccuracy:f2(100*mean(observations.map(x=>x.direction?1:0))),
    modelWins:observations.filter(x=>x.modelAbsErrPct<x.baselineAbsErrPct).length,
    baselineWins:observations.filter(x=>x.modelAbsErrPct>x.baselineAbsErrPct).length,
    ties:observations.filter(x=>x.modelAbsErrPct===x.baselineAbsErrPct).length
  };
  console.log('BACKTEST_JSON_START');
  console.log(JSON.stringify({summary,days,byEtf,observations},null,2));
  console.log('BACKTEST_JSON_END');
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
