// Exchange-specific USDT perpetual all-time highs and subsequent lows.
// Bars use [open, nextOpen), while an anchor's asOf includes its last millisecond.
const MIN = 60_000;
const QUARTER = 15 * MIN;
const DAY = 24 * 60 * MIN;
const symbols = new Set(['BTCUSDT', 'BNBUSDT', 'HYPEUSDT', 'SOLUSDT', 'ZECUSDT']);
const venues = {
  'binance-usdm': ['https://fapi.binance.com'],
  'bybit-linear': ['https://api.bybit.com', 'https://api.bytick.com'],
};

async function json(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error('历史行情暂时无法读取');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromVenue(id, path, read) {
  for (const base of venues[id]) {
    try {
      return read(await json(base + path));
    } catch { /* Try another public hostname for the same contract. */ }
  }
  throw new Error('交易所历史数据暂不可用');
}

function point(price, time, precisionMs) {
  return { price, time, precisionMs };
}

function contiguous(bars, start, end, width) {
  if (bars.length !== (end - start) / width || bars.some((b, i) =>
    b.time !== start + i * width || ![b.high, b.low, b.close].every(Number.isFinite) ||
    b.low <= 0 || b.low > b.close || b.close > b.high)) {
    throw new Error('历史 K 线尚未补齐');
  }
  return bars;
}

function extreme(bars, key) {
  let found;
  for (const b of bars) if (!found || (key === 'high' ? b.high > found.high : b.low < found.low)) found = b;
  return found;
}

function validBase(s) {
  return s && Number.isSafeInteger(s.asOf) && (s.asOf + 1) % QUARTER === 0 &&
    [s.high, s.low].every(p => p && Number.isFinite(p.price) && p.price > 0 &&
      Number.isSafeInteger(p.time) && p.time <= s.asOf && p.precisionMs > 0) &&
    s.low.price <= s.high.price && s.low.time >= s.high.time;
}

async function requestBars(contract, width, start, end, asOf) {
  const { sourceId: id, symbol } = contract;
  const until = Math.min(end - 1, asOf);
  const size = (end - start) / width;
  const query = id === 'binance-usdm'
    ? '/fapi/v1/klines?symbol=' + symbol + '&interval=' + ({ [DAY]: '1d', [QUARTER]: '15m', [MIN]: '1m' }[width]) +
      '&startTime=' + start + '&endTime=' + until + '&limit=' + size
    : '/v5/market/kline?category=linear&symbol=' + symbol + '&interval=' + ({ [DAY]: 'D', [QUARTER]: '15', [MIN]: '1' }[width]) +
      '&start=' + start + '&end=' + until + '&limit=' + size;
  return fromVenue(id, query, data => {
    let rows = data;
    if (id === 'bybit-linear') {
      if (data.retCode !== 0 || data.result.symbol !== symbol || data.result.category !== 'linear') throw Error();
      rows = data.result.list.slice().reverse();
    }
    const bars = rows.map(r => ({ time: +r[0], width, high: +r[2], low: +r[3], close: +r[4] }));
    return contiguous(bars, start, end, width);
  });
}

// A minute candle alone cannot establish whether its low came before or after
// its high. Only request trades when subsequent candles do not settle that order.
async function resolveMinute(contract, bar, asOf, afterLow) {
  const { sourceId: id, symbol } = contract;
  const stop = Math.min(bar.time + MIN - 1, asOf);
  let trades;
  if (id === 'binance-usdm') {
    const prefix = '/fapi/v1/aggTrades?symbol=' + symbol + '&limit=1000&';
    let page = await fromVenue(id, prefix + 'startTime=' + bar.time + '&endTime=' + stop, r => r);
    trades = page.slice();
    while (page.length === 1000 && +page.at(-1).T <= stop) {
      const next = +page.at(-1).a + 1;
      page = await fromVenue(id, prefix + 'fromId=' + next, r => r);
      if (page[0] && +page[0].a !== next) throw new Error('历史成交不连续');
      trades.push(...page);
    }
    trades = trades.map(r => ({ time: +r.T, price: +r.p }));
  } else {
    const rows = await fromVenue(id, '/v5/market/recent-trade?category=linear&symbol=' + symbol + '&limit=1000', r => {
      if (r.retCode !== 0 || r.result.category !== 'linear') throw Error();
      return r.result.list.slice().reverse();
    });
    if (!rows.length || +rows[0].time >= bar.time || +rows.at(-1).time < stop - 2000) throw new Error('该分钟的成交顺序尚待核实');
    trades = rows.filter(r => r.symbol === symbol).map(r => ({ time: +r.time, price: +r.price }));
  }
  trades = trades.filter(r => r.time >= bar.time && r.time <= stop);
  if (!trades.length || trades.reduce((max, r) => Math.max(max, r.price), 0) !== bar.high) throw new Error('该分钟的高点成交尚待核实');
  const i = trades.findIndex(r => r.price === bar.high);
  const peak = trades[i];
  let trough = peak;
  for (const t of trades.slice(i + 1)) if (t.price < trough.price) trough = t;
  const low = afterLow && afterLow.price < trough.price ? afterLow : point(trough.price, trough.time, 1);
  return { high: point(peak.price, peak.time, 1), low };
}

export function createCycleTracker(onUpdate) {
  const barsCache = new Map();
  const bases = new Map();
  const anchorFiles = new Map();
  let latest;
  let lastResult;
  let dirty = false;
  let generation = 0;
  let runningGeneration = null;
  let disposed = false;
  let retryAfter = 0;
  let retryTimer;

  // Cache only closed bars. Slice requests at provider limits and on cache hits.
  async function range(contract, width, start, end, asOf) {
    const key = contract.symbol + '/' + contract.sourceId + '/' + width;
    if (!barsCache.has(key)) barsCache.set(key, new Map());
    const cache = barsCache.get(key);
    const out = [];
    let t = start;
    while (t < end) {
      if (cache.has(t)) {
        out.push(cache.get(t));
        t += width;
        continue;
      }
      let stop = t + width;
      while (stop < end && (stop - t) / width < 1000 && !cache.has(stop)) stop += width;
      const rows = await requestBars(contract, width, t, stop, asOf);
      for (const b of rows) if (b.time + width - 1 <= asOf) cache.set(b.time, b);
      out.push(...rows);
      t = stop;
    }
    return out;
  }

  async function bridge(contract, start, end, asOf) {
    if (start >= end) return [];
    const firstDay = Math.min(end, Math.ceil(start / DAY) * DAY);
    const lastDay = Math.max(firstDay, Math.floor(end / DAY) * DAY);
    return [
      ...await range(contract, QUARTER, start, firstDay, asOf),
      ...await range(contract, DAY, firstDay, lastDay, asOf),
      ...await range(contract, QUARTER, lastDay, end, asOf),
    ];
  }

  async function refinedPoint(contract, bar, key, asOf) {
    if (bar.width <= QUARTER) return point(bar[key], bar.time, bar.width);
    const bars = await range(contract, QUARTER, bar.time, bar.time + DAY, asOf);
    const found = extreme(bars, key);
    if (found[key] !== bar[key]) throw new Error('日线与分时极值尚未对齐');
    return point(found[key], found.time, QUARTER);
  }

  async function orderPeak(contract, bar, afterLow, asOf) {
    if (afterLow && afterLow.price <= bar.low) {
      return { high: await refinedPoint(contract, bar, 'high', asOf), low: afterLow };
    }
    if (bar.high === bar.low) {
      const high = point(bar.high, bar.time, bar.width);
      return { high, low: high };
    }
    if (bar.width === MIN) return resolveMinute(contract, bar, asOf, afterLow);
    const width = bar.width === DAY ? QUARTER : MIN;
    const end = Math.min(bar.time + bar.width, (Math.floor(asOf / width) + 1) * width);
    const children = await range(contract, width, bar.time, end, asOf);
    const peak = extreme(children, 'high');
    if (!peak || peak.high !== bar.high) throw new Error('新高所在 K 线尚待核实');
    const trough = extreme(children.filter(b => b.time > peak.time), 'low');
    if (trough && (!afterLow || trough.low <= afterLow.price)) afterLow = point(trough.low, trough.time, width);
    return orderPeak(contract, peak, afterLow, asOf);
  }

  async function apply(contract, base, bars, asOf) {
    if (!bars.length) return base;
    const peak = extreme(bars, 'high');
    let high = base.high;
    let low = base.low;
    if (peak.high > high.price) {
      const trough = extreme(bars.filter(b => b.time > peak.time), 'low');
      const after = trough ? await refinedPoint(contract, trough, 'low', asOf) : null;
      ({ high, low } = await orderPeak(contract, peak, after, asOf));
    } else {
      const trough = extreme(bars, 'low');
      if (trough.low < low.price) low = await refinedPoint(contract, trough, 'low', asOf);
    }
    return { high, low, asOf };
  }

  async function calculate(state) {
    const { sourceId, symbol, market, candles, asOf } = state;
    if (!symbols.has(symbol) || !venues[sourceId] || market !== 'perpetual') throw new Error('合约标识不符');
    const contract = { sourceId, symbol };
    if (!anchorFiles.has(symbol)) {
      const url = new URL(symbol === 'BTCUSDT' ? './anchors.json' : './history/' + symbol + '.json', import.meta.url);
      const read = json(url).then(data => {
        if (data.symbol !== symbol || data.market !== market) throw new Error('历史基线品种不符');
        return data.sources;
      }).catch(error => { anchorFiles.delete(symbol); throw error; });
      anchorFiles.set(symbol, read);
    }
    const anchor = (await anchorFiles.get(symbol))?.[sourceId];
    if (!validBase(anchor) || !Number.isSafeInteger(asOf) || asOf < anchor.asOf) throw new Error('行情时间与历史基线尚未对齐');
    const cacheKey = 'perpetual-cycle-v3/' + symbol + '/' + sourceId + '/' + anchor.asOf;
    if (!bases.has(cacheKey)) {
      let saved;
      try { saved = JSON.parse(localStorage.getItem(cacheKey)); } catch { /* Storage is optional. */ }
      bases.set(cacheKey, validBase(saved) && saved.asOf > anchor.asOf ? saved : anchor);
    }
    let base = bases.get(cacheKey);
    if (base.asOf > asOf) base = anchor;
    const start = base.asOf + 1;
    const last = candles.at(-1);
    if (!last || last.time > asOf || last.time + QUARTER < asOf - 12_000) throw new Error('行情最后一根 K 线尚未对齐');
    const tail = candles.filter(b => b.time >= start).map(b => ({ ...b, width: QUARTER }));
    if (!tail.length) return { ...base, asOf };
    contiguous(tail, tail[0].time, last.time + QUARTER, QUARTER);
    const gap = await bridge(contract, start, tail[0].time, asOf);
    const all = gap.concat(tail);
    const current = last.time + QUARTER - 1 > asOf;
    const closed = current ? all.slice(0, -1) : all;
    if (closed.length) {
      const until = closed.at(-1).time + closed.at(-1).width - 1;
      try {
        base = await apply(contract, base, closed, until);
      } catch (error) {
        // A newer, lower price may disambiguate the order of the prior minute.
        if (current) return apply(contract, base, all, asOf);
        throw error;
      }
      if (base.asOf >= bases.get(cacheKey).asOf) {
        bases.set(cacheKey, base);
        try { localStorage.setItem(cacheKey, JSON.stringify(base)); } catch { /* In-memory progress still works. */ }
      }
    }
    return current ? apply(contract, base, tail.slice(-1), asOf) : base;
  }

  function emit(value) {
    if (disposed) return;
    lastResult = value;
    onUpdate(value);
  }

  async function pump() {
    if (runningGeneration === generation || disposed || Date.now() < retryAfter) return;
    const version = generation;
    runningGeneration = version;
    try {
      while (version === generation && dirty && !disposed) {
        dirty = false;
        const state = latest;
        if (!state?.candles?.length) continue;
        try {
          const result = await calculate(state);
          if (version === generation && !disposed) {
            emit({ ...result, symbol: state.symbol, sourceId: state.sourceId, status: 'ready', error: '' });
          }
        } catch (e) {
          if (version !== generation || disposed) continue;
          emit({ symbol: state.symbol, sourceId: state.sourceId, status: 'unavailable', high: null, low: null, asOf: state.asOf,
            error: e?.message ?? '历史范围待核实' });
          retryAfter = Date.now() + 15_000;
          dirty = true;
          clearTimeout(retryTimer);
          retryTimer = setTimeout(pump, 15_010);
          break;
        }
      }
    } finally { if (version === generation) runningGeneration = null; }
  }

  return {
    update(state) {
      if (disposed) return;
      if (latest?.sourceId !== state?.sourceId || latest?.symbol !== state?.symbol || !lastResult) {
        generation++;
        retryAfter = 0;
        clearTimeout(retryTimer);
        emit({ symbol: state?.symbol ?? '', sourceId: state?.sourceId ?? '', status: 'loading', high: null, low: null, asOf: null, error: '' });
      }
      latest = state;
      dirty = true;
      void pump();
    },
    destroy() { disposed = true; clearTimeout(retryTimer); },
  };
}
