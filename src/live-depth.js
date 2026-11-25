// Audit the requested sessions against exchange-local candle starts. Recent
// date labels alone are insufficient: a clipped first day and a missing day both fail.
import { MARKETS } from './market.js?v=20261124';
import { exchangeClock, tradingWindows } from './periods.js?v=20261124exposure';

export const liveMinutes = {'1m':1, '3m':3, '5m':5, '10m':10, '15m':15, '30m':30, '1H':60, '2H':120, '4H':240};
const dayMs = 86400000;
function priorWeekdays(quoteDate, count) {
  const result = [];
  for (let day = Date.parse(quoteDate + 'T00:00:00Z') - dayMs; result.length < count; day -= dayMs) {
    const stamp = new Date(day);
    if (stamp.getUTCDay() !== 0 && stamp.getUTCDay() !== 6) result.unshift(stamp.toISOString().slice(0, 10));
  }
  return result;
}

function minutesByDay(market, date, interval) {
  let windows = tradingWindows(market, date);
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  const m = Number(date.slice(5, 7)), day = Number(date.slice(8));
  if (market.region === '美股' && ((m === 11 && weekday === 5 && day >= 23 && day <= 29)
      || ((m === 12 && day === 24) || (m === 7 && day === 3)) && weekday >= 1 && weekday <= 4)) {
    windows = [[570, 780]];
  } else if (market.region === '港股' && (date.endsWith('-12-24') || date.endsWith('-12-31'))) {
    windows = [windows[0]];
  }
  const starts = [];
  // Each actual session minute contributes once. The Hong Kong hourly
  // candle can straddle the noon recess on Eastmoney.
  let traded = 0;
  for (const [from, to] of windows) {
    for (let minute = from; minute < to; minute++, traded++) if (traded % interval === 0) starts.push(minute);
  }
  return starts;
}

export function assessLiveDepth(marketId, base, bars, quoteDate, requestedDays = 20, priorDates = null) {
  const market = MARKETS.find(item => item.id === marketId);
  if (!market || !/^\d{4}-\d{2}-\d{2}$/.test(quoteDate) || !Number.isFinite(Date.parse(quoteDate))
    || !Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 60)
    throw Error('实时回看日期无效。');
  const verified = Array.isArray(priorDates);
  const expectedDates = verified
    ? [...new Set(priorDates.filter(date => date < quoteDate))].sort().slice(-requestedDays)
    : priorWeekdays(quoteDate, requestedDays);
  const days = new Map();
  for (const bar of bars) {
    const {date, minute} = exchangeClock(bar.time, market);
    if (!days.has(date)) days.set(date, new Set());
    days.get(date).add(minute);
  }
  const done = expectedDates.filter(date => {
    const actual = days.get(date);
    if (!actual) return false;
    if (base === '1D') return true;
    const interval = liveMinutes[base];
    return interval && minutesByDay(market, date, interval).every(minute => actual.has(minute));
  });
  const range = [...days.keys()].filter(day => day >= (expectedDates[0] || quoteDate) && day <= quoteDate).sort();
  return {
    requestedDays, completeDays:done.length, complete:done.length === requestedDays,
    firstDate:range[0] || '', lastDate:range.at(-1) || '', quoteDate, expectedDates,
    calendarVerified:verified, todayBars:days.get(quoteDate)?.size || 0,
    barCount:range.reduce((count, date) => count + days.get(date).size, 0),
  };
}
