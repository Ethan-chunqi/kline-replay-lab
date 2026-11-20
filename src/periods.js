import { aggregateBars, mapToPeriod } from './import.js';

const intervals = [
  ['1m', 1, '1分'],
  ['3m', 3, '3分'],
  ['5m', 5, '5分'],
  ['10m', 10, '10分'],
  ['15m', 15, '15分'],
  ['30m', 30, '30分'],
  ['1H', 60, '1小时'],
  ['2H', 120, '2小时'],
  ['4H', 240, '4小时'],
];
const durations = new Map(intervals.map(([id, minutes]) => [id, minutes]));
const calendar = [
  ['1D', '日线'],
  ['1W', '周线'],
  ['1M', '月线'],
  ['1Q', '季线'],
  ['1Y', '年线'],
];
const calendars = new Map(calendar);
const datePeriods = new Set(['1D', '1W', '1M']);
const DAY = 86400;

// Input times identify the opening of each bar. Timestamps outside regular
// trading hours (possible in an imported file) keep their own time buckets.
const sessions = {
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
// CFFEX changed its equity-index futures hours on 2016-01-01.
const earlyFuturesSessions = [[555, 690], [780, 915]];
const zoneRegions = { 'Asia/Shanghai': 'A股', 'Asia/Hong_Kong': '港股', 'America/New_York': '美股' };
const zoneCache = new Map();
const weeklyCache = new Map();

function exchangeClock(time, market) {
  if (typeof time === 'string') return { date: time, minute: 0 };
  const zone = market.timeZone || 'UTC';
  let cache = zoneCache.get(zone);
  if (!cache) {
    cache = {
      times: new Map(),
      formatter: new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
    zoneCache.set(zone, cache);
  }
  let value = cache.times.get(time);
  if (!value) {
    const parts = Object.fromEntries(
      cache.formatter.formatToParts(time * 1000).map((p) => [p.type, p.value]),
    );
    value = {
      date: parts.year + '-' + parts.month + '-' + parts.day,
      minute: 60 * Number(parts.hour) + Number(parts.minute),
    };
    if (cache.times.size >= 30000) cache.times.clear();
    cache.times.set(time, value);
  }
  return value;
}

function weekKey(date) {
  let key = weeklyCache.get(date);
  if (!key) {
    const utc = Date.parse(date + 'T00:00:00Z');
    const weekday = (new Date(utc).getUTCDay() + 6) % 7;
    key = new Date(utc - weekday * DAY * 1000).toISOString().slice(0, 10);
    if (weeklyCache.size >= 20000) weeklyCache.clear();
    weeklyCache.set(date, key);
  }
  return key;
}

function intradayKey(minute, interval, windows) {
  let elapsed = 0;
  for (const [open, close] of windows) {
    if (minute < open) return 'break-' + open + '-' + Math.floor((minute - open) / interval);
    if (minute < close) return 'regular-' + Math.floor((elapsed + minute - open) / interval);
    elapsed += close - open;
  }
  return 'after-' + Math.floor((minute - windows.at(-1)[1]) / interval);
}

function keyOf(time, period, market) {
  if (period === 'BASE') return time;
  const { date, minute } = exchangeClock(time, market);
  if (period === '1D') return date;
  if (period === '1W') return weekKey(date);
  if (period === '1M') return date.slice(0, 7);
  if (period === '1Q') return date.slice(0, 4) + '-Q' + Math.ceil(Number(date.slice(5, 7)) / 3);
  if (period === '1Y') return date.slice(0, 4);
  const duration = durations.get(period);
  if (!duration) throw new Error('不支持的图表周期：' + period);
  const region = market.region || zoneRegions[market.timeZone];
  const windows = market.exchange === 'CFFEX' && date < '2016-01-01'
    ? earlyFuturesSessions : sessions[region] || [[0, 1440]];
  return date + '/' + intradayKey(minute, duration, windows);
}

const seconds = (time) => (typeof time === 'number' ? time : Date.parse(time) / 1000);

function sourceInterval(base, bars) {
  if (base !== 'CSV') return durations.get(base) || base;
  // The modal gap represents the imported sample cadence. Holidays, lunch
  // breaks and overnight gaps do not lower its inferred resolution.
  const intraday = new Map();
  const dayGaps = [];
  const length = Math.min(bars.length, 3000);
  for (let i = 1; i < length; i++) {
    const diff = seconds(bars[i].time) - seconds(bars[i - 1].time);
    if (typeof bars[i].time === 'number' && diff > 0 && diff < DAY / 2) {
      intraday.set(diff, (intraday.get(diff) || 0) + 1);
    } else if (diff > 0) {
      dayGaps.push(diff / DAY);
    }
  }
  if (intraday.size) {
    const [gap] = [...intraday].sort(([a, ac], [b, bc]) => bc - ac || a - b)[0];
    return gap / 60;
  }
  if (dayGaps.length) {
    dayGaps.sort((a, b) => a - b);
    const typical = dayGaps[Math.floor(dayGaps.length / 2)];
    if (typical >= 300) return '1Y';
    if (typical >= 80) return '1Q';
    return typical >= 27 ? '1M' : typical >= 6 ? '1W' : '1D';
  }
  return typeof bars[0]?.time === 'string' ? '1D' : null;
}

export function timeframeOptions(base, bars = [], region) {
  const source = sourceInterval(base, bars);
  if (!source) return [{ id: 'BASE', label: '原周期' }];
  if (calendars.has(source)) {
    const start = calendar.findIndex(([id]) => id === source);
    return calendar.slice(start).map(([id, label], i) => ({ id: i ? id : 'BASE', label }));
  }
  const standard = intervals.find(([, minutes]) => minutes === source);
  const label = standard
    ? standard[2]
    : source < 1
      ? String(Math.round(source * 60)) + '秒'
      : String(source) + '分';
  const higher = intervals.filter(
    ([, minutes]) => minutes > source && Math.abs(minutes / source - Math.round(minutes / source)) < 1e-8,
  );
  return [
    { id: 'BASE', label },
    ...higher.map(([id, , label]) => ({ id, label })),
    ...calendar.map(([id, label]) => ({ id, label })),
  ];
}

/** Aggregate only the revealed portion of the underlying series. */
export function periodBars(bars, period, market = {}) {
  if (period === 'BASE' || !bars.length) return bars;
  if (typeof bars[0].time === 'string' && datePeriods.has(period)) {
    return aggregateBars(bars, period, market.timeZone || 'UTC');
  }
  const result = [];
  let previous, candle;
  for (const bar of bars) {
    const key = keyOf(bar.time, period, market);
    if (key !== previous) {
      candle = { ...bar };
      result.push(candle);
      previous = key;
    } else {
      candle.high = Math.max(candle.high, bar.high);
      candle.low = Math.min(candle.low, bar.low);
      candle.close = bar.close;
      candle.volume += bar.volume;
    }
  }
  return result;
}

/** Return the aggregate's first observed timestamp for a real execution, or null. */
export function executionTime(time, period, aggregatedBars, market = {}) {
  if (!aggregatedBars.length) return null;
  if (typeof time === 'string' && datePeriods.has(period)) {
    return mapToPeriod(time, period, aggregatedBars, market.timeZone || 'UTC');
  }
  const target = seconds(time);
  let left = 0,
    right = aggregatedBars.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (seconds(aggregatedBars[mid].time) <= target) left = mid + 1;
    else right = mid;
  }
  const nearest = aggregatedBars[left - 1];
  return nearest && keyOf(nearest.time, period, market) === keyOf(time, period, market) ? nearest.time : null;
}

// Complete the next visible chart candle. The caller walks every underlying
// bar in sequence so stop orders and margin checks keep their normal timing.
export function nextDisplayCursor(bars, cursor, period, market) {
  let end = Math.min(bars.length - 1, cursor + 1);
  if (period === 'BASE' || end === cursor) return end;
  const key = keyOf(bars[end].time, period, market);
  while (end + 1 < bars.length && keyOf(bars[end + 1].time, period, market) === key) end++;
  return end;
}
