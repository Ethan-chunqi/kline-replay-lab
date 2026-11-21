// Native USDT perpetual klines and exact, gap-checked aggregation of the live 15m feed.
export const intervalMs = { '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '1d': 86_400_000 };
const day = intervalMs['1d'];
const allowed = new Set(['BTCUSDT', 'BNBUSDT', 'HYPEUSDT', 'SOLUSDT', 'ZECUSDT']);
const hosts = { 'binance-usdm': ['https://fapi.binance.com'], 'bybit-linear': ['https://api.bybit.com', 'https://api.bytick.com'] };
const cache = new Map();

function memo(key, task) {
  if (!cache.has(key)) {
    const result = task().catch(error => { cache.delete(key); throw error; });
    cache.set(key, result);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

async function json(url) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 6500);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: abort.signal });
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

async function nativeBars(state, interval, start, end, count) {
  const { symbol, sourceId } = state;
  const binance = sourceId === 'binance-usdm';
  const q = new URLSearchParams({ symbol, limit: String(count) });
  if (binance) {
    q.set('interval', interval);
    q.set('endTime', String(end));
    if (start != null) q.set('startTime', String(start));
  } else {
    q.set('category', 'linear');
    q.set('interval', { '15m':'15', '30m':'30', '1h':'60', '1d':'D' }[interval]);
    q.set('end', String(end));
    if (start != null) q.set('start', String(start));
  }
  for (const host of hosts[sourceId]) {
    try {
      const raw = await json(host + (binance ? '/fapi/v1/klines?' : '/v5/market/kline?') + q);
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

function bundledDays(state) {
  const { symbol, sourceId } = state;
  return memo('bundle/' + symbol + '/' + sourceId, async () => {
    const data = await json(new URL('./daily/' + symbol + '-' + sourceId + '.json', import.meta.url));
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

async function bundledWindow(state, interval, p, kind) {
  if (kind !== 'high' && kind !== 'low') return null;
  const { symbol,sourceId } = state;
  const key = [symbol,sourceId,kind,'extreme-window'].join('/');
  const data = await memo(key, async () => {
    const result = await json(new URL('./extreme-windows/' + symbol + '-' + sourceId + '-' + kind + '.json', import.meta.url));
    if (result.symbol !== symbol || result.sourceId !== sourceId || result.kind !== kind || result.market !== 'perpetual') throw Error('Invalid market');
    return result;
  });
  const base = interval === '1d' ? '1d' : '15m';
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
  if (state?.market !== 'perpetual' || !allowed.has(state?.symbol) || !hosts[state?.sourceId] || !Object.hasOwn(intervalMs, interval)) {
    throw new Error('Unknown perpetual contract or candle interval');
  }
  const base = { symbol: state.symbol, sourceId: state.sourceId, interval, historical: Boolean(point) };
  if (!point) {
    return { ...base, candles: interval === '1d' ? await currentDays(state) : rolled(state.candles, intervalMs[interval]) };
  }
  if ((point.symbol && point.symbol !== state.symbol) || (point.sourceId && point.sourceId !== state.sourceId) ||
      !Number.isSafeInteger(point.time) || !Number.isFinite(point.price) || (kind && kind !== 'high' && kind !== 'low')) throw new Error('Invalid anchor');
  const recent = rolled(state.candles, intervalMs[interval]);
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
