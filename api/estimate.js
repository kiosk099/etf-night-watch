const {CFG,selectKrxReference,findExactClose,ratio,fairEquity,pct,marketSession} = require('./core');

async function json(url, headers={}) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 7500);
  try {
    const r = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0 ETF-Night-Watch/1.3','Accept':'application/json,text/plain,*/*',...headers}, signal:c.signal});
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function daily(code) {
  const url = `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/price?pageSize=12&page=1`;
  const j = await json(url, {Referer:`https://m.stock.naver.com/domestic/stock/${code}/total`});
  return Array.isArray(j) ? j : (j.priceInfos || j.prices || j.result || j.items || []);
}

async function krxReference(now) {
  const rows = await daily('360200');
  const ref = selectKrxReference(rows, new Date(now*1000));
  if (!ref) throw Error('최근 확정 KRX 종가 기준일을 찾지 못했습니다.');
  return ref;
}

async function closeOn(code, date) {
  const rows = await daily(code);
  return findExactClose(rows,date);
}

async function chart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=5d&includePrePost=true&events=div%2Csplits`;
  const j = await json(url);
  const r = j.chart?.result?.[0];
  if (!r) throw Error(`Yahoo ${symbol}`);
  const q = r.indicators?.quote?.[0]?.close || [];
  const points = (r.timestamp || []).map((t,i) => ({t,p:q[i]})).filter(x => Number.isFinite(x.p) && x.p > 0);
  if (!points.length) throw Error(`No points ${symbol}`);
  return points;
}

async function loadCharts(symbols) {
  const arr = [...symbols], out = {}, errors = {}, cursor = {i:0};
  const workers = Array.from({length:Math.min(8,arr.length)}, async () => {
    for (;;) {
      const i = cursor.i++;
      if (i >= arr.length) return;
      const s = arr[i];
      try { out[s] = await chart(s); }
      catch (e) { out[s] = null; errors[s] = e.message; }
    }
  });
  await Promise.all(workers);
  return {out,errors};
}

function basketFactor(cfg, charts, anchorT, targetT) {
  const future = charts[cfg.future] || charts[cfg.backupFuture] || null;
  const fallback = fairEquity(charts[cfg.primary], future, anchorT, targetT);
  let sum=0, weight=0, freshWeight=0, observedWeight=0;
  for (const [symbol,w] of cfg.holdings) {
    const direct = fairEquity(charts[symbol], future, anchorT, targetT);
    const x = direct || fallback;
    if (!x?.factor) continue;
    sum += w * x.factor;
    weight += w;
    if (direct) observedWeight += w;
    if (direct?.directFresh) freshWeight += w;
  }
  if (!weight) return null;
  return {
    factor:sum/weight,
    coveragePct:100*freshWeight/weight,
    observedPct:100*observedWeight/weight,
    adjusted:!!future,
    proxyUsed:observedWeight < weight
  };
}

module.exports = async (req,res) => {
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  try {
    const now = Math.floor(Date.now()/1000);
    const K = await krxReference(now);
    const symbols = new Set(['KRW=X']);
    for (const c of CFG) {
      symbols.add(c.primary);
      if (c.future) symbols.add(c.future);
      if (c.backupFuture) symbols.add(c.backupFuture);
      for (const h of (c.holdings || [])) symbols.add(h[0]);
    }

    const [{out:charts,errors:chartErrors}, closes] = await Promise.all([
      loadCharts(symbols),
      Promise.all(CFG.map(async c => { try { return await closeOn(c.code,K.date); } catch { return null; } }))
    ]);

    const fxR = ratio(charts['KRW=X'] || [], K.t, now);
    const fxFactor = fxR?.factor || null;
    const items=[];

    for (let i=0;i<CFG.length;i++) {
      const c=CFG[i], close=closes[i];
      let calc=null;

      if (c.type === 'future' || c.type === 'timed') {
        const r = ratio(charts[c.primary] || [], K.t, now);
        if (r) calc={factor:r.factor,coveragePct:100,observedPct:100,adjusted:false,proxyUsed:false};
      } else if (c.type === 'equity') {
        const x = fairEquity(charts[c.primary] || [], charts[c.future] || null, K.t, now);
        if (x) calc={factor:x.factor,coveragePct:x.directFresh?100:0,observedPct:100,adjusted:x.adjusted,proxyUsed:!x.directFresh};
      } else if (c.type === 'basket') {
        calc = basketFactor(c,charts,K.t,now);
      }

      const usable = !!close?.v && !!calc?.factor && !!fxFactor;
      const factor = usable ? calc.factor * fxFactor : null;
      let quality='unavailable', qualityLabel='미수신';
      if (usable) {
        if (calc.coveragePct >= 75) {quality='live';qualityLabel='실시간';}
        else if (calc.observedPct >= 50) {quality='partial';qualityLabel='부분 보정';}
        else {quality='proxy';qualityLabel='프록시';}
      }

      items.push({
        code:c.code,name:c.name,marketClose:close?.v ?? null,estimate:factor?close.v*factor:null,
        expectedMovePct:factor?pct(factor):null,underlyingMovePct:calc?.factor?pct(calc.factor):null,
        fxMovePct:fxFactor?pct(fxFactor):null,modelLabel:c.modelLabel,confidence:c.confidence,
        coveragePct:calc?.coveragePct ?? 0,observedPct:calc?.observedPct ?? 0,quality,qualityLabel,
        dataOk:usable,anchorDate:K.date,anchorSource:close?.source || 'unavailable',holdingsDate:c.holdingsDate || null
      });
    }

    const session = marketSession(now);
    res.setHeader('Cache-Control','public,s-maxage=45,stale-while-revalidate=90');
    return res.status(200).json({
      version:'1.3.0-live',generatedAt:new Date(now*1000).toISOString(),snapshot:{frozen:false,targetAt:new Date(now*1000).toISOString(),label:session.label},
      session,krxCloseDate:K.date,krxAnchorAt:new Date(K.t*1000).toISOString(),krxCloseSource:K.source,
      fx:{movePct:fxFactor?pct(fxFactor):null,dataOk:!!fxFactor},items,chartErrors,
      disclaimer:'가장 최근 확정 KRX 종가(15:30)를 기준으로 이후 미국 기초자산·선물·환율의 현재 움직임을 반영한 개인 참고용 추정치입니다.'
    });
  } catch (e) {
    res.setHeader('Cache-Control','no-store');
    return res.status(503).json({error:e.message || 'estimate failed',version:'1.3.0-live'});
  }
};
