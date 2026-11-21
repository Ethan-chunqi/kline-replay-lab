// A delivery month has its own listing date and prices. Never substitute another month.
const minute=60_000,day=86_400_000;
const widths={'1m':1,'15m':15,'30m':30,'1h':60,'1d':1440};
const byContract=new Map();
function cnDate(t) {return new Date(t+8*3600_000).toISOString().slice(0,10);}
function bar(r) {return {time:r[0]*1000,open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]};}

function directory(url) {
  const result=new URL(url,import.meta.url);
  if(!result.pathname.endsWith('/'))result.pathname+='/';
  return result;
}

function quoteArchiveURL(contract) {
  const quotes=directory(globalThis.EQUITY_DATA_URL || 'https://raw.githubusercontent.com/Ethan-chunqi/kline-replay-lab/market-data/quotes/');
  const feed=globalThis.FUTURES_DATA_URL ? directory(globalThis.FUTURES_DATA_URL) : new URL('futures/',quotes);
  return new URL('../year/futures/'+contract+'.json.gz',feed);
}

async function readArchive(url,state,timeout) {
  const response=await fetch(url,{credentials:'omit',cache:'no-cache',signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw Error('Missing delivery month archive');
  const bytes=await response.arrayBuffer(), header=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
  const stream=new Blob([bytes]).stream();
  const raw=await new Response(header[0]===31&&header[1]===139 ? stream.pipeThrough(new DecompressionStream('gzip')) : stream).json();
  if(raw.schema!==1 || raw.symbol!==state.symbol || raw.sourceId!==state.sourceId || raw.listingDate!==state.listingDate ||
     raw.contract!==state.contract || !Number.isSafeInteger(raw.asOf) || !raw.frames || !/新浪|Sina/i.test(raw.source))
    throw Error('Delivery month mismatch');
  for(const frame of ['1m','15m','30m','1h']){
    const rows=raw.frames[frame];
    if(!Array.isArray(rows) || !rows.length || rows.some((r,i)=>
      !Array.isArray(r) || r.length!==6 || !r.every(Number.isFinite) || !Number.isSafeInteger(r[0]) ||
      r[3]<=0 || r[3]>Math.min(r[1],r[4]) || r[2]<Math.max(r[1],r[4]) || r[5]<0 ||
      r[0]*1000>raw.asOf || (i && rows[i-1][0]>=r[0])))throw Error('Invalid archive candles');
  }
  return raw;
}

function nativeArchive(state) {
  const remote=quoteArchiveURL(state.contract);
  const key=remote.href+'/'+state.listingDate;
  const cached=byContract.get(key);
  if(cached && cached.expires>Date.now())return cached.pending;
  const bundled=new URL('../year/futures/'+state.contract+'.json.gz',import.meta.url);
  const pending=Promise.allSettled([readArchive(remote,state,3500),readArchive(bundled,state,10000)])
    .then(results=>{
      const options=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
      if(!options.length)throw Error('No verified archive for this delivery month');
      return options.sort((a,b)=>b.asOf-a.asOf)[0];
    }).catch(error=>{if(byContract.get(key)?.pending===pending)byContract.delete(key);throw error;});
  byContract.set(key,{pending,expires:Date.now()+15*60_000});
  if(byContract.size>12)byContract.delete(byContract.keys().next().value);
  return pending;
}

export async function loadFutureYear(state,interval,signal) {
  if (!widths[interval] || !/^(IM|IC|IF|IH)\d{4}$/.test(state.contract) || state.sourceId!=='cffex-'+state.contract ||
      state.interval!==interval || !state.candles?.length) throw Error('Actual delivery month required');
  const start=Date.parse('2026-01-01T00:00:00+08:00');
  const firstAllowed=Math.max(start,Date.parse(state.listingDate+'T00:00:00+08:00'));
  let candles=state.candles.filter(b=>b.time>=firstAllowed && b.time<=state.asOf);
  let source=interval==='1d' ? state.dailySource : state.barSource;
  let reason='limited';
  if(interval!=='1d') {
    try {
      const raw=await nativeArchive(state);signal?.throwIfAborted();
      const independent=raw.frames[interval].map(bar).filter(b=>b.time>=firstAllowed && b.time<=state.asOf);
      if(independent.length && independent[0].time < (candles[0]?.time ?? Infinity)) {
        // Merge only overlapping bars from the same data provider and the same contract.
        // When the source differs, retain its certified stand-alone range and label its last date.
        const same=/新浪|Sina/i.test(source || '');
        if(same && candles[0] && independent.at(-1).time>=candles[0].time) {
          const tail=independent.at(-1).time;
          candles=independent.concat(candles.filter(b=>b.time>tail));
        } else {candles=independent;reason='archiveEnd';}
        source=raw.source;
      }
    } catch(e){if(signal?.aborted)throw e;}
  }
  if(!candles.length)throw Error('Delivery month history unavailable');
  const fullStart=cnDate(candles[0].time)<=cnDate(firstAllowed);
  const fullEnd=cnDate(candles.at(-1).time)===cnDate(state.asOf);
  return {candles,symbol:state.symbol,contract:state.contract,sourceId:state.sourceId,source,interval,
    coverage:fullStart&&fullEnd?'full':'partial',reason:fullStart&&!fullEnd?'archiveEnd':reason,
    listingDate:state.listingDate,asOf:fullEnd?state.asOf:Math.min(state.asOf,candles.at(-1).time+Math.min(day,widths[interval]*minute)-1)};
}
