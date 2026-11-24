// Compute exposure along the training's market clock. Replay decisions use the
// recorded source-candle time; live fills use the quote's exchange timestamp.
import { MARKETS, generateBars } from './market.js?v=20261124';
import { exchangeClock, sourceInterval, tradingWindows } from './periods.js?v=20261124exposure';

const empty = () => ({flatSeconds: 0, heldSeconds: 0, totalSeconds: 0, flatPct: null});
const epoch = (time) => typeof time === 'number' ? time : Date.parse(time) / 1000;

function sessionWindows(market, date) {
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  if (weekday === 0 || weekday === 6) return [];
  const windows = tradingWindows(market, date);
  if (market.region === '港股' && (date.endsWith('-12-24') || date.endsWith('-12-31')))
    return [windows[0]];
  // US equities close at 13:00 Eastern on designated pre-holiday sessions.
  if (market.region === '美股' && date >= '1993-01-01') {
    const d = new Date(date + 'T12:00:00Z'), day = d.getUTCDate(), month = d.getUTCMonth() + 1;
    if ((month === 11 && weekday === 5 && day >= 23 && day <= 29)
      || (month === 12 && day === 24 && weekday >= 1 && weekday <= 4)
      || (month === 7 && day === 3 && weekday >= 1 && weekday <= 4))
      return [[570, 780]];
  }
  return windows;
}

function tradingClock(market, observations, startIndex, endIndex, start, end, coarse) {
  if (market.continuous) return epoch;
  const days = new Set();
  function dateAt(time) {
    if (typeof time === 'string') return time.slice(0, 10);
    // All supported exchange zones use whole-hour offsets. Round only for
    // the date lookup, so a large intraday series can reuse formatter results.
    return exchangeClock(Math.floor(time / 3600) * 3600, market).date;
  }
  days.add(dateAt(start));
  days.add(dateAt(end));
  if (coarse) {
    const lastDate = Date.parse(dateAt(end) + 'T00:00:00Z');
    for (let day = Date.parse(dateAt(start) + 'T00:00:00Z'); day <= lastDate; day += 86400000) {
      days.add(new Date(day).toISOString().slice(0, 10));
    }
  } else {
    for (let i = startIndex; i <= endIndex; i++) days.add(dateAt(observations[i].time));
  }
  let elapsed = 0;
  const schedule = new Map();
  for (const date of [...days].sort()) {
    const windows = sessionWindows(market, date);
    schedule.set(date, {offset: elapsed, windows});
    elapsed += windows.reduce((sum, [a, b]) => sum + (b - a) * 60, 0);
  }
  return (time) => {
    const session = schedule.get(dateAt(time));
    if (!session) return NaN;
    // A date-only source candle and its matching-engine fills are observed
    // together at the close of that dated trading session.
    const second = typeof time === 'string' ? Infinity
      : exchangeClock(time, market).minute * 60 + (time % 60);
    return session.windows.reduce((offset, [a, b]) =>
      offset + Math.max(0, Math.min(second, b * 60) - a * 60), session.offset);
  };
}

export function exposureTime(session, sourceBars) {
  const account = session?.account;
  const profile = MARKETS.find((m) => m.id === session?.marketId);
  if (!account || !profile) return empty();
  const market = account.contract && profile.region === 'A股' ? {...profile, exchange: 'CFFEX'} : profile;
  // The live chart's base candles can be replaced when changing intervals.
  // The original exchange timestamps of account marks survive those changes.
  let observations = session.live ? account.equityCurve : sourceBars || session.customBars;
  let startIndex = session.live ? 0 : session.start;
  let endIndex = session.live ? (observations?.length || 0) - 1 : session.cursor;
  if (!observations?.length && account.equityCurve?.length) {
    observations = account.equityCurve;
    startIndex = 0;
    endIndex = observations.length - 1;
  }
  if (!observations?.length && !session.live && session.base !== 'CSV') {
    observations = generateBars(market.id, session.seed, 720, session.base);
  }
  const start = observations?.[startIndex]?.time;
  const end = session.live ? account.lastTime : observations?.[endIndex]?.time;
  if (start == null || end == null || endIndex < startIndex || !(epoch(end) > epoch(start))) return empty();
  // A weekly/monthly equity CSV describes whole calendar spans but cannot
  // establish the exchange holidays inside them. Identify this approximation.
  const coarse = !market.continuous && !session.live
    && ['1W', '1M', '1Q', '1Y'].includes(sourceInterval(session.base, session.customBars || observations));
  const clock = tradingClock(market, observations, startIndex, endIndex, start, end, coarse);
  const first = clock(start), last = clock(end), totalSeconds = last - first;
  if (!(totalSeconds > 0)) return empty();

  let previous = first, qty = 0, flatSeconds = 0;
  const until = epoch(end);
  for (const fill of account.fills || []) {
    if (!(fill.qty > 0) || !['buy', 'sell'].includes(fill.side) || epoch(fill.time) > until) continue;
    const t = Math.max(first, Math.min(last, clock(fill.time)));
    if (!Number.isFinite(t)) continue;
    if (qty === 0) flatSeconds += Math.max(0, t - previous);
    const units = profile.quantityDecimals ? Math.round(fill.qty * 10 ** profile.quantityDecimals) : fill.qty;
    const nextQty = qty + (fill.side === 'buy' ? units : -units);
    const noise = Math.max(Math.abs(qty), units) * Number.EPSILON * 8;
    qty = Math.abs(nextQty) <= noise ? 0 : nextQty;
    previous = Math.max(t, previous);
  }
  if (qty === 0) flatSeconds += last - previous;
  return {
    flatSeconds, heldSeconds: totalSeconds - flatSeconds, totalSeconds,
    flatPct: flatSeconds / totalSeconds * 100,
    ...(coarse ? {estimatedCalendar: true} : {}),
  };
}
