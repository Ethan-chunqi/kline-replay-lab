// Quote samples drive execution. Source candles and day-to-date extremes are display data only.
import { advanceBar } from './engine.js';
import { MARKETS } from './market.js';

const clocks = new Map();
const sessions = {
  'Asia/Shanghai': [
    [570, 690],
    [780, 900],
  ],
  'Asia/Hong_Kong': [
    [570, 720],
    [780, 960],
  ],
  'America/New_York': [[570, 960]],
};
const point = (time, price) => ({ time, open: price, high: price, low: price, close: price, volume: 0 });
const unix = (value) => (typeof value === 'number' ? value : Date.parse(value) / 1000);
const finitePrice = (value) => Number.isFinite(value) && value > 0;
const hasVolume = (q) => Number.isFinite(q?.volume) && q.volume >= 0;

export function markFromQuote(quote) {
  if (!Number.isSafeInteger(quote?.time) || quote.time <= 0 || !finitePrice(quote.price)) {
    throw new Error('实时报价缺少有效的成交价或交易所时间');
  }
  return point(quote.time, quote.price);
}

function nextEngineTime(account, exchangeTime) {
  if (account.lastTime == null) return exchangeTime;
  const previous = unix(account.lastTime);
  if (previous < exchangeTime) return exchangeTime;
  if (Math.floor(previous) > exchangeTime) return null;
  // Keep the source second intact. The fraction orders multiple verified updates inside that second.
  const serial = Math.round((previous - exchangeTime) * 10000) + 1;
  return serial < 10000 ? exchangeTime + serial / 10000 : null;
}

export function startLiveMark(account, quote) {
  const bar = markFromQuote(quote);
  if (
    account.lastTime != null &&
    Math.floor(unix(account.lastTime)) === quote.time &&
    account.lastPrice === quote.price
  )
    return point(account.lastTime, account.lastPrice);
  const time = nextEngineTime(account, quote.time);
  if (time === null) throw new Error('实时报价早于账户进度');
  bar.time = time;
  advanceBar(account, bar);
  return bar;
}

export function tradingBar(session, fallback) {
  const account = session?.account;
  return session?.liveQuote && account?.lastTime != null && finitePrice(account.lastPrice)
    ? point(account.lastTime, account.lastPrice)
    : fallback;
}

function localClock(time, zone) {
  if (!clocks.has(zone)) {
    clocks.set(
      zone,
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  const parts = Object.fromEntries(
    clocks
      .get(zone)
      .formatToParts(time * 1000)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: parts.year + '-' + parts.month + '-' + parts.day,
    second: +parts.hour * 3600 + +parts.minute * 60 + +parts.second,
  };
}

function marketClock(session, quote) {
  const market = MARKETS.find((m) => m.id === session.marketId);
  const zone = session.timeZone || session.market?.timeZone || market?.timeZone || 'Asia/Shanghai';
  const clock = localClock(quote.time, zone);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(quote.tradeDate || '') ? quote.tradeDate : clock.day;
  return { ...clock, date, windows: sessions[zone] || [[0, 1440]] };
}

function sourcePeriod(session) {
  const base = String(session.base);
  if (base.toUpperCase() === '1D') return 0;
  const match = /^(\d+)([mh])$/i.exec(base);
  if (!match || !Number(match[1])) throw new Error('实时图表周期无效');
  return Number(match[1]) * (match[2].toLowerCase() === 'h' ? 3600 : 60);
}

function bucketAt(time, clock, duration) {
  if (clock.day !== clock.date) return null;
  const weekday = new Date(clock.day + 'T00:00:00Z').getUTCDay();
  if (weekday === 0 || weekday === 6) return null;
  const localMidnight = time - clock.second;
  let previous = null;
  for (const [open, close] of clock.windows) {
    const start = open * 60,
      end = close * 60;
    if (clock.second < start) break;
    if (clock.second < end) {
      return {
        time: localMidnight + start + Math.floor((clock.second - start) / duration) * duration,
        append: true,
      };
    }
    const last = start + Math.floor((end - start - 1) / duration) * duration;
    previous = { time: localMidnight + last, append: clock.second === end };
  }
  // A source can publish its closing price during lunch or long after the closing auction.
  return previous;
}

function updateChart(session, quote, previous, clock, period) {
  const bars = session.customBars ?? (session.customBars = []);
  const tail = bars.at(-1);
  const bucket = period ? bucketAt(quote.time, clock, period) : { time: clock.date, append: true };
  if (!bucket || (tail && unix(tail.time) > unix(bucket.time))) return;
  const existing = tail?.time === bucket.time;
  if (!existing && !bucket.append) return;
  const candle = existing ? tail : point(bucket.time, quote.price);
  if (period === 0) {
    if (finitePrice(quote.open)) candle.open = quote.open;
    candle.high = Math.max(candle.high, candle.open, quote.price, finitePrice(quote.high) ? quote.high : 0);
    candle.low = Math.min(
      candle.low,
      candle.open,
      quote.price,
      finitePrice(quote.low) ? quote.low : Infinity,
    );
    if (hasVolume(quote)) candle.volume = Math.max(candle.volume || 0, quote.volume);
  } else {
    candle.high = Math.max(candle.high, quote.price);
    candle.low = Math.min(candle.low, quote.price);
    // A cumulative delta can only be attributed in full when both observations share this bucket.
    if (hasVolume(quote) && hasVolume(previous) && quote.volume >= previous.volume) {
      const priorClock = marketClock(session, previous);
      const priorBucket = bucketAt(previous.time, priorClock, period);
      if (priorBucket?.time === bucket.time)
        candle.volume = (candle.volume || 0) + quote.volume - previous.volume;
    }
  }
  candle.close = quote.price;
  if (!existing) bars.push(candle);
}

function newerInSecond(previous, next) {
  if (Number.isFinite(previous.sequence) && Number.isFinite(next.sequence))
    return next.sequence > previous.sequence;
  return hasVolume(next) && hasVolume(previous) && next.volume > previous.volume;
}

/** Mutates account, liveQuote and customBars. A full source-bar refresh can replace customBars afterward. */
export function applyLiveQuote(session, quote) {
  const current = markFromQuote(quote);
  const account = session.account;
  const previous = session.liveQuote;
  const unchanged = { changed: false, newFills: [] };
  if (previous?.symbol && quote.symbol && previous.symbol !== quote.symbol)
    throw new Error('报价合约与当前账户不一致');
  if (previous && previous.time > quote.time) return unchanged;
  const aligned =
    previous &&
    account.lastTime != null &&
    Math.floor(unix(account.lastTime)) === previous.time &&
    account.lastPrice === previous.price;
  const consumed = previous && (session.liveAppliedTime === previous.time || aligned);
  if (consumed && previous.time === quote.time && !newerInSecond(previous, quote)) return unchanged;
  const time = nextEngineTime(account, quote.time);
  if (time === null) return unchanged;
  const period = sourcePeriod(session);
  const clock = marketClock(session, quote);
  const withinSession =
    clock.day === clock.date &&
    clock.windows.some(([open, close]) => clock.second >= open * 60 && clock.second <= close * 60);
  const start = account.fills.length;
  // Repeated off-session settlement messages at the same price do not execute pending orders.
  const offSessionRepeat =
    consumed &&
    !withinSession &&
    marketClock(session, previous).date === clock.date &&
    previous.price === quote.price &&
    previous.volume === quote.volume;
  if (!offSessionRepeat) {
    current.time = time;
    if (consumed && account.lastTime != null) {
      current.open = account.lastPrice;
      current.high = Math.max(current.open, current.close);
      current.low = Math.min(current.open, current.close);
    }
    advanceBar(account, current);
  }
  updateChart(session, quote, previous, clock, period);
  session.liveQuote = { ...quote };
  session.liveAppliedTime = quote.time;
  return { changed: true, newFills: account.fills.slice(start) };
}
