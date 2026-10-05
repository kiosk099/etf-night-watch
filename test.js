const assert=require('assert');
const c=require('./api/core');
const rows=[{localTradedAt:'2026-09-18',closePrice:'7,700'},{localTradedAt:'2026-09-17',closePrice:'7,585'},{localTradedAt:'2026-09-16',closePrice:'7,315'}];
let r=c.selectKrxReference(rows,new Date('2026-09-18T11:00:00Z'));assert.equal(r.date,'2026-09-18');
r=c.selectKrxReference(rows,new Date('2026-09-18T05:00:00Z'));assert.equal(r.date,'2026-09-17');
const consensus=c.selectKrxReferenceConsensus({a:rows,b:rows,c:[{localTradedAt:'2026-09-17',closePrice:'1'}]},new Date('2026-09-18T11:00:00Z'));
assert.equal(consensus.date,'2026-09-18');assert.equal(consensus.votes,2);assert.equal(consensus.total,3);
assert.equal(c.findExactClose(rows,'2026-09-18').v,7700);assert.equal(c.findExactClose(rows,'2026-09-15'),null);
const anchorT=Date.parse('2026-09-18T06:30:00Z')/1000,oldT=Date.parse('2026-09-19T00:00:00Z')/1000,weekendT=Date.parse('2026-09-19T04:00:00Z')/1000;
let rr=c.ratioLatest([{t:anchorT,p:100},{t:oldT,p:102}],anchorT,weekendT);
assert(rr);assert.equal(rr.factor,1.02);assert.equal(rr.ageSec,4*3600);assert.equal(c.marketSession(weekendT).code,'CLOSED');assert.equal(c.classifyQuality(c.marketSession(weekendT),rr.ageSec).quality,'closed');
const regT=Date.parse('2026-09-17T19:55:00Z')/1000,targetT=Date.parse('2026-09-18T11:00:00Z')/1000;
const eq=[{t:regT,p:100},{t:targetT,p:102}],fu=[{t:regT,p:100},{t:anchorT,p:101},{t:targetT,p:102}];
let f=c.fairEquity(eq,fu,anchorT,targetT);assert(Math.abs(f.factor-(1.02/1.01))<1e-10);assert.equal(f.directFresh,true);
const staleT=Date.parse('2026-09-18T10:00:00Z')/1000,eq2=[{t:regT,p:100},{t:staleT,p:101}],fu2=[{t:regT,p:100},{t:anchorT,p:101},{t:staleT,p:101.5},{t:targetT,p:102}];
f=c.fairEquity(eq2,fu2,anchorT,targetT);const expected=(1.01/1.01)*(102/101.5);assert(Math.abs(f.factor-expected)<1e-10);assert.equal(f.source,'equity+future');
const activeSession={code:'REG'};assert.equal(c.classifyQuality(activeSession,2*3600).quality,'stale');assert.equal(c.classifyQuality(activeSession,10*60,{proxy:true}).quality,'live');assert(c.classifyQuality(activeSession,10*60,{proxy:true}).label.includes('프록시'));assert.equal(c.classifyQuality(activeSession,10*60,{fxFallback:true}).quality,'partial');
assert(Math.abs(c.applyMoveScale(1.02,0.75)-1.015)<1e-12);assert.equal(c.applyMoveScale(1,0.8),1);
const semi=c.CFG.find(x=>x.code==='381180'),ai=c.CFG.find(x=>x.code==='487230'),space=c.CFG.find(x=>x.code==='0183J0'),gold=c.CFG.find(x=>x.code==='0072R0');
assert.equal(semi.moveScale,0.75);
assert.equal(ai.type,'basket');assert.equal(ai.future,'NQ=F');assert.equal(ai.moveScale,0.8);assert.equal(Object.keys(ai.holdings).length,6);
assert.equal(space.future,'NQ=F');assert.equal(space.backupFuture,'RTY=F');
assert.equal(gold.moveScale,0.8);
const {symbolSet,commonAsOf,activeDriverSymbols,SAFE_LAG_SEC}=require('./api/engine');assert.equal(symbolSet().size,15);
assert.equal(SAFE_LAG_SEC,600);assert.deepEqual(activeDriverSymbols().sort(),['ES=F','GC=F','KRW=X','NQ=F'].sort());
const nowT=Date.parse('2026-09-18T12:00:00Z')/1000,cap=nowT-600;
const common=commonAsOf({
  'KRW=X':[{t:cap,p:1300}],
  'ES=F':[{t:cap,p:6000}],
  'NQ=F':[{t:cap-300,p:25000}],
  'GC=F':[{t:cap,p:3800}]
},nowT);
assert.equal(common.t,cap-300);assert.equal(common.lagSec,900);
const eq5=[{t:regT,p:100},{t:targetT-300,p:101}],fu5=[{t:regT,p:100},{t:anchorT,p:101},{t:targetT-300,p:101.5},{t:targetT,p:102}];
f=c.fairEquity(eq5,fu5,anchorT,targetT);
assert.equal(f.source,'equity+future');assert.equal(f.futureAt,targetT);

// v1.6.1 — [1] 보정계수는 기초자산에만, 환율은 1:1
{
  const under=1.01, fx=1.01, scale=0.8;
  const fixed=c.applyMoveScale(under,scale)*fx;        // 1.008 × 1.01
  const old=c.applyMoveScale(under*fx,scale);          // 기존 방식
  assert(Math.abs(fixed-1.01808)<1e-12);
  assert(Math.abs(old-1.01608)<1e-12);
  const src=require('fs').readFileSync('./api/engine.js','utf8');
  assert(src.includes('applyMoveScale(calc.factor,calibrationScale)*fxFactor'));
}
// v1.6.1 — [2] 정규장 종가는 15:55 봉(16:00 가격), 장후 16:00·16:05 봉은 제외
{
  const b1555=Date.parse('2026-09-17T19:55:00Z')/1000, b1600=b1555+300, b1605=b1555+600;
  const pts=[{t:b1555-300,p:99},{t:b1555,p:100},{t:b1600,p:105},{t:b1605,p:108}];
  assert.equal(c.regularCloseBefore(pts,anchorT).p,100);
  // 15:55 봉이 없으면 15:50 봉 사용
  assert.equal(c.regularCloseBefore([{t:b1555-300,p:99},{t:b1600,p:105}],anchorT).p,99);
  // 장후 급등은 예상치에 반영되어야 한다 (16:05 봉 8% 상승)
  const fuFlat=[{t:b1555,p:100},{t:anchorT,p:100},{t:targetT,p:100}];
  const g=c.fairEquity([...pts,{t:targetT,p:108}],fuFlat,anchorT,targetT);
  assert(Math.abs(g.factor-1.08)<1e-10);
}
// v1.6.1 — [3] 선물 보정 실패 시 플래그와 품질 '부분'
{
  const fuMissing=[{t:regT,p:100},{t:targetT,p:102}];   // 15:30 KST 부근 선물 없음
  const g=c.fairEquity(eq,fuMissing,anchorT,targetT);
  assert.equal(g.adjusted,false);assert.equal(g.adjustFailed,true);
  const q=c.classifyQuality({code:'REG'},60,{adjustFailed:true});
  assert.equal(q.quality,'partial');assert(q.label.includes('선물보정실패'));
  const ok=c.fairEquity(eq,fu,anchorT,targetT);assert.equal(ok.adjustFailed,false);
  // 선물 자체를 쓰지 않는 계산은 실패로 보지 않음
  assert.equal(c.fairEquity(eq,null,anchorT,targetT).adjustFailed,false);
  // 바스켓: 구성종목 하나라도 보정 실패면 전파
  const {basketEquity}=require('./api/engine');
  const cfg={future:'NQ=F',holdings:{A:.5,B:.5}};
  const charts={'NQ=F':fuMissing,A:eq,B:eq};
  assert.equal(basketEquity(cfg,charts,anchorT,targetT).adjustFailed,true);
}
console.log('all tests passed');
