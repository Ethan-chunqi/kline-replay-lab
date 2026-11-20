// A verified closing print anchors one generated scenario. No other OHLC or volume is sourced history.
import { generateBars, MARKETS } from './market.js';
import { futuresTerms } from './eastmoney.js';

const DAY = 86400000;
const quoteUrl = (secid) => 'https://quote.eastmoney.com/q/' + secid + '.html';
const dateOf = (day) => new Date(day).toISOString().slice(0, 10);
const calendars = {
  A股: [
    [570, 690],
    [780, 900],
  ],
  港股: [
    [570, 720],
    [780, 960],
  ],
  美股: [[570, 960]],
};
const formatters = new Map();
function utcOffset(day, timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' });
    formatters.set(timeZone, formatter);
  }
  const short = formatter.formatToParts(day + DAY / 2).find((p) => p.type === 'timeZoneName').value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(short);
  return match ? (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === '+' ? 1 : -1) : 0;
}
function closeQuote(marketId, symbol, name, secid, price, tradeDate) {
  const market = MARKETS.find((m) => m.id === marketId);
  const day = Date.parse(tradeDate + 'T00:00:00Z');
  const close = calendars[market.region].at(-1)[1];
  const time = day / 1000 + (close - utcOffset(day, market.timeZone)) * 60;
  return {
    name,
    symbol,
    secid,
    price,
    time,
    tradeDate,
    quoteUrl: quoteUrl(secid),
    timeMeaning: 'scheduled-close',
    sourceKind: 'verified-close',
  };
}

const closes = [
  ['csi1000', '000852', '中证1000', '1.000852', 5648.63, '2026-11-20', 'IM2612', 5545.6],
  ['csi500', '000905', '中证500', '1.000905', 6006.08, '2026-11-20', 'IC2612', 5902],
  ['csi300', '000300', '沪深300', '1.000300', 3954.57, '2026-11-20', 'IF2612', 3869],
  ['hsi', 'HSI', '恒生指数', '100.HSI', 22410.8, '2026-11-20'],
  ['ndx', 'NDX100', '纳斯达克100', '100.NDX100', 26517.05, '2026-11-19'],
  ['spx', 'SPX', '标普500', '100.SPX', 7175.83, '2026-11-19'],
];
export const SNAPSHOT_QUOTES = Object.freeze(
  Object.fromEntries(
    closes.map(([id, symbol, name, secid, price, day, future, settledClose]) => {
      const q = closeQuote(id, symbol, name, secid, price, day);
      if (future)
        q.future = Object.freeze(
          closeQuote(id, future, name + '股指期货 ' + future, '220.' + future, settledClose, day),
        );
      return [id, Object.freeze(q)];
    }),
  ),
);

// This is a weekday simulation clock, not an official exchange holiday calendar.
// Known US Thanksgiving / Christmas closures and reduced sessions near the verified close are observed.
const usClosed = new Set(['2026-11-26', '2026-12-25']);
const usShort = new Set(['2026-11-27', '2026-12-24']);
const hkClosed = new Set(['2026-12-25']);
function openDay(day, region) {
  const weekday = new Date(day).getUTCDay();
  const date = dateOf(day);
  return (
    weekday !== 0 &&
    weekday !== 6 &&
    !(region === '美股' && usClosed.has(date)) &&
    !(region === '港股' && hkClosed.has(date))
  );
}
function nextDay(day, region, step) {
  do {
    day += step * DAY;
  } while (!openDay(day, region));
  return day;
}
function barMinutes(base) {
  if (String(base).toUpperCase() === '1D') return 0;
  const match = /^(\d+)(m|h)$/i.exec(base);
  if (!match) throw new Error('收盘价推演不支持该 K 线周期');
  const duration = Number(match[1]) * (match[2].toLowerCase() === 'h' ? 60 : 1);
  if (![1, 3, 5, 10, 15, 30, 60, 120, 240].includes(duration)) throw new Error('收盘价推演不支持该 K 线周期');
  return duration;
}
function clockFor(market, period, quote, startIndex) {
  const regular = calendars[market.region];
  // Generate legal opening slots separately inside each regular session.
  const slotsFor = (day) => {
    if (!period) return [0];
    const spans = market.region === '美股' && usShort.has(dateOf(day)) ? [[570, 780]] : regular;
    const slots = [];
    for (const [open, close] of spans) {
      for (let m = open; m < close; m += period) slots.push(m);
    }
    return slots;
  };
  let day = Date.parse(quote.tradeDate + 'T00:00:00Z');
  let slots = slotsFor(day),
    slot = slots.length - 1;
  for (let count = 0; count < startIndex; count++) {
    if (--slot < 0) {
      day = nextDay(day, market.region, -1);
      slots = slotsFor(day);
      slot = slots.length - 1;
    }
  }
  let offset = utcOffset(day, market.timeZone);
  return () => {
    const date = dateOf(day);
    const time = period ? day / 1000 + (slots[slot] - offset) * 60 : date;
    if (++slot >= slots.length) {
      day = nextDay(day, market.region, 1);
      slots = slotsFor(day);
      offset = utcOffset(day, market.timeZone);
      slot = 0;
    }
    return { date, time };
  };
}

export function anchoredScenario(marketId, { base = '5m', kind = 'future', seed = 10, deep = false } = {}) {
  const market = MARKETS.find((m) => m.id === marketId);
  const snapshot = SNAPSHOT_QUOTES[marketId];
  if (!market || !snapshot) throw new Error('该市场没有已核实的收盘价');
  if (kind !== 'future' && kind !== 'index') throw new Error('请选择指数或期货收盘价');
  const future = kind === 'future' && snapshot.future;
  const { future: unused, ...indexQuote } = snapshot;
  const quote = { ...(future || indexQuote) };
  const contract = future ? futuresTerms(marketId, quote.symbol) : null;
  const period = barMinutes(base);
  const startIndex = deep ? 1199 : 119;
  const source = generateBars(marketId, seed, deep ? 4800 : 720, base);
  const ratio = quote.price / source[startIndex].close;
  const scale = contract ? 1 / contract.tickSize : 10 ** market.precision;
  const price = (value) => Math.max(1, Math.round(value * ratio * scale)) / scale;
  const next = clockFor(market, period, quote, startIndex);
  const bars = [];
  for (const row of source) {
    const { date, time } = next();
    // All three dated December 2026 stock index contracts expire on the third Friday.
    if (contract && date > '2026-12-18') break;
    bars.push({
      time,
      open: price(row.open),
      high: price(row.high),
      low: price(row.low),
      close: price(row.close),
      volume: row.volume,
    });
  }
  return {
    bars,
    startIndex,
    quote,
    name: quote.name,
    symbol: quote.symbol,
    quoteUrl: quote.quoteUrl,
    contract,
    tradeDate: quote.tradeDate,
    asOf: quote.time,
    sourceKind: 'anchored-simulation',
    calendar: 'simulated-weekdays',
  };
}
