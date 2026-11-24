import { isFreshBitcoinQuote } from './bitcoin-quote.js';
import { openArchiveEntry } from './local-archive.js?v=20261124';

// Both BTCUSDT markets trade on UTC boundaries, including weekends. Their candles and trades are distinct.
const symbol = 'BTCUSDT';
const products = {
  btc: {
    name: '比特币现货', source: '币安现货', archive: 'spot', archivePrefix: 'btc-spot', firstYear: 2017,
    reference: 'https://www.binance.com/zh-CN/trade/BTC_USDT?type=spot',
    api: 'https://data-api.binance.vision/api/v3/',
  },
  btcPerp: {
    name: '比特币永续', source: '币安 U 本位永续', archive: 'futures/um', archivePrefix: 'btc-perp', firstYear: 2020,
    reference: 'https://www.binance.com/zh-CN/futures/BTCUSDT',
    api: 'https://fapi.binance.com/fapi/v1/',
  },
};
const archiveBases = new Set(['1m', '5m', '1D']);
export const apiIntervals = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1H': '1h', '2H': '2h', '4H': '4h', '1D': '1d' };
const utcDate = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

// The two intraday samples per year come from the published monthly ZIPs.
// 5m uses the full month; 1m uses the 8th through the 12th. The daily samples
// include available candles through the end of October 2026.
export function bitcoinPeriods(base, marketId = 'btc') {
  const product = products[marketId];
  if (!product || !archiveBases.has(base)) return [];
  const result = [];
  for (let year = product.firstYear; year <= 2026; year++) {
    const months = base === '1D' ? [null] : year === 2017 ? [9, 12] : [3, 9];
    for (const month of months) {
      const stamp = month ? year + '-' + String(month).padStart(2, '0') : String(year);
      result.push({ key: marketId + ':' + base + ':' + stamp, year, month, stamp, symbol, marketId, local: true });
    }
  }
  return result;
}

function candle(timestamp, values, base) {
  const [open, high, low, close, volume] = values.map(Number);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 ||
      ![open, high, low, close, volume].every(Number.isFinite) || volume < 0 || low <= 0 ||
      low > Math.min(open, close) || high < Math.max(open, close)) throw Error('币安 K 线数据校验失败。');
  return { time: base === '1D' ? utcDate(timestamp) : timestamp, open, high, low, close, volume };
}

export async function loadBitcoinPeriod(base, period, { signal, marketId = period.marketId || 'btc' } = {}) {
  const product = products[marketId];
  if (!product || (period.marketId && period.marketId !== marketId)) throw Error('比特币历史档案与所选市场不符。');
  const pack = product.archivePrefix + '-' + period.year;
  const key = period.stamp + '-' + base.toLowerCase();
  const payload = await openArchiveEntry(pack, key, signal);
  const rows = await payload.json();
  signal?.throwIfAborted();
  const bars = rows.map(([time, ...values]) => candle(time, values, base));
  const tradeDate = utcDate(rows.at(-1)[0]);
  const interval = base.toLowerCase();
  const prefix = 'data/' + product.archive + '/monthly/klines/BTCUSDT/' + interval + '/BTCUSDT-' + interval + '-' + period.stamp;
  const sourceUrl = 'https://data.binance.vision/?prefix=' + prefix;
  return { bars, base, symbol, name: product.name, tradeDate, contract: null, sourceUrl, historySource: product.source + '历史档案' };
}

async function publicData(product, path, params, signal) {
  const url = new URL(path, product.api);
  url.search = new URLSearchParams({ symbol, ...params });
  const timeout = AbortSignal.timeout(5500);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, credentials: 'omit', cache: 'no-store',
  });
  if (!response.ok) throw Error(product.source + '行情暂时无法获取。');
  return response.json();
}

const previousDays = new Map();
export function bitcoinTradeQuote(marketId, priceValue, tradeTimeMs, sequence) {
  const product = products[marketId], price = Number(priceValue);
  if (!product || !Number.isSafeInteger(tradeTimeMs)) throw Error('币安成交时间无效。');
  const time = Math.floor(tradeTimeMs / 1000), tradeDate = utcDate(time);
  const previousDay = previousDays.get(marketId);
  const quote = {
    marketId, symbol, name: product.name, price, time, tradeTimeMs, sequence, tradeDate, asOf: time,
    previousClose: previousDay?.date === tradeDate ? previousDay.close : null,
    quoteUrl: product.reference, sourceUrl: product.reference, contract: null,
  };
  if (!isFreshBitcoinQuote(marketId, quote)) throw Error(product.source + '未返回新鲜有效的成交，已暂停模拟成交。');
  return quote;
}

export async function getBinanceQuote({ signal, marketId = 'btc' } = {}) {
  const product = products[marketId];
  const today = utcDate(Date.now() / 1000);
  if (previousDays.get(marketId)?.date !== today) {
    const endTime = Date.parse(today + 'T00:00:00Z') - 1;
    try {
      const [prior] = await publicData(product, 'klines', { interval: '1d', endTime, limit: 1 }, signal);
      const close = Number(prior?.[4]);
      if (prior?.[6] === endTime && Number.isFinite(close) && close > 0) previousDays.set(marketId, {date: today, close});
    } catch { signal?.throwIfAborted(); }
  }
  // Raw /trades IDs are comparable with the WebSocket aggregate's last underlying trade ID.
  const [trade] = await publicData(product, 'trades', {limit: 1}, signal);
  return bitcoinTradeQuote(marketId, trade?.price, trade?.time, trade?.id);
}

export function liveBitcoinCandle(marketId, base, row, asOfMs, lastTradeId = null) {
  if (!products[marketId] || !apiIntervals[base]) throw Error('币安行情市场或周期无效。');
  return {marketId, base, bar: candle(row[0] / 1000, row.slice(1, 6), base), asOfMs, lastTradeId};
}

const dayMs = 86_400_000;
const pageSize = 1000;
// Cache only completed exchange time windows. Bound both markets' total cache
// to 96,000 candles, enough to revisit two 20-day one-minute training charts.
const closedPages = new Map();

function barSeconds(bar) {
  return typeof bar.time === 'number' ? bar.time : Date.parse(bar.time + 'T00:00:00Z') / 1000;
}

async function klinePage(product, base, intervalMs, params, signal) {
  const rows = await publicData(product, 'klines', { interval: apiIntervals[base], ...params }, signal);
  if (!Array.isArray(rows) || !rows.length) throw Error(product.source + '未返回 K 线。');
  let previous = -Infinity;
  return rows.map((row) => {
    const time = row[0];
    if (!Number.isSafeInteger(time) || time % intervalMs !== 0 || time <= previous ||
        time < (params.startTime ?? 0) || time > (params.endTime ?? Infinity))
      throw Error(product.source + '返回了错误周期或时间范围的 K 线。');
    previous = time;
    return candle(time / 1000, row.slice(1, 6), base);
  });
}

async function closedKlinePage(product, base, intervalMs, startTime, endTime, signal) {
  const key = [product.archivePrefix, base, startTime, endTime].join('/');
  let bars = closedPages.get(key);
  if (bars) {
    closedPages.delete(key);
  } else {
    bars = await klinePage(product, base, intervalMs, {startTime, endTime, limit: pageSize}, signal);
  }
  // Only complete immutable pages are reused. A provider gap stays visible
  // and can be repaired by a subsequent successful response from the exchange.
  if (bars.length === (endTime + 1 - startTime) / intervalMs) {
    closedPages.set(key, bars);
    if (closedPages.size > 96) closedPages.delete(closedPages.keys().next().value);
  }
  return bars;
}

async function intradayDepth(product, base, intervalMs, tradeDays, signal) {
  const now = Date.now();
  const first = Math.floor(now / dayMs) * dayMs - tradeDays * dayMs;
  // Epoch-aligned page boundaries keep historical pages reusable as the UTC
  // day rolls over. Read independent windows concurrently with a small cap.
  const span = intervalMs * pageSize;
  let tailStart = Math.max(first, Math.floor(now / span) * span);
  const windows = [];
  for (let from = first; from < tailStart;) {
    const until = (Math.floor(from / span) + 1) * span;
    windows.push([from, until - 1]);
    from = until;
  }
  const controller = new AbortController();
  const scopedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const pages = new Array(windows.length);
  let index = 0;
  async function loadPages() {
    while (index < windows.length) {
      scopedSignal.throwIfAborted();
      const at = index++;
      const [startTime, endTime] = windows[at];
      pages[at] = await closedKlinePage(product, base, intervalMs, startTime, endTime, scopedSignal);
    }
  }
  try {
    await Promise.all(Array.from({length: Math.min(4, windows.length)}, loadPages));
    // Read the newest window last so a slow history download cannot make the
    // executable mark stale. Handle crossing a page boundary during download.
    while (Date.now() >= (Math.floor(tailStart / span) + 1) * span) {
      const end = (Math.floor(tailStart / span) + 1) * span;
      pages.push(await closedKlinePage(product, base, intervalMs, tailStart, end - 1, scopedSignal));
      tailStart = end;
    }
    pages.push(await klinePage(product, base, intervalMs, {startTime: tailStart, limit: pageSize}, scopedSignal));
    // Sessions own mutable chart bars. Keep cache entries independent from edits
    // while a different account or chart interval is using the same source.
    return pages.flatMap((page) => page.map((bar) => ({...bar})));
  } finally {
    controller.abort();
  }
}

function bitcoinDepth(bars, intervalMs, requestedDays, quote) {
  const mid = Date.parse(quote.tradeDate + 'T00:00:00Z');
  const first = mid - requestedDays * dayMs;
  const counts = new Map();
  let barCount = 0;
  for (const bar of bars) {
    const time = barSeconds(bar) * 1000;
    if (time < first || time > quote.tradeTimeMs) continue;
    const date = Math.floor(time / dayMs) * dayMs;
    counts.set(date, (counts.get(date) || 0) + 1);
    barCount++;
  }
  let completeDays = 0;
  for (let day = first; day < mid; day += dayMs) {
    if (counts.get(day) === dayMs / intervalMs) completeDays++;
  }
  const todayBars = counts.get(mid) || 0;
  const expectedToday = Math.floor((quote.tradeTimeMs - mid) / intervalMs) + 1;
  return {
    requestedDays, completeDays, complete: completeDays === requestedDays && todayBars === expectedToday,
    firstDate: counts.size ? utcDate(counts.keys().next().value / 1000) : null,
    lastDate: utcDate(barSeconds(bars.at(-1))), quoteDate: quote.tradeDate, todayBars, barCount,
  };
}

export async function loadBitcoinFeed(base, { signal, limit = 720, marketId = 'btc', tradeDays = 0 } = {}) {
  const product = products[marketId];
  if (!product || !apiIntervals[base]) throw Error('币安不支持这个市场或原始周期。');
  if (!Number.isInteger(tradeDays) || tradeDays < 0 || tradeDays >= pageSize)
    throw Error('比特币行情天数无效。');
  const minutes = base.endsWith('m') ? parseInt(base) : base.endsWith('H') ? parseInt(base) * 60 : 1440;
  const bucketSeconds = minutes * 60;
  const intervalMs = bucketSeconds * 1000;
  const history = tradeDays && base !== '1D'
    ? await intradayDepth(product, base, intervalMs, tradeDays, signal)
    : await klinePage(product, base, intervalMs, {limit: Math.min(pageSize, Math.max(limit, tradeDays + 1))}, signal);
  const quote = await getBinanceQuote({ signal, marketId });
  const from = tradeDays && base !== '1D' ? Date.parse(quote.tradeDate + 'T00:00:00Z') - tradeDays * dayMs : 0;
  const bars = history.filter((bar) => {
    const time = barSeconds(bar) * 1000;
    return time >= from && time <= quote.tradeTimeMs;
  });
  const start = Math.floor(quote.time / bucketSeconds) * bucketSeconds;
  const latest = bars.at(-1);
  const latestStart = latest ? barSeconds(latest) : NaN;
  if (!Number.isFinite(latestStart) || start - latestStart > bucketSeconds || latestStart > start)
    throw Error(product.source + '的 K 线与当前成交时间不匹配。');
  if (latestStart === start) {
    bars[bars.length - 1] = { ...latest, high: Math.max(latest.high, quote.price),
      low: Math.min(latest.low, quote.price), close: quote.price };
  } else {
    bars.push({time: base === '1D' ? utcDate(start) : start, open: quote.price, high: quote.price,
      low: quote.price, close: quote.price, volume: 0});
  }
  return {
    bars, base, symbol, name: product.name, quote, asOf: quote.time, tradeDate: quote.tradeDate,
    quoteUrl: product.reference, sourceUrl: product.reference, historySource: product.source, contract: null,
    ...(tradeDays ? {depth: bitcoinDepth(bars, intervalMs, tradeDays, quote)} : {}),
  };
}
