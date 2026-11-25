// Tencent's public index chart accepts a Beijing-time minute cursor. Each
// request includes the requested security's quote alongside actual OHLC rows.
const symbols = { csi1000: 'sh000852', csi300: 'sh000300' };
const previousDays = new Map();
export const supportsTencentIndex = marketId => !!symbols[marketId];

function endpoint(symbol, cursor, limit) {
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline');
  url.searchParams.set('param', [symbol, 'm1', cursor, limit].join(','));
  return url;
}

async function read(symbol, cursor, limit, signal) {
  const url = endpoint(symbol, cursor, limit);
  const timeout = AbortSignal.timeout(4500);
  const response = await fetch(url, { credentials: 'omit', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw Error('腾讯财经指数行情暂不可用。');
  const payload = await response.json();
  const data = payload.data?.[symbol];
  if (payload.code !== 0 || data?.qt?.[symbol]?.[2] !== symbol.slice(2)) throw Error('腾讯财经未返回对应指数。');
  return data;
}

function chinaTime(stamp) {
  if (!/^\d{12}(?:\d{2})?$/.test(stamp)) return NaN;
  return Date.parse(stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8) + 'T'
    + stamp.slice(8, 10) + ':' + stamp.slice(10, 12) + ':' + (stamp.slice(12, 14) || '00') + '+08:00') / 1000;
}

export async function tencentIndexQuote(marketId, signal) {
  const symbol = symbols[marketId];
  const data = await read(symbol, '', 2, signal);
  const row = data.qt[symbol], time = chinaTime(row[30]), price = Number(row[3]);
  if (!Number.isFinite(time) || !(price > 0)) throw Error('腾讯财经未提供可核对的指数报价和时间。');
  const positive = value => Number(value) > 0 ? Number(value) : null;
  const sourceUrl = 'https://gu.qq.com/' + symbol + '/zs';
  const lots = Number(row[36]);
  return {
    symbol: row[2], name: row[1], secid: '1.' + row[2], contract: null, price, time, asOf: time,
    tradeDate: row[30].slice(0, 4) + '-' + row[30].slice(4, 6) + '-' + row[30].slice(6, 8),
    open: positive(row[5]), high: positive(row[33]), low: positive(row[34]), previousClose: positive(row[4]),
    volume: Number.isFinite(lots) && lots >= 0 ? lots * 100 : null, quoteUrl: sourceUrl, sourceUrl,
    dataUrl: endpoint(symbol, '', 2).href, providerName: '腾讯财经',
  };
}

async function dayBars(symbol, date, quoteDate, signal) {
  const key = symbol + '/' + date;
  if (previousDays.has(key)) return previousDays.get(key);
  const stamp = date.replaceAll('-', '');
  const data = await read(symbol, stamp + '1510', 320, signal);
  const bars = [];
  for (const row of data.m1 || []) {
    if (!row[0].startsWith(stamp)) continue;
    const minute = Number(row[0].slice(8, 10)) * 60 + Number(row[0].slice(10, 12));
    // 09:30 is the auction snapshot, distinct from the 09:31 close-labelled bar.
    if (!(minute > 570 && minute <= 690 || minute > 780 && minute <= 900)) continue;
    const [open, close, high, low, lots] = row.slice(1, 6).map(Number);
    const time = chinaTime(row[0]) - 60;
    if (!Number.isFinite(time) || ![open, close, high, low, lots].every(Number.isFinite)
      || low <= 0 || high < Math.max(open, close) || low > Math.min(open, close)
      || lots < 0 || time <= (bars.at(-1)?.time || 0)) continue;
    bars.push({ time, open, high, low, close, volume: lots * 100 });
  }
  if (date < quoteDate && bars.length === 240) {
    if (previousDays.size >= 150) previousDays.delete(previousDays.keys().next().value);
    previousDays.set(key, bars);
  }
  return bars;
}

export async function tencentIndexMinutes(marketId, dates, quoteDate, signal) {
  const symbol = symbols[marketId], rows = [];
  let position = 0;
  const worker = async () => {
    while (position < dates.length) {
      const date = dates[position++];
      try { rows.push(...await dayBars(symbol, date, quoteDate, signal)); }
      catch { signal?.throwIfAborted(); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, dates.length) }, worker));
  if (!rows.length) throw Error('腾讯财经未返回该时段的指数分钟 K 线。');
  const sourceUrl = 'https://gu.qq.com/' + symbol + '/zs';
  return { bars: rows.sort((a, b) => a.time - b.time), historySource: '腾讯财经', sourceUrl, historySourceUrl: sourceUrl };
}
