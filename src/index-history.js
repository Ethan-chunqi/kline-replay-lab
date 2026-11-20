// Fetch the actual index on demand. These providers use different codes for the
// Nasdaq-100 (.NDX) and Nasdaq Composite (.IXIC). Only the former is requested.
import { loadPublicRows, parseRows } from './secondary-history.js';

const markets = {
  csi1000: { symbol: '000852', sourceSymbol: 'sh000852' },
  csi500: { symbol: '000905', sourceSymbol: 'sh000905' },
  csi300: { symbol: '000300', sourceSymbol: 'sh000300' },
  ndx: { symbol: 'NDX', sourceSymbol: '.NDX' },
};
const intraday = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1H': 60 };
const jsonp = '/var%20wavelabCffexRows=/';

const nyZone = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  timeZoneName: 'shortOffset',
});
const offsets = new Map();

function nyBar(stamp, minutes) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):00$/.exec(stamp);
  if (!match) throw new Error('纳指分钟 K 线时间无效');
  const date = match[1],
    day = Date.parse(date + 'T00:00:00Z');
  const minute = Number(match[2]) * 60 + Number(match[3]);
  if (
    !Number.isFinite(day) ||
    new Date(day).toISOString().slice(0, 10) !== date ||
    minute <= 570 ||
    minute > 960 ||
    ((minute - 570) % minutes !== 0 && minute !== 780 && minute !== 960)
  )
    throw new Error('纳指分钟 K 线交易时段无效');
  if (!offsets.has(date)) {
    const zone = nyZone.formatToParts(day + 43200000).find((part) => part.type === 'timeZoneName').value;
    const offset = /^GMT(-[45])$/.exec(zone);
    if (!offset) throw new Error('美东交易时区无效');
    offsets.set(date, Number(offset[1]) * 60);
  }
  const midnight = day / 1000 - offsets.get(date) * 60;
  // At 16:00 the last 60-minute candle spans only 15:30–16:00.
  const start = 570 + Math.floor((minute - 571) / minutes) * minutes;
  return { start: midnight + start * 60, end: midnight + minute * 60 };
}

export async function fetchIndexHistory(marketId, base, { signal } = {}) {
  const market = markets[marketId];
  const us = marketId === 'ndx';
  const daily = base === '1D';
  const minutes = daily ? 0 : intraday[base];
  if (!market || (!daily && (!Number.isInteger(minutes) || (!us && minutes === 1))))
    throw new Error('新浪备用源不提供该指数的此周期');
  const endpoint = us
    ? new URL(
        '/usstock/api/jsonp_v2.php' + jsonp + 'US_MinKService.' + (daily ? 'getDailyK' : 'getMinK'),
        'https://stock.finance.sina.com.cn',
      )
    : new URL(
        '/quotes_service/api/jsonp_v2.php' + jsonp + 'CN_MarketData.getKLineData',
        'https://money.finance.sina.com.cn',
      );
  endpoint.searchParams.set('symbol', market.sourceSymbol);
  if (us && !daily) {
    endpoint.searchParams.set('type', String(minutes));
    endpoint.searchParams.set('___qn', '3');
  } else if (!us) {
    endpoint.searchParams.set('scale', String(daily ? 240 : minutes));
    endpoint.searchParams.set('ma', 'no');
    endpoint.searchParams.set('datalen', '1023');
  }
  const raw = await loadPublicRows(endpoint.href, signal);
  const rows = us
    ? raw
    : raw.map((row) => ({ d: row.day, o: row.open, h: row.high, l: row.low, c: row.close, v: row.volume }));
  const bars = parseRows(rows, minutes, us && !daily ? (stamp, n) => nyBar(stamp, n).start : undefined);
  if (us && !daily) {
    bars.forEach((bar, i) => {
      bar.endTime = nyBar(rows[i].d, minutes).end;
    });
  }
  const last = bars.at(-1);
  const sourceUrl = us
    ? 'https://stock.finance.sina.com.cn/usstock/quotes/.NDX.html'
    : 'https://finance.sina.com.cn/realstock/company/' + market.sourceSymbol + '/nc.shtml';
  // Daily rows carry only the exchange date. Keep that precision explicit, without guessing a quote time.
  const asOf = daily
    ? Date.parse(last.time + 'T00:00:00Z') / 1000
    : (last.endTime ?? last.time + minutes * 60);
  return {
    bars,
    base,
    symbol: market.symbol,
    sourceSymbol: market.sourceSymbol,
    historySource: '新浪财经',
    sourceUrl,
    historySourceUrl: sourceUrl,
    dataUrl: endpoint.href,
    asOf,
    asOfPrecision: daily ? 'date' : 'minute',
    ...(daily ? { tradeDate: last.time } : {}),
  };
}
