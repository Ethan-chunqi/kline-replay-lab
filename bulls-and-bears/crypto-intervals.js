import {perpetualSources,bitgetKlines,venueNames} from './perpetuals.js?v=20261122-market-v3';
// Native USDT perpetual klines and exact, gap-checked aggregation of the live 15m feed.
export const intervalMs = { '1m':60000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '1d': 86_400_000 };
const day = intervalMs['1d'];
const allowed = new Set(Object.keys(perpetualSources));
const hosts = { 'bitget-usdt':['https://api.bitget.com'], 'binance-usdm': ['https://fapi.binance.com'], 'bybit-linear': ['https://api.bybit.com', 'https://api.bytick.com'] };
const cache = new Map();

function memo(key, task) {
  if (!cache.has(key)) {
    const result = task().catch(error => { cache.delete(key); throw error; });
    cache.set(key, result);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

async function json(url, signal) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 6500);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: signal ? AbortSignal.any([signal,abort.signal]) : abort.signal });
    if (!response.ok) throw new Error('Market data request failed');
    return await response.json();
  } finally { clearTimeout(timer); }
}

function barsFrom(rows, width) {
  const candles = rows.map(r => ({
    time: +r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5],
  }));
  if (!candles.length || candles.some((b, i) => !Number.isSafeInteger(b.time) || b.time % width !== 0 ||
    ![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) || b.low <= 0 || b.volume < 0 ||
    b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close) ||
    (i > 0 && b.time - candles[i-1].time !== width))) throw new Error('Incomplete candlesticks');
  return candles;
}

function rolled(candles, width) {
  if (width === intervalMs['15m']) return candles;
  const result = [];
  for (const b of candles) {
    const start = Math.floor(b.time / width) * width;
    const current = result.at(-1);
    if (current?.time !== start) {
      // Omit the first partial bucket when its opening candle is outside the source history.
      if (b.time === start) result.push({ ...b });
    } else {
      current.high = Math.max(current.high, b.high);
      current.low = Math.min(current.low, b.low);
      current.close = b.close;
      current.volume += b.volume;
    }
  }
  return result;
}

async function nativeBars(state, interval, start, end, count, signal) {
  const { symbol, sourceId } = state;
  if(!perpetualSources[symbol]?.includes(sourceId))throw Error('Unverified contract source');
  if(sourceId==='bitget-usdt')return barsFrom(await bitgetKlines(symbol,interval,start,end,count,url=>json(url,signal)),intervalMs[interval]);
  const binance = sourceId === 'binance-usdm';
  const q = new URLSearchParams({ symbol, limit: String(count) });
  if (binance) {
    q.set('interval', interval);
    q.set('endTime', String(end));
    if (start != null) q.set('startTime', String(start));
  } else {
    q.set('category', 'linear');
    q.set('interval', { '1m':'1','15m':'15', '30m':'30', '1h':'60', '1d':'D' }[interval]);
    q.set('end', String(end));
    if (start != null) q.set('start', String(start));
  }
  for (const host of hosts[sourceId]) {
    signal?.throwIfAborted();
    try {
      const raw = await json(host + (binance ? '/fapi/v1/klines?' : '/v5/market/kline?') + q,signal);
      if (binance) {
        if (!Array.isArray(raw) || raw.some(r => +r[6] - +r[0] + 1 !== intervalMs[interval])) throw Error();
        return barsFrom(raw, intervalMs[interval]);
      }
      if (raw.retCode !== 0 || raw.result.symbol !== symbol || raw.result.category !== 'linear') throw Error();
      return barsFrom(raw.result.list.slice().reverse(), intervalMs[interval]);
    } catch { /* Fallback host belongs to the same exchange and contract. */ }
  }
  throw new Error('Historical candlesticks unavailable');
}

function bundledDays(state, suffix = '') {
  const { symbol, sourceId } = state;
  return memo('bundle/' + symbol + '/' + sourceId + suffix, async () => {
    const data = await json(new URL('./daily/' + symbol + '-' + sourceId + suffix + '.json', import.meta.url));
    if (data.market !== 'perpetual' || data.symbol !== symbol || data.sourceId !== sourceId || data.interval !== '1d') throw Error('Invalid market');
    return barsFrom(data.rows, day).filter(b => b.time + day - 1 <= data.asOf);
  });
}

async function currentDays(state) {
  const liveDays = rolled(state.candles, day);
  if (!liveDays.length) throw new Error('Daily history unavailable');
  const from = liveDays[0].time;
  function combine(days) {
    const history = days.filter(b => b.time < from);
    if (history.length < 30 || history.at(-1).time + day !== from) return null;
    return history.concat(liveDays).slice(-365);
  }
  try {
    const cached = combine(await bundledDays(state));
    if (cached) return cached;
  } catch { /* Use the venue when the static daily history is absent or too old. */ }
  const key = [state.symbol, state.sourceId, 'daily', from].join('/');
  const days = await memo(key, () => nativeBars(state, '1d', null, from - 1, 365));
  const result = combine(days);
  if (!result) throw new Error('Daily history has a gap');
  return result;
}

function match(bars, interval, p, kind) {
  const precision = p.precisionMs ?? 1;
  const width = intervalMs[interval];
  if (precision > width) return false;
  return bars.some(b => b.time <= p.time && p.time + precision <= b.time + width &&
    (kind ? b[kind] === p.price : b.high === p.price || b.low === p.price));
}

const remembered = new Map();

function memoryKey(view, kind, interval) {
  return ['market-extreme-v1',view.symbol,view.sourceId,kind,interval].join('/');
}

function snapWindow(candles, i, radius) {
  return candles.slice(Math.max(0, i - radius), i + radius + 1).map(b => [b.time,b.open,b.high,b.low,b.close,b.volume]);
}

// Save previously observed, verified price bars so a newly reached extreme can still
// be revisited after the live rolling feed has advanced beyond it.
export function rememberCryptoLevel(view, kind, candles, index) {
  if (!['15m','1d'].includes(view.interval) || index < 0 || view.market !== 'perpetual' || !allowed.has(view.symbol) ||
      !hosts[view.sourceId] || view.historical || !view.levels?.[kind]) return;
  const p = view.levels[kind];
  const key = memoryKey(view,kind,view.interval);
  const end = candles[Math.min(index + 138,candles.length - 1)].time;
  const prev = remembered.get(key);
  if (prev && prev.time === p.time && prev.price === p.price && prev.end === end) return;
  const stored = { symbol: view.symbol, sourceId: view.sourceId, kind, interval: view.interval, time: p.time, price: p.price, end, rows: snapWindow(candles,index,138) };
  remembered.set(key,stored);
  try { localStorage.setItem(key,JSON.stringify(stored)); } catch { /* Memory remains available. */ }
}

function rememberedBars(state, interval, p, kind) {
  if(interval==='1m')return null;
  const input = interval === '1d' ? '1d' : '15m';
  const key = memoryKey(state,kind,input);
  let stored = remembered.get(key);
  try { stored ??= JSON.parse(localStorage.getItem(key)); } catch { /* No saved window. */ }
  if (!stored || stored.symbol !== state.symbol || stored.sourceId !== state.sourceId ||
      stored.kind !== kind || stored.interval !== input || p.time !== stored.time || p.price !== stored.price) return null;
  try {
    const native = barsFrom(stored.rows,intervalMs[input]);
    // The last cached candle might have been observed before it closed. Only use
    // candles proven closed by the existence of a later candle in this capture.
    const closed = native.slice(0,-1);
    const bars = rolled(closed,intervalMs[interval]).filter(b => b.time + intervalMs[interval] <= native.at(-1).time);
    return match(bars,interval,p,kind) ? bars : null;
  } catch { return null; }
}

function extremeData(state,kind) {
  const { symbol,sourceId } = state;
  const key = [symbol,sourceId,kind,'extreme-window'].join('/');
  return memo(key, async () => {
    const result = await json(new URL('./extreme-windows/' + symbol + '-' + sourceId + '-' + kind + '.json', import.meta.url));
    if (result.symbol !== symbol || result.sourceId !== sourceId || result.kind !== kind || result.market !== 'perpetual') throw Error('Invalid market');
    return result;
  });
}
async function bundledWindow(state, interval, p, kind) {
  if (kind !== 'high' && kind !== 'low') return null;
  const data=await extremeData(state,kind);
  const base = interval === '1m' ? '1m' : interval === '1d' ? '1d' : '15m';
  const native = barsFrom(data.windows[base],intervalMs[base]);
  const end = Math.min(state.asOf + 1,native.at(-1).time + intervalMs[base]);
  const bars = rolled(native,intervalMs[interval]).filter(b => b.time + intervalMs[interval] <= end);
  return match(bars,interval,p,kind) ? bars : null;
}

async function nearby(state, interval, point, kind) {
  const width = intervalMs[interval];
  const bucket = Math.floor(point.time / width) * width;
  const start = Math.max(0, bucket - 65 * width);
  const end = Math.min(state.asOf, bucket + 66 * width - 1);
  if (end < bucket) throw new Error('Anchor lies outside the quote history');
  // A still-open window changes on each refresh. Permanently cache only fully closed windows.
  const key = [state.symbol, state.sourceId, interval, bucket, Math.floor(end / width)].join('/');
  const load = () => nativeBars(state, interval, start, end, 132);
  const seen = rememberedBars(state,interval,point,kind);
  if (seen) return seen;
  try {
    const known = await bundledWindow(state,interval,point,kind);
    if (known) return known;
  } catch { /* The requested extreme may have appeared after the site was built. */ }
  let bars;
  if (interval === '1d') {
    try {
      const daily = (await bundledDays(state)).filter(b => b.time >= start && b.time <= end);
      if (daily.length >= 5 && daily[0].time <= bucket && daily.at(-1).time >= bucket &&
          bucket + day <= state.asOf && match(daily, interval, point, kind)) return daily;
    } catch { /* Request older history directly from the venue. */ }
  }
  bars = end === bucket + 66 * width - 1 ? await memo(key, load) : await load();
  if (!match(bars, interval, point, kind)) throw new Error('Anchor does not match this candle');
  return bars;
}

async function get(state, interval, point, kind) {
  if (state?.market !== 'perpetual' || !allowed.has(state?.symbol) || !perpetualSources[state?.symbol]?.includes(state.sourceId) || !Object.hasOwn(intervalMs, interval)) {
    throw new Error('Unknown perpetual contract or candle interval');
  }
  const base = { symbol: state.symbol, sourceId: state.sourceId, interval, historical: Boolean(point) };
  if (!point) {
    if(interval==='1m')return {...base,candles:await latestMinutes(state)};
    return { ...base, candles: interval === '1d' ? await currentDays(state) : rolled(state.candles, intervalMs[interval]) };
  }
  if ((point.symbol && point.symbol !== state.symbol) || (point.sourceId && point.sourceId !== state.sourceId) ||
      !Number.isSafeInteger(point.time) || !Number.isFinite(point.price) || (kind && kind !== 'high' && kind !== 'low')) throw new Error('Invalid anchor');
  const recent = interval==='1m' ? [] : rolled(state.candles, intervalMs[interval]);
  if (interval !== '1d' && match(recent, interval, point, kind)) return { ...base, candles: recent };
  if ((point.precisionMs ?? 1) <= intervalMs[interval]) {
    try { return { ...base, candles: await nearby(state, interval, point, kind) }; }
    catch (e) { if (interval === '1d') throw e; }
  }
  const candles = await nearby(state, '1d', point, kind);
  return { ...base, candles, interval: '1d', fallbackInterval: true };
}

// Requests for a finished historical window are shared, while each caller may cancel its wait.
export async function getCryptoBars(feedState, interval = '15m', { signal, point, kind } = {}) {
  if (!signal) return get(feedState, interval, point, kind);
  signal.throwIfAborted();
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(new DOMException('Request aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([get(feedState, interval, point, kind), cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

const yearStart = Date.UTC(2026,0,1);
const quarter = intervalMs['15m'];
const archiveCache = new Map();
const prefixCache = new Map();
let yearDatabase;

function boundedPromise(map,key,limit,build) {
  if (!map.has(key)) {
    const value = build().catch(error => { if (map.get(key)===value) map.delete(key); throw error; });
    map.set(key,value);
    if (map.size>limit) map.delete(map.keys().next().value);
  }
  return map.get(key);
}

async function readYearArchive(state) {
  const id = state.symbol+'-'+state.sourceId;
  return boundedPromise(archiveCache,id,3,async () => {
    const response = await fetch(new URL('./year/crypto/'+id+'.json.gz',import.meta.url), {
      credentials:'omit',signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Annual archive unavailable');
    const bytes = await response.arrayBuffer(), start = new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
    const stream = new Blob([bytes]).stream();
    const data = await new Response(start[0]===31 && start[1]===139 ? stream.pipeThrough(new DecompressionStream('gzip')) : stream).json();
    if (data.schema!==1 || data.symbol!==state.symbol || data.sourceId!==state.sourceId || data.market!=='perpetual' ||
        data.start!==yearStart || data.width!==quarter || data.end!==yearStart+data.rows.length*quarter) throw new Error('Invalid contract archive');
    const bars = barsFrom(data.rows,quarter);
    if (bars[0].time!==yearStart || bars.at(-1).time+quarter!==data.end) throw new Error('Archive range mismatch');
    return bars;
  });
}

function database() {
  if (!yearDatabase) yearDatabase = new Promise(resolve => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    const request = indexedDB.open('verified-contract-history-v1',1);
    request.onupgradeneeded = () => request.result.createObjectStore('closed-pages');
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
  return yearDatabase;
}

async function closedPage(state, start, end) {
  const id=[state.symbol,state.sourceId,start,end].join('/');
  const db=await database();
  if (db) {
    const cached=await new Promise(resolve=>{
      try {
        const q=db.transaction('closed-pages').objectStore('closed-pages').get(id);
        q.onsuccess=()=>resolve(q.result);q.onerror=()=>resolve(null);
      } catch {resolve(null);}
    });
    if (cached?.length===(end-start)/quarter && cached[0].time===start && cached.at(-1).time+quarter===end) return cached;
  }
  const candles=await nativeBars(state,'15m',start,end-1,(end-start)/quarter);
  if (candles.length!==(end-start)/quarter || candles[0].time!==start || candles.at(-1).time+quarter!==end) throw new Error('Incomplete annual page');
  if (db) {
    try {db.transaction('closed-pages','readwrite').objectStore('closed-pages').put(candles,id);} catch { /* Memory-only also works. */ }
  }
  return candles;
}

async function yearPrefix(state,cut,signal) {
  const key=[state.symbol,state.sourceId,cut].join('/');
  const build=async () => {
    let base;
    try {base=await readYearArchive(state);} catch {base=[];}
    const length=Math.max(0,Math.min(base.length,(cut-yearStart)/quarter));
    const prefix=base.slice(0,length);
    let cursor=yearStart+length*quarter;
    while (cursor<cut) {
      signal?.throwIfAborted();
      // Weekly pages fit both venues' 1,000-row ceilings. Only closed pages are cached.
      const stop=Math.min(cut,cursor+7*day);
      prefix.push(...await closedPage(state,cursor,stop));
      cursor=stop;
    }
    return {bars:prefix,frames:new Map()};
  };
  for (;;) {
    signal?.throwIfAborted();
    try {return await boundedPromise(prefixCache,key,3,build);}
    catch(error) {
      // A newer interval may have joined the old interval's still-pending request.
      // Retry with this caller's signal when the original caller switched away.
      if(signal?.aborted || error?.name!=='AbortError')throw error;
    }
  }
}

export async function loadCryptoYear(state, interval, signal, selectedDate) {
  if (state?.market!=='perpetual' || !allowed.has(state.symbol) || !perpetualSources[state.symbol]?.includes(state.sourceId) || !intervalMs[interval] ||
      !state.candles?.length || !Number.isSafeInteger(state.asOf)) throw new Error('Invalid current contract');
  signal?.throwIfAborted();
  if(interval==='1m')return minuteDay(state,selectedDate,signal);
  const cut=Math.max(yearStart,Math.ceil(state.candles[0].time/day)*day);
  const width=intervalMs[interval], source=venueNames[state.sourceId];
  const identity={symbol:state.symbol,sourceId:state.sourceId,source,interval};
  try {
    const prefix=await yearPrefix(state,cut,signal);
    signal?.throwIfAborted();
    if (!prefix.frames.has(interval)) prefix.frames.set(interval,rolled(prefix.bars,width));
    const recent=state.candles.filter(b=>b.time>=cut && b.time<=state.asOf);
    if (!recent.length || recent[0].time!==cut || recent.some((b,i)=>i && b.time!==recent[i-1].time+quarter)) throw new Error('Live tail gap');
    const candles=prefix.frames.get(interval).concat(rolled(recent,width));
    return {...identity,candles,coverage:'full',asOf:state.asOf};
  } catch(error) {
    if(signal?.aborted)throw error;
    // Do not stitch an unreachable gap. Render the verified part and state its end date.
    let archived;
    try {archived=await readYearArchive(state);} catch { /* Source may be unreachable. */ }
    signal?.throwIfAborted();
    if (archived?.length) {
      const closed=archived.filter(b=>b.time+quarter-1<=state.asOf);
      const end=closed.at(-1)?.time+quarter;
      const candles=rolled(closed,width).filter(b=>b.time+width<=end);
      if(candles.length)return {...identity,candles,coverage:'partial',reason:'archiveEnd',asOf:candles.at(-1).time+width-1};
    }
    const candles=interval==='1d'?await currentDays(state):rolled(state.candles,width);
    return {...identity,candles:candles.filter(b=>b.time>=yearStart),coverage:'partial',reason:'limited',asOf:state.asOf};
  }
}


const minute=intervalMs['1m'];
const minuteCache=new Map();

async function minuteFile(state,name) {
  return boundedPromise(minuteCache,[state.symbol,state.sourceId,name].join('/'),28,async()=>{
    const path='./minutes/'+state.symbol+'-'+state.sourceId+'-'+name+'.json.gz';
    const r=await fetch(new URL(path,import.meta.url),{credentials:'omit',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('Missing minute archive');
    const bytes=await r.arrayBuffer(),head=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
    const stream=new Blob([bytes]).stream();
    const data=await new Response(head[0]===31&&head[1]===139 ? stream.pipeThrough(new DecompressionStream('gzip')) : stream).json();
    if(data.interval!=='1m' || data.market!=='perpetual' || data.symbol!==state.symbol || data.sourceId!==state.sourceId)throw Error('Minute archive identity mismatch');
    return barsFrom(data.rows,minute);
  });
}

async function latestMinutes(state) {
  const end=state.asOf;
  // Refresh the open 1m candle at most every 5s. Cached responses retain trade times.
  const key=['live',state.symbol,state.sourceId,Math.floor(end/5000)].join('/');
  return boundedPromise(minuteCache,key,28,async()=>{
    if(state.status==='live') {
      try {
        const candles=await nativeBars(state,'1m',null,end,180);
        if(candles.at(-1).time<=end && end-candles.at(-1).time<=minute+12000)return candles;
      } catch { /* A same-venue saved capture is an explicitly dated fallback. */ }
    }
    const saved=await minuteFile(state,'recent');
    return saved.filter(b=>b.time<=end).slice(-180);
  });
}

async function minuteDay(state,selected,signal) {
  const effective=Math.floor(state.asOf/minute)*minute;
  const last=new Date(effective).toISOString().slice(0,10);
  const date=selected || last;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || date<'2026-01-01' || date>last)throw Error('Minute date outside verified period');
  const start=Date.parse(date+'T00:00:00Z'),end=Math.min(start+day,effective+minute);
  const closed=end===start+day && end<=state.asOf;
  const key=[state.symbol,state.sourceId,'day',start,closed?'closed':Math.floor(state.asOf/8000)].join('/');
  async function download() {
    const rows=[];
    for(let cursor=start;cursor<end;) {
      const stop=Math.min(end,cursor+1000*minute);
      rows.push(...await nativeBars(state,'1m',cursor,Math.min(stop-1,state.asOf),(stop-cursor)/minute));
      cursor=stop;
    }
    if(rows.length!==(end-start)/minute || rows.some((b,i)=>b.time!==start+i*minute))throw Error('Incomplete minute day');
    return rows;
  }
  let candles=[];
  if(date==='2026-01-01' || date===last){
    try{
      const bundle=await minuteFile(state,date==='2026-01-01'?'start':'recent');
      candles=bundle.filter(b=>b.time>=start && b.time<end);
    }catch{}
  }
  if(!candles.length || candles[0].time!==start || candles.at(-1).time+minute<end ||
     (!closed && state.status==='live')) {
    try {candles=await boundedPromise(minuteCache,key,28,download);}
    catch(error){if(!candles.length)throw error;}
  }
  signal?.throwIfAborted();
  return {symbol:state.symbol,sourceId:state.sourceId,source:venueNames[state.sourceId],candles,interval:'1m',
    coverage:'day',dateRange:{first:'2026-01-01',last,selected:date},asOf:Math.min(state.asOf,candles.at(-1).time+minute-1)};
}

const sharePrefixContracts=new Set(['SOLUSDT/binance-usdm','SOLUSDT/bybit-linear','BGBUSDT/bitget-usdt']);

export function currentCryptoDay(state) {
  const open=Math.floor(state.asOf/day)*day;
  return rolled(state.candles.filter(bar=>bar.time>=open && bar.time<=state.asOf),day)[0];
}

// Share only a continuous same-contract sequence ending at the frozen quote.
// The current UTC day is rolled from that capture's 15m candles, never from a later daily close.
export async function shareCycleBars(state,startTime) {
  if(state?.market!=='perpetual' || !perpetualSources[state.symbol]?.includes(state.sourceId) ||
     !Number.isSafeInteger(startTime) || !Number.isSafeInteger(state.asOf) ||
     startTime>state.asOf || !state.candles?.length) return [];
  const from=Math.floor(startTime/day)*day, end=Math.floor(state.asOf/day)*day;
  const available=state.candles.filter(b=>b.time<=state.asOf);
  if(!available.length || Math.floor(available.at(-1).time/day)*day!==end) return [];
  let i=available.length-1;
  while(i>0 && available[i].time===available[i-1].time+quarter) i--;
  const observed=rolled(available.slice(i),day);
  if(!observed.length || observed.at(-1).time!==end) return [];

  const known=new Map();
  function addClosed(items) {
    for(const bar of items) if(bar.time>=from && bar.time<end)known.set(bar.time,bar);
  }
  const jobs=[bundledDays(state).then(addClosed)];
  if(end-from>350*day) {
    jobs.push(extremeData(state,'high').then(data=>{
      addClosed(barsFrom(data.windows['1d'],day).filter(b=>b.time+day-1<=data.asOf));
    }));
    if(sharePrefixContracts.has(state.symbol+'/'+state.sourceId)) jobs.push(bundledDays(state,'-share-prefix').then(addClosed));
  }
  await Promise.allSettled(jobs);
  for(const bar of observed)if(bar.time>=from)known.set(bar.time,bar);
  const result=[];
  let cursor=end;
  function takeKnown() {
    while(cursor>=from && known.has(cursor)) {
      result.push(known.get(cursor));cursor-=day;
    }
  }
  takeKnown();
  // A saved site can lag behind the live feed. Fill the most recent missing days first,
  // only caching complete immutable pages. Share a real partial range if a venue is offline.
  if(cursor>=from && globalThis.navigator?.onLine!==false) {
    const deadline=AbortSignal.timeout(5500);
    for(let page=0;page<4 && cursor>=from && !deadline.aborted;page++){
      const stop=cursor+day;
      const max=state.sourceId==='bitget-usdt'?85:400;
      let start=cursor;
      while(start>from && (stop-start)/day<max && !known.has(start-day))start-=day;
      const key=['share-days',state.symbol,state.sourceId,start,stop].join('/');
      try {
        const data=await memo(key,async()=>{
          const rows=await nativeBars(state,'1d',start,stop-1,(stop-start)/day,deadline);
          if(rows[0]?.time!==start || rows.at(-1)?.time!==stop-day)throw Error('Incomplete daily window');
          return rows;
        });
        addClosed(data);takeKnown();
      } catch {break;}
    }
  }
  return result.reverse();
}
