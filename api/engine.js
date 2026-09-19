const {CFG,selectKrxReferenceConsensus,findExactClose,ratioLatest,fairEquity,pct,marketSession,classifyQuality,applyMoveScale,latestAtOrBefore}=require('./core');
const {loadDailies,loadCharts,cacheStats}=require('./market');

const SAFE_LAG_SEC=10*60;

function symbolSet(){
  const s=new Set(['KRW=X']);
  for(const c of CFG){
    if(c.primary)s.add(c.primary);
    if(c.future)s.add(c.future);
    if(c.backupFuture)s.add(c.backupFuture);
    if(c.holdings)Object.keys(c.holdings).forEach(symbol=>s.add(symbol));
  }
  return s;
}
function latestTs(points){return points?.length ? points[points.length-1]?.t || null : null;}
function activeDriverSymbols(){
  const s=new Set(['KRW=X']);
  for(const c of CFG){
    if(c.type==='future'||c.type==='timed') s.add(c.primary);
    else if(c.future) s.add(c.future);
    else if(c.backupFuture) s.add(c.backupFuture);
    else if(c.primary) s.add(c.primary);
  }
  return [...s];
}
function commonAsOf(charts,now,safeLagSec=SAFE_LAG_SEC){
  const cap=Math.max(0,now-safeLagSec), drivers=activeDriverSymbols();
  const latest={},missing=[];
  for(const symbol of drivers){
    const p=latestAtOrBefore(charts[symbol]||[],cap);
    if(p?.t) latest[symbol]=p.t;
    else missing.push(symbol);
  }
  const times=Object.values(latest);
  const t=times.length?Math.min(cap,...times):cap;
  return {t,cap,lagSec:Math.max(0,now-t),drivers,latest,missing};
}

function basketEquity(c,charts,anchorT,targetT){
  const future=charts[c.future]||charts[c.backupFuture]||null;
  const entries=Object.entries(c.holdings||{});
  const total=entries.reduce((sum,[,weight])=>sum+weight,0);
  let weighted=0,covered=0,maxAge=0,sourceAt=null;
  for(const [symbol,weight] of entries){
    const x=fairEquity(charts[symbol]||[],future,anchorT,targetT);
    if(!x?.factor)continue;
    weighted+=weight*x.factor;
    covered+=weight;
    maxAge=Math.max(maxAge,x.ageSec||0);
    sourceAt=sourceAt==null?x.sourceAt:Math.min(sourceAt,x.sourceAt);
  }
  const coverage=total?covered/total:0;
  if(coverage>=0.70){
    return {factor:weighted/covered,sourceAt,ageSec:maxAge,mode:'basket',coverage};
  }
  if(c.primary){
    const x=fairEquity(charts[c.primary]||[],future,anchorT,targetT);
    if(x)return {...x,mode:'basket-fallback',coverage};
  }
  return null;
}

async function buildEstimate({now=Math.floor(Date.now()/1000),debug=false}={}) {
  const session=marketSession(now), codes=CFG.map(c=>c.code);
  const dailyResult=await loadDailies(codes);
  const K=selectKrxReferenceConsensus(dailyResult.rows,new Date(now*1000));
  if(!K)throw Error('최근 확정 KRX 종가 기준일을 찾지 못했습니다.');

  const symbols=symbolSet(), anchorAgeSec=Math.max(0,now-K.t), range=anchorAgeSec>4.5*86400?'1mo':'5d';
  const chartResult=await loadCharts(symbols,range,6), charts=chartResult.charts;
  const asOf=commonAsOf(charts,now);
  const targetT=Math.max(K.t,asOf.t);
  const fxR=ratioLatest(charts['KRW=X']||[],K.t,targetT), fxFactor=fxR?.factor||1, fxFallback=!fxR, items=[];

  for(const c of CFG){
    const close=findExactClose(dailyResult.rows[c.code],K.date);
    let calc=null;
    if(c.type==='future'||c.type==='timed'){
      const r=ratioLatest(charts[c.primary]||[],K.t,targetT);
      if(r)calc={factor:r.factor,sourceAt:r.sourceAt,ageSec:Math.max(0,now-r.sourceAt),mode:'direct'};
    }else if(c.type==='basket'){
      calc=basketEquity(c,charts,K.t,targetT);
      if(calc?.sourceAt) calc.ageSec=Math.max(0,now-calc.sourceAt);
    }else{
      const future=charts[c.future]||charts[c.backupFuture]||null;
      const x=fairEquity(charts[c.primary]||[],future,K.t,targetT);
      if(x)calc={factor:x.factor,sourceAt:x.sourceAt,ageSec:Math.max(0,now-x.sourceAt),mode:x.source};
    }

    const dataOk=!!close?.v&&!!calc?.factor;
    const rawFactor=dataOk?calc.factor*fxFactor:null;
    const calibrationScale=c.moveScale??1;
    const factor=dataOk?applyMoveScale(rawFactor,calibrationScale):null;
    const combinedAge=dataOk?Math.max(calc.ageSec||0,fxR?.sourceAt?Math.max(0,now-fxR.sourceAt):0):null;
    const q=classifyQuality(session,combinedAge,{proxy:c.type==='proxy',fxFallback});

    items.push({
      code:c.code,name:c.name,marketClose:close?.v??null,
      estimate:factor?close.v*factor:null,
      expectedMovePct:factor?pct(factor):null,
      rawExpectedMovePct:rawFactor?pct(rawFactor):null,
      underlyingMovePct:calc?.factor?pct(calc.factor):null,
      fxMovePct:fxR?.factor?pct(fxR.factor):0,
      fxMode:fxFallback?'neutral-fallback':'live-or-last',
      calibrationScale,
      coverage:calc?.coverage??null,
      modelLabel:c.modelLabel,confidence:c.confidence,
      quality:q.quality,qualityLabel:dataOk?q.label:'미수신',
      dataOk,anchorDate:K.date,anchorSource:close?.source||'unavailable',
      asOfAt:new Date(targetT*1000).toISOString(),
      asOfLagSec:Math.max(0,now-targetT),
      sourceAt:calc?.sourceAt?new Date(calc.sourceAt*1000).toISOString():null,
      sourceAgeSec:combinedAge,mode:calc?.mode||null
    });
  }

  const result={
    version:'1.6.0-stable',
    generatedAt:new Date(now*1000).toISOString(),
    snapshot:{
      frozen:!['PRE','REG','POST'].includes(session.code),
      targetAt:new Date(targetT*1000).toISOString(),
      asOfAt:new Date(targetT*1000).toISOString(),
      lagSec:Math.max(0,now-targetT),
      safeLagSec:SAFE_LAG_SEC,
      label:session.label
    },
    session,krxCloseDate:K.date,krxAnchorAt:new Date(K.t*1000).toISOString(),
    krxCloseSource:K.source,krxConsensus:{votes:K.votes,total:K.total},
    fx:{movePct:fxR?.factor?pct(fxR.factor):0,dataOk:!!fxR,fallback:fxFallback,sourceAt:fxR?.sourceAt?new Date(fxR.sourceAt*1000).toISOString():null,ageSec:fxR?.sourceAt?Math.max(0,now-fxR.sourceAt):null},
    items,
    sourceSummary:{requestedSymbols:symbols.size,chartFailures:Object.keys(chartResult.errors).length,dailyFailures:Object.keys(dailyResult.errors).length},
    disclaimer:'10분 안전지연과 공통 as-of 시각을 적용해 서로 다른 시점의 시세를 섞지 않고 계산한 개인 참고용 추정치입니다.'
  };
  if(debug)result.debug={
    chartRange:range,symbols:[...symbols],
    asOf,
    latestBySymbol:Object.fromEntries([...symbols].map(s=>[s,latestTs(charts[s])?new Date(latestTs(charts[s])*1000).toISOString():null])),
    chartErrors:chartResult.errors,chartCache:chartResult.cache,
    dailyErrors:dailyResult.errors,dailyCache:dailyResult.cache,
    krxCandidates:K.candidates,cacheStats:cacheStats()
  };
  return result;
}
module.exports={buildEstimate,symbolSet,basketEquity,activeDriverSymbols,commonAsOf,SAFE_LAG_SEC};
