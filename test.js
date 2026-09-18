const assert = require('assert');
const c = require('./api/core');

const rows=[
  {localTradedAt:'2026-09-17',closePrice:'7,585'},
  {localTradedAt:'2026-09-16',closePrice:'7,315'},
  {localTradedAt:'2026-09-15',closePrice:'7,270'}
];
let r=c.selectKrxReference(rows,new Date('2026-09-17T11:00:00Z')); // 20:00 KST
assert.equal(r.date,'2026-09-17');
r=c.selectKrxReference(rows,new Date('2026-09-17T05:00:00Z')); // 14:00 KST
assert.equal(r.date,'2026-09-16');
assert.equal(c.findExactClose(rows,'2026-09-17').v,7585);
assert.equal(c.findExactClose(rows,'2026-09-14'),null);

// Fair-value isolation: stock +2% from prior US close, futures had already risen 1% by KRX close -> ~+0.99% after anchor.
const regT=Date.parse('2026-09-16T20:00:00Z')/1000;
const anchorT=Date.parse('2026-09-17T06:30:00Z')/1000;
const targetT=Date.parse('2026-09-17T11:00:00Z')/1000;
const eq=[{t:regT,p:100},{t:targetT,p:102}];
const fu=[{t:regT,p:100},{t:anchorT,p:101},{t:targetT,p:102}];
let f=c.fairEquity(eq,fu,anchorT,targetT);
assert(Math.abs(f.factor-(1.02/1.01))<1e-10);
assert.equal(f.directFresh,true);

// Stale stock: future continuation should carry from stale trade to target.
const staleT=Date.parse('2026-09-17T10:00:00Z')/1000;
const eq2=[{t:regT,p:100},{t:staleT,p:101}];
const fu2=[{t:regT,p:100},{t:anchorT,p:101},{t:staleT,p:101.5},{t:targetT,p:102}];
f=c.fairEquity(eq2,fu2,anchorT,targetT);
const expected=(1.01*(102/101.5))/(101/100);
assert(Math.abs(f.factor-expected)<1e-10);
assert.equal(f.directFresh,false);

console.log('all tests passed');
