import { equityCatalog } from './catalog.js?v=20261122-market-v3';
import { koreanHours } from './korea-session.js?v=20261122-market-v3';

const catalogue = new Map(equityCatalog.map(asset => [asset.symbol, asset]));
const minutesByInterval = { '1m':1, '15m':15, '30m':30, '1h':60, '1d':1440 };
const hour = 3_600_000;
const cached = new Map();
const local = new URL('year/', import.meta.url);
const clocks = new Map();

function parts(time, zone) {
  if (!clocks.has(zone)) {
    clocks.set(zone, new Intl.DateTimeFormat('en-CA', {
      timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hourCycle:'h23',
    }));
  }
  const fields = Object.fromEntries(clocks.get(zone).formatToParts(time).map(p => [p.type, p.value]));
  return { date:fields.year+'-'+fields.month+'-'+fields.day, minute:+fields.hour*60 + +fields.minute };
}

function toCandle(row) {
  return { time:row[0]*1000, open:row[1], high:row[2], low:row[3], close:row[4], volume:row[5] };
}

function groupQuarters(rows, interval, meta) {
  const width=minutesByInterval[interval], result=[];
  let group=null, count=0;
  function commit() {
    if (group && count===width/15) result.push(group);
  }
  for (const row of rows) {
    const candle=toCandle(row), local=parts(candle.time,meta.timeZone);
    const session=meta.region==='kr' ? koreanHours(local.date)[0] : meta.region==='cn' && local.minute>=780 ? 780 : 570;
    const start=candle.time-((local.minute-session)%width)*60_000;
    if (!group || group.time!==start) {
      commit();
      group={...candle,time:start};
      count=1;
    } else {
      group.high=Math.max(group.high,candle.high);
      group.low=Math.min(group.low,candle.low);
      group.close=candle.close;
      group.volume+=candle.volume;
      count++;
    }
  }
  commit();
  return result;
}

function correctRows(rows) {
  return Array.isArray(rows) && rows.length && rows.every((r,i) =>
    Array.isArray(r) && r.length===6 && r.every(Number.isFinite) && Number.isSafeInteger(r[0]) &&
    r[3]>0 && r[3]<=Math.min(r[1],r[4]) && r[2]>=Math.max(r[1],r[4]) &&
    r[5]>=0 && (i===0 || r[0]>rows[i-1][0]));
}

async function readArchive(url, symbol, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  if (signal?.aborted) abort();
  const timer = setTimeout(abort,7000);
  try {
    const response = await fetch(url,{ signal:controller.signal, cache:'no-cache', credentials:'omit' });
    if (!response.ok) throw new Error('Equity year archive unavailable');
    const encoded = await response.arrayBuffer();
    const bytes = new Uint8Array(encoded);
    const json = bytes[0]===31 && bytes[1]===139
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json()
      : JSON.parse(new TextDecoder().decode(bytes));
    if (json?.schema!==1 || json.symbol!==symbol || json.startDate!=='2026-01-01' ||
        !Number.isFinite(json.asOf) || !correctRows(json.bars?.['1d']) ||
        (json.bars['1m'] && !correctRows(json.bars['1m'])) || !correctRows(json.bars?.['15m']) || (json.bars['1h'] && !correctRows(json.bars['1h']))) {
      throw new Error('Invalid equity year archive');
    }
    return json;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',abort);
  }
}

async function loadArchive(symbol, quoteAsOf, signal) {
  const hit = cached.get(symbol);
  if (hit && (!quoteAsOf || hit.asOf>=quoteAsOf || Date.now()-hit.checked<15*60_000)) return hit.data;
  const name = encodeURIComponent(symbol)+'.json.gz';
  const localData = hit?.data || await readArchive(new URL(name,local),symbol,signal).catch(() => null);
  signal?.throwIfAborted();
  let archive = localData;
  const configured = globalThis.EQUITY_DATA_URL;
  // The ship-ready copy works on its own. Consult a newer data-branch archive
  // only when the live quote's last session is not covered by this copy.
  if (configured && (!archive || quoteAsOf-archive.asOf>18*hour)) {
    const base = new URL(configured,local);
    if (base.protocol==='https:' || base.origin===local.origin) {
      if (!base.pathname.endsWith('/')) base.pathname += '/';
      const remote = await readArchive(new URL('year/'+name,base),symbol,signal).catch(() => null);
      signal?.throwIfAborted();
      if (remote && (!archive || remote.asOf>=archive.asOf)) archive=remote;
    }
  }
  if (!archive) throw new Error('Year archive unavailable');
  cached.set(symbol,{data:archive,asOf:archive.asOf,checked:Date.now()});
  return archive;
}

export async function loadEquityYear(state, interval, signal) {
  signal?.throwIfAborted();
  const meta = catalogue.get(state?.symbol);
  if (!meta || !Object.hasOwn(minutesByInterval,interval)) throw new RangeError('Unknown equity or interval');
  const archive = await loadArchive(meta.symbol,state.asOf,signal);
  const intraday = interval!=='1d';
  const provider = interval==='1m' ? 'minute' : interval==='1h' ? 'hour' : 'intraday';
  const sourceId = intraday ? (archive[provider+'SourceId'] || archive.intradaySourceId || archive.sourceId) : archive.sourceId;
  const source = intraday ? (archive[provider+'Source'] || archive.intradaySource || archive.source) : archive.source;
  const raw = archive.bars[interval];
  if (interval==='1m' && !raw) throw new Error('One-minute history unavailable');
  let candles = raw ? raw.map(toCandle) : groupQuarters(archive.bars['15m'],interval,meta);
  let coverage = archive.coverage[interval];
  let reason = coverage==='partial' ? 'partial-history' : '';
  // Update only with overlapping bars with the exact same venue, price basis
  // and interval, to avoid bridging missing exchange sessions or timestamps.
  const current = state.sourceId===sourceId && state.interval===interval && Array.isArray(state.candles)
    ? state.candles.filter(r=>Number.isFinite(r.time)&&Number.isFinite(r.close)&&r.close>0) : [];
  const last = candles.at(-1)?.time;
  if (current.length && current[0].time<=last && current.at(-1).time>=last) {
    const overlap = current.find(r=>r.time===last);
    if (overlap && Math.abs(overlap.close-candles.at(-1).close)<=Math.max(.02,overlap.close*.015)) {
      const merged = new Map(candles.map(r=>[r.time,r]));
      for (const b of current) if (b.time>=last) merged.set(b.time,b);
      candles = [...merged.values()].sort((a,b)=>a.time-b.time);
    }
  }
  const lastDate = parts(candles.at(-1).time,meta.timeZone).date;
  if (state.asOf && lastDate<parts(state.asOf,meta.timeZone).date) {
    coverage = 'partial';
    reason = 'archive-behind-latest-session';
  }
  signal?.throwIfAborted();
  return { symbol:meta.symbol, interval, sourceId, source, candles, coverage, reason,
    earliestAvailable:candles[0].time, latestAvailable:candles.at(-1).time,
    asOf:Math.max(archive.asOf,candles.at(-1).time), startDate:archive.startDate };
}
