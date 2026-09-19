const {CFG,selectKrxReferenceConsensus,findExactClose,ratioLatest,fairEquity,pct,marketSession,classifyQuality}=require('./core');
const {loadDailies,loadCharts,cacheStats}=require('./market');
function symbolSet(){const s=new Set(['KRW=X']);for(const c of CFG){s.add(c.primary);if(c.future)s.add(c.future);if(c.backupFuture)s.add(c.backupFuture);}return s;}
function latestTs(points){return points?.length ? points[points.length-1]?.t || null : null;}
async function buildEstimate({now=Math.floor(Date.now()/1000),debug=false}={}) {
  const session=marketSession(now), codes=CFG.map(c=>c.code);
  const dailyResult=await loadDailies(codes);
  const K=selectKrxReferenceConsensus(dailyResult.rows,new Date(now*1000));
  if(!K)throw Error('최근 확정 KRX 종가 기준일을 찾지 못했습니다.');
  const symbols=symbolSet(), anchorAgeSec=Math.max(0,now-K.t), range=anchorAgeSec>4.5*86400?'1mo':'5d';
  const chartResult=await loadCharts(symbols,range,4), charts=chartResult.charts;
  const fxR=ratioLatest(charts['KRW=X']||[],K.t,now), fxFactor=fxR?.factor||1, fxFallback=!fxR, items=[];
  for(const c of CFG){
    const close=findExactClose(dailyResult.rows[c.code],K.date);
    let calc=null;
    if(c.type==='future'||c.type==='timed'){
      const r=ratioLatest(charts[c.primary]||[],K.t,now);
      if(r)calc={factor:r.factor,sourceAt:r.sourceAt,ageSec:r.ageSec,mode:'direct'};
    } else {
      const future=charts[c.future]||charts[c.backupFuture]||null;
      const x=fairEquity(charts[c.primary]||[],future,K.t,now);
      if(x)calc={factor:x.factor,sourceAt:x.sourceAt,ageSec:x.ageSec,mode:x.source};
    }
    const dataOk=!!close?.v&&!!calc?.factor, factor=dataOk?calc.factor*fxFactor:null;
    const combinedAge=dataOk?Math.max(calc.ageSec||0,fxR?.ageSec||0):null;
    const q=classifyQuality(session,combinedAge,{proxy:c.type==='proxy',fxFallback});
    items.push({code:c.code,name:c.name,marketClose:close?.v??null,estimate:factor?close.v*factor:null,expectedMovePct:factor?pct(factor):null,underlyingMovePct:calc?.factor?pct(calc.factor):null,fxMovePct:fxR?.factor?pct(fxR.factor):0,fxMode:fxFallback?'neutral-fallback':'live-or-last',modelLabel:c.modelLabel,confidence:c.confidence,quality:q.quality,qualityLabel:dataOk?q.label:'미수신',dataOk,anchorDate:K.date,anchorSource:close?.source||'unavailable',sourceAt:calc?.sourceAt?new Date(calc.sourceAt*1000).toISOString():null,sourceAgeSec:combinedAge,mode:calc?.mode||null});
  }
  const result={version:'1.4.0-stable',generatedAt:new Date(now*1000).toISOString(),snapshot:{frozen:!['PRE','REG','POST'].includes(session.code),targetAt:new Date(now*1000).toISOString(),label:session.label},session,krxCloseDate:K.date,krxAnchorAt:new Date(K.t*1000).toISOString(),krxCloseSource:K.source,krxConsensus:{votes:K.votes,total:K.total},fx:{movePct:fxR?.factor?pct(fxR.factor):0,dataOk:!!fxR,fallback:fxFallback,sourceAt:fxR?.sourceAt?new Date(fxR.sourceAt*1000).toISOString():null,ageSec:fxR?.ageSec??null},items,sourceSummary:{requestedSymbols:symbols.size,chartFailures:Object.keys(chartResult.errors).length,dailyFailures:Object.keys(dailyResult.errors).length},disclaimer:'최근 확정 KRX 종가(15:30)를 기준으로 이후 미국 기초자산·선물·환율 움직임을 반영한 개인 참고용 추정치입니다.'};
  if(debug)result.debug={chartRange:range,symbols:[...symbols],latestBySymbol:Object.fromEntries([...symbols].map(s=>[s,latestTs(charts[s])?new Date(latestTs(charts[s])*1000).toISOString():null])),chartErrors:chartResult.errors,chartCache:chartResult.cache,dailyErrors:dailyResult.errors,dailyCache:dailyResult.cache,krxCandidates:K.candidates,cacheStats:cacheStats()};
  return result;
}
module.exports={buildEstimate,symbolSet};
