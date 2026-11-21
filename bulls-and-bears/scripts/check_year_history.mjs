import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
const repository=new URL('../',import.meta.url);
const nested=await fs.access(new URL('dist/feed.js',repository)).then(()=>true,()=>false);
const root=nested?new URL('dist/',repository):repository;
const {loadCryptoYear,intervalMs}=await import(new URL('crypto-intervals.js',root));
const {perpetualSources}=await import(new URL('perpetuals.js',root));
const {loadFutureYear}=await import(new URL('futures/year.js',root));
const read=path=>fs.readFile(new URL(path,root));
const unpack=async path=>JSON.parse(gunzipSync(await read(path)));
const quarter=intervalMs['15m'], start=Date.UTC(2026,0,1);
const bar=r=>({time:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]});
const controller=new AbortController();
let total=0;
globalThis.fetch=async u=>{
  const url=new URL(u);
  assert.equal(url.protocol,'file:','Historical tests must pass with venue APIs offline');
  return new Response(await fs.readFile(url));
};
for(const [symbol,venues] of Object.entries(perpetualSources))for(const sourceId of venues){
  const a=await unpack('year/crypto/'+symbol+'-'+sourceId+'.json.gz');
  assert.equal(a.symbol,symbol);assert.equal(a.sourceId,sourceId);assert.equal(a.start,start);
  assert.equal(a.rows.length*quarter,a.end-start);assert(a.rows.length>9000);
  for(let i=0;i<a.rows.length;i++){
    const [t,o,h,l,c,v]=a.rows[i];
    assert(t===start+i*quarter && l>0 && l<=Math.min(o,c) && h>=Math.max(o,c) && v>=0);
  }
  const state={symbol,sourceId, source:sourceId, market:'perpetual',asOf:a.end-1,candles:a.rows.slice(-675).map(bar)};
  for(const [frame,w] of Object.entries(intervalMs)){
    if(frame==='1m') {
      const b=await loadCryptoYear(state,frame,controller.signal,'2026-01-01');
      const native=await unpack('minutes/'+symbol+'-'+sourceId+'-start.json.gz');
      assert.equal(b.coverage,'day');assert.equal(b.candles.length,1440);
      assert.deepEqual(b.candles,native.rows.map(bar));assert.equal(b.dateRange.first,'2026-01-01');
      total++;continue;
    }
    const b=await loadCryptoYear(state,frame,controller.signal);
    const n=w/quarter;
    assert.equal(b.coverage,'full');assert.equal(b.sourceId,sourceId);assert.equal(b.candles.length,a.rows.length/n);
    assert.equal(b.candles[0].time,start);assert.equal(b.candles.at(-1).time+w,a.end);
    for(const i of [0,Math.floor(b.candles.length/2),b.candles.length-1]){
      const slice=a.rows.slice(i*n,(i+1)*n);
      assert.equal(b.candles[i].open,slice[0][1]);assert.equal(b.candles[i].high,Math.max(...slice.map(r=>r[2])));
      assert.equal(b.candles[i].low,Math.min(...slice.map(r=>r[3])));assert.equal(b.candles[i].close,slice.at(-1)[4]);
      assert(Math.abs(b.candles[i].volume-slice.reduce((t,r)=>t+r[5],0))<1e-5);
    }total++;
  }
}
for(const symbol of ['IF','IH','IC','IM']){
  const snap=JSON.parse(await read('futures/data/'+symbol+'.json'));
  const arch=await unpack('year/futures/'+snap.contract+'.json.gz');
  assert.equal(arch.contract,snap.contract);assert.equal(arch.sourceId,snap.sourceId);
  for(const frame of Object.keys(intervalMs)){
    const source=frame==='1m'?snap.minuteBars:frame==='1d'?snap.days:snap.intraday;
    let candles=source.map(r=>bar([r[0]*1000,...r.slice(1)]));
    if(frame==='30m' || frame==='1h')candles=arch.frames[frame].slice(-100).map(r=>bar([r[0]*1000,...r.slice(1)]));
    const state={...snap,interval:frame,candles};
    const b=await loadFutureYear(state,frame,controller.signal);
    const d=new Date(b.candles[0].time+8*3600_000).toISOString().slice(0,10);
    assert.equal(b.contract,snap.contract);assert(d>=snap.listingDate);
    assert.equal(b.coverage,d===snap.listingDate?'full':'partial');total++;
  }
}
console.log('PASS',total,'real annual series: continuous venue-native crypto and exact CFFEX delivery months');
