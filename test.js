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
const regT=Date.parse('2026-09-17T20:00:00Z')/1000,targetT=Date.parse('2026-09-18T11:00:00Z')/1000;
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
console.log('all tests passed');
