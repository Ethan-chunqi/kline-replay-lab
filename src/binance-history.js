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
const apiIntervals = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1H': '1h', '2H': '2h', '4H': '4h', '1D': '1d' };
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
  const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw Error(product.source + '行情暂时无法获取。');
  return response.json();
}

const previousDays = new Map();
export async function getBinanceQuote({ signal, marketId = 'btc' } = {}) {
  const product = products[marketId];
  // Use the trade timestamp, rather than a rolling 24h ticker or the future
  // UTC close time returned by the exchange's trading-day statistics API.
  const [trade] = await publicData(product, 'trades', { limit: 1 }, signal);
  const price = Number(trade?.price);
  const time = Math.floor(trade?.time / 1000);
  if (!Number.isSafeInteger(time) || time <= 0 || !Number.isFinite(price) || price <= 0)
    throw Error(product.source + '未返回有效成交价和时间。');
  const tradeDate = utcDate(time);
  if (previousDays.get(marketId)?.date !== tradeDate) {
    const endTime = Date.parse(tradeDate + 'T00:00:00Z') - 1;
    try {
      const [prior] = await publicData(product, 'klines', { interval: '1d', endTime, limit: 1 }, signal);
      const close = Number(prior?.[4]);
      if (prior?.[6] === endTime && Number.isFinite(close) && close > 0) previousDays.set(marketId, { date: tradeDate, close });
    } catch { signal?.throwIfAborted(); }
  }
  const previousDay = previousDays.get(marketId);
  return {
    symbol, name: product.name, price, time, sequence: trade.id, tradeDate, asOf: time,
    previousClose: previousDay?.date === tradeDate ? previousDay.close : null,
    quoteUrl: product.reference, sourceUrl: product.reference, contract: null,
  };
}

export async function loadBitcoinFeed(base, { signal, limit = 720, marketId = 'btc' } = {}) {
  const product = products[marketId];
  const interval = apiIntervals[base];
  if (!interval) throw Error('币安不支持这个原始周期。');
  const rows = await publicData(product, 'klines', { interval, limit: Math.min(1000, limit) }, signal);
  if (!Array.isArray(rows) || !rows.length) throw Error(product.source + '未返回 K 线。');
  const quote = await getBinanceQuote({ signal, marketId });
  const bars = rows.filter((row) => row[0] <= quote.time * 1000)
    .map((row) => candle(row[0] / 1000, row.slice(1, 6), base));
  return {
    bars, base, symbol, name: product.name, quote, asOf: quote.time, tradeDate: quote.tradeDate,
    quoteUrl: product.reference, sourceUrl: product.reference, historySource: product.source, contract: null,
  };
}
