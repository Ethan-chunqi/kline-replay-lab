// Exchange-traded base-asset volume. All intervals here are half-open in milliseconds.
import {perpetualSources,bitgetPath} from './perpetuals.js?v=20261122-market-v3';

const MINUTE=60_000, QUARTER=900_000, DAY=86_400_000;
const frames=new Map([[MINUTE,'1m'],[QUARTER,'15m'],[DAY,'1d']]);
const pages=new Map();
const tradeMinutes=new Map();
let checkpoints;

async function json(url,signal) {
  const controller=new AbortController(), abort=()=>controller.abort();
  if(signal?.aborted)signal.throwIfAborted();
  signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,4000);
  try {
    const res=await fetch(url,{signal:controller.signal,credentials:'omit'});
    if(!res.ok)throw Error('Market data unavailable');
    return await res.json();
  } finally {
    clearTimeout(timeout);signal?.removeEventListener('abort',abort);
  }
}

async function history() {
  if(!checkpoints)checkpoints=json(new URL('./history/period-volumes.json?v=20261122-share',import.meta.url))
    .then(data=>data.schema===1?data.checkpoints:{})
    .catch(()=>{checkpoints=null;return {};});
  return checkpoints;
}

function openAt(time,width) {return Math.floor(time/width)*width;}
function validVolume(value) {return Number.isFinite(value) && value>=0;}

async function fetchBars(ctx,width,start,end) {
  const {symbol,sourceId,signal}=ctx, limit=(end-start)/width, frame=frames.get(width);
  const key=[symbol,sourceId,frame,start,end].join('/');
  if(pages.has(key))return pages.get(key);
  let rows;
  if(sourceId==='binance-usdm') {
    const query=new URLSearchParams({symbol,interval:frame,startTime:start,endTime:end-1,limit});
    rows=await json('https://fapi.binance.com/fapi/v1/klines?'+query,signal);
    if(!Array.isArray(rows)||rows.some(row=>+row[6]!==+row[0]+width-1))throw Error('Invalid Binance candles');
  } else if(sourceId==='bybit-linear') {
    const query=new URLSearchParams({category:'linear',symbol,interval:width===DAY?'D':String(width/MINUTE),start,end:end-1,limit});
    const raw=await json('https://api.bybit.com/v5/market/kline?'+query,signal);
    if(raw.retCode!==0||raw.result?.symbol!==symbol||raw.result.category!=='linear')throw Error('Invalid Bybit candles');
    rows=raw.result.list;
  } else {
    const args={granularity:width===DAY?'1Dutc':frame,startTime:start,endTime:end,limit};
    let raw=await json(bitgetPath('history-candles',symbol,args),signal);
    if(raw.code!=='00000'||!Array.isArray(raw.data))throw Error('Invalid Bitget candles');
    rows=raw.data;
    if(!rows.some(row=>+row[0]===end-width) && end>Date.now()-width*2) {
      raw=await json(bitgetPath('candles',symbol,{...args,endTime:end-1}),signal);
      if(raw.code!=='00000')throw Error('Invalid recent Bitget candles');
      rows=raw.data;
    }
  }
  const bars=rows.filter(r=>+r[0]>=start && +r[0]<end)
    .map(r=>({time:+r[0],high:+r[2],low:+r[3],volume:+r[5]})).sort((a,b)=>a.time-b.time);
  if(bars.length!==limit||bars.some((bar,i)=>bar.time!==start+i*width||!validVolume(bar.volume)
      ||!Number.isFinite(bar.high)||!Number.isFinite(bar.low)))throw Error('Incomplete candle history');
  // A page containing the open minute may acquire more trades after this request.
  if(end<=Date.now() && end<=ctx.asOf+1) {
    if(pages.size>=200)pages.delete(pages.keys().next().value);
    pages.set(key,bars);
  }
  return bars;
}

async function volumeAtWidth(ctx,width,start,end) {
  let volume=0;
  const limit=ctx.sourceId==='bitget-usdt'?(width===DAY?85:200):1000;
  for(let cursor=start;cursor<end;) {
    if(width===QUARTER && ctx.closed.has(cursor)) {
      volume+=ctx.closed.get(cursor);cursor+=width;continue;
    }
    // Also use complete local quarters for a day covered by this feed.
    if(width===DAY && ctx.closed.has(cursor) && ctx.closed.has(cursor+DAY-QUARTER)) {
      volume+=await volumeAtWidth(ctx,QUARTER,cursor,cursor+DAY);
      cursor+=DAY;continue;
    }
    const stop=Math.min(end,cursor+width*limit);
    const bars=await fetchBars(ctx,width,cursor,stop);
    for(const bar of bars)volume+=bar.volume;
    cursor=stop;
  }
  return volume;
}

async function bridge(ctx,start,end) {
  if(start>=end)return 0;
  const segments=[];
  function take(width,stop) {
    if(stop<=start)return;
    segments.push(volumeAtWidth(ctx,width,start,stop));start=stop;
  }
  take(MINUTE,Math.min(end,Math.ceil(start/QUARTER)*QUARTER));
  if(start<end && end-start>=DAY) {
    take(QUARTER,Math.min(openAt(end,QUARTER),Math.ceil(start/DAY)*DAY));
    take(DAY,openAt(end,DAY));
  }
  take(QUARTER,openAt(end,QUARTER));
  take(MINUTE,end);
  return (await Promise.all(segments)).reduce((a,b)=>a+b,0);
}

function matchingSeed(list,point,kind) {
  const width=Math.max(1,point.precisionMs||MINUTE);
  return list.find(seed=>seed.kind===kind && seed.price===point.price &&
    (width<MINUTE ? seed.fromTime===point.time : seed.minute>=point.time && seed.minute<point.time+width));
}

async function minuteForPoint(ctx,point,kind,end) {
  const start=openAt(point.time,MINUTE);
  if((point.precisionMs||MINUTE)<=MINUTE)return start;
  const stop=Math.min(end,start+point.precisionMs);
  if(stop<=start)return null;
  if(stop-start>QUARTER) {
    // Locate the quarter before requesting individual minutes of a daily extreme.
    if(start%QUARTER!==0)return null;
    const fullStop=openAt(stop,QUARTER);
    const quarters=await fetchBars(ctx,QUARTER,start,fullStop);
    const found=quarters.find(r=>r[kind]===point.price);
    if(found)return minuteForPoint(ctx,{...point,time:found.time,precisionMs:QUARTER},kind,end);
    if(fullStop===stop)return null;
    return minuteForPoint(ctx,{...point,time:fullStop,precisionMs:QUARTER},kind,end);
  }
  const rows=await fetchBars(ctx,MINUTE,start,stop);
  return rows.find(r=>r[kind]===point.price)?.time??null;
}

// A new BTC peak/trough can appear after publication. Refine it only when we can
// reconcile an entire minute and the first aggregate at the extreme is one execution.
async function recentExecution(ctx,minute,price) {
  if(ctx.symbol!=='BTCUSDT'||ctx.sourceId!=='binance-usdm'||minute<Date.now()-2*DAY||minute+MINUTE>ctx.asOf+1)return null;
  const key=minute+'/'+price;
  if(tradeMinutes.has(key))return tradeMinutes.get(key);
  const endpoint='https://fapi.binance.com/fapi/v1/aggTrades?';
  let query={symbol:ctx.symbol,startTime:minute,endTime:minute+MINUTE-1,limit:1000};
  let previous,hit=null,total=0,after=0,complete=false;
  try {
    for(let page=0;page<5;page++) {
      const list=await json(endpoint+new URLSearchParams(query),ctx.signal);
      if(!Array.isArray(list))return null;
      for(const r of list) {
        if(r.T>=minute+MINUTE)break;
        if(r.T<minute||!Number.isSafeInteger(r.a)||!validVolume(+r.q)||(previous!=null && r.a!==previous+1))return null;
        previous=r.a;total+=+r.q;
        if(!hit && +r.p===price)hit=r;
        if(hit)after+=+r.q;
      }
      if(list.length<1000||list.at(-1).T>=minute+MINUTE){complete=true;break;}
      query={symbol:ctx.symbol,fromId:previous+1,limit:1000};
    }
    let refined=null;
    if(complete && hit && Number.isSafeInteger(hit.f) && hit.f===hit.l) {
      const [bar]=await fetchBars(ctx,MINUTE,minute,minute+MINUTE);
      if(Math.abs(total-bar.volume)<0.0000001)refined={time:hit.T,volume:after};
    }
    if(tradeMinutes.size>=48)tradeMinutes.delete(tradeMinutes.keys().next().value);
    tradeMinutes.set(key,refined);
    return refined;
  } catch {
    ctx.signal?.throwIfAborted();
    return null;
  }
}

export async function loadPeriodVolume({symbol,sourceId,point,asOf,candles=[],signal,kind}) {
  if(!perpetualSources[symbol]?.includes(sourceId)||!['high','low'].includes(kind)||
      !Number.isSafeInteger(point?.time)||!(point.price>0)||!Number.isSafeInteger(asOf)||point.time>asOf)return null;
  signal?.throwIfAborted();
  const end=openAt(asOf+1,MINUTE), closed=new Map();
  const lastTime=candles.at(-1)?.time;
  for(const bar of candles) {
    // A late quote timestamp alone cannot certify that the last, still-open
    // websocket update contained all trades in that quarter.
    if(bar.time===lastTime && !bar.closed && asOf!==bar.time+QUARTER-1)continue;
    if(Number.isSafeInteger(bar.time) && bar.time%QUARTER===0 && bar.time+QUARTER<=end && validVolume(bar.volume))
      closed.set(bar.time,bar.volume);
  }
  const ctx={symbol,sourceId,signal,asOf,closed};
  try {
    const all=await history();
    signal?.throwIfAborted();
    const seed=matchingSeed(all[symbol+'/'+sourceId]||[],point,kind);
    let from,pointTime,precisionMs,start,amount,fromMinute;
    if(seed && end>=seed.minute+MINUTE) {
      from=pointTime=seed.fromTime;
      precisionMs=seed.precisionMs;fromMinute=seed.precisionMs>=MINUTE;
      if(end>=seed.end) {start=seed.end;amount=seed.volume;}
      else {start=seed.minute+MINUTE;amount=seed.openingVolume;}
    } else {
      // Without verified executions, report the start of the containing minute, never a fabricated trade time.
      start=await minuteForPoint(ctx,point,kind,end);
      if(start==null||end<=start)return null;
      from=start;pointTime=(point.precisionMs||MINUTE)<MINUTE?point.time:start;
      precisionMs=Math.min(point.precisionMs||MINUTE,MINUTE);amount=0;fromMinute=true;
      const execution=await recentExecution(ctx,start,point.price);
      if(execution){
        from=pointTime=execution.time;precisionMs=1;amount=execution.volume;start+=MINUTE;fromMinute=false;
      }
    }
    const boundary=Math.max(start,openAt(end,QUARTER));
    const complete=await bridge(ctx,start,boundary);
    let tail=0, to=end-1;
    if(end>boundary) {
      try {tail=await bridge(ctx,boundary,end);}
      catch(error) {
        signal?.throwIfAborted();
        // Offline snapshots can still certify the preceding complete quarter. Show its real cutoff.
        if(boundary<=from)return null;
        to=boundary-1;
      }
    }
    const volume=amount+complete+tail;
    return validVolume(volume)&&to>=from?{volume,from,to,pointTime,precisionMs,fromMinute}:null;
  } catch(error) {
    signal?.throwIfAborted();
    return null;
  }
}
