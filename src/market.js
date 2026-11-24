// Generated prices and volumes are synthetic, including those on historical dates.
const csiReference = 'https://www.csindex.com.cn/#/indices/family/detail?indexCode=';

export const MARKETS = [
  {
    id: 'csi1000',
    name: '中证1000',
    short: '中证1000',
    symbol: '000852',
    exchange: 'CSI',
    currency: 'CNY',
    precision: 2,
    region: 'A股',
    timeZone: 'Asia/Shanghai',
    reference: csiReference + '000852',
  },
  {
    id: 'csi500',
    name: '中证500',
    short: '中证500',
    symbol: '000905',
    exchange: 'CSI',
    currency: 'CNY',
    precision: 2,
    region: 'A股',
    timeZone: 'Asia/Shanghai',
    reference: csiReference + '000905',
  },
  {
    id: 'ndx',
    name: '纳斯达克100',
    short: '纳指100',
    symbol: 'NDX',
    exchange: 'NASDAQ',
    currency: 'USD',
    precision: 2,
    region: '美股',
    timeZone: 'America/New_York',
    reference: 'https://indexes.nasdaq.com/Index/History/NDX',
  },
  {
    id: 'btcPerp',
    name: '比特币永续',
    short: 'BTC 永续',
    symbol: 'BTCUSDT',
    exchange: 'Binance USDⓈ-M',
    currency: 'USDT',
    precision: 1,
    quantityUnit: 'BTC',
    quantityDecimals: 3,
    region: '加密货币',
    timeZone: 'UTC',
    continuous: true,
    reference: 'https://www.binance.com/zh-CN/futures/BTCUSDT',
  },
  {
    id: 'btc',
    name: '比特币现货',
    short: '比特币',
    symbol: 'BTCUSDT',
    exchange: 'Binance',
    currency: 'USDT',
    precision: 2,
    quantityUnit: 'BTC',
    quantityDecimals: 5,
    region: '加密货币',
    timeZone: 'UTC',
    continuous: true,
    reference: 'https://www.binance.com/zh-CN/trade/BTC_USDT?type=spot',
  },
  {
    id: 'csi300',
    name: '沪深300',
    short: '沪深300',
    symbol: '000300',
    exchange: 'CSI',
    currency: 'CNY',
    precision: 2,
    region: 'A股',
    timeZone: 'Asia/Shanghai',
    reference: csiReference + '000300',
  },
  {
    id: 'spx',
    name: '标普500',
    short: '标普500',
    symbol: 'SPX',
    exchange: 'S&P DJI',
    currency: 'USD',
    precision: 2,
    region: '美股',
    timeZone: 'America/New_York',
    reference: 'https://www.spglobal.com/spdji/en/indices/equity/sp-500/',
  },
  {
    id: 'hsi',
    name: '恒生指数',
    short: '恒生',
    symbol: 'HSI',
    exchange: 'HSI',
    currency: 'HKD',
    precision: 2,
    region: '港股',
    timeZone: 'Asia/Hong_Kong',
    reference: 'https://www.hsi.com.hk/eng/indexes/all-indexes/hsi',
  },
];

// Hand-chosen simulation settings, independent of licensed series. Volume is
// synthetic activity, since a cash index does not itself have traded shares.
const profiles = {
  csi1000: { base: 5800, volatility: 0.014, activity: 83e6 },
  csi500: { base: 5500, volatility: 0.012, activity: 78e6 },
  btcPerp: { base: 60000, volatility: 0.036, activity: 380000 },
  btc: { base: 60000, volatility: 0.035, activity: 28000 },
  ndx: { base: 15900, volatility: 0.0135, activity: 104e6 },
  csi300: { base: 3850, volatility: 0.0105, activity: 96e6 },
  spx: { base: 4600, volatility: 0.01, activity: 115e6 },
  hsi: { base: 18200, volatility: 0.015, activity: 91e6 },
};

const DAY = 86400000;

function makeRandom(key) {
  let state = 2166136261;
  for (const character of key) {
    state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = Math.imul(state ^ (state >>> 15), state | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}

function periodOf(timeframe) {
  const key = String(timeframe).trim();
  if (/^(D|1D|DAY|DAILY)$/i.test(key)) return { name: '1D', days: 1 };
  if (/^(W|1W|WEEK|WEEKLY)$/i.test(key)) return { name: '1W', days: 5 };
  if (/^(M|1M|MONTH|MONTHLY)$/.test(key) || /^month(ly)?$/i.test(key)) return { name: '1M', days: 21 };
  const match = key.match(/^(\d+)(m|min|h)$/i);
  if (match) {
    const minutes = Number(match[1]) * (match[2].toLowerCase() === 'h' ? 60 : 1);
    if ([1, 3, 5, 10, 15, 30, 60, 120, 240].includes(minutes)) return { name: minutes + 'm', minutes };
  }
  throw new RangeError('不支持的 K 线周期：' + timeframe);
}

function weekday(timestamp) {
  const day = new Date(timestamp).getUTCDay();
  if (day === 0) return timestamp + DAY;
  if (day === 6) return timestamp + 2 * DAY;
  return timestamp;
}

function tradingHours(region) {
  if (region === '美股') return [[570, 960]];
  if (region === '港股')
    return [
      [570, 720],
      [780, 960],
    ];
  return [
    [570, 690],
    [780, 900],
  ];
}

function usUtcOffset(date) {
  const year = date.getUTCFullYear();
  const firstSunday = (month) => 1 + ((7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7);
  const summerStart = Date.UTC(year, 2, firstSunday(2) + 7);
  const summerEnd = Date.UTC(year, 10, firstSunday(10));
  return date >= summerStart && date < summerEnd ? -240 : -300;
}

// Synthetic exchanges use weekday sessions. Crypto trades around the clock.
function makeClock(period, market) {
  const {region, continuous} = market;
  const tradingDay = continuous ? (day) => day : weekday;
  const sessions = continuous ? [[0, 1440]] : tradingHours(region);
  const dailyMinutes = sessions.reduce((total, [start, end]) => total + end - start, 0);
  let day = Date.UTC(2023, 0, 3);
  if (period.name === '1W') day = Date.UTC(2012, 0, 2);
  if (period.name === '1M') day = Date.UTC(1965, 0, 1);
  let tradedMinutes = 0;

  return () => {
    const date = new Date(day);
    if (!period.minutes) {
      const time = new Date(tradingDay(day)).toISOString().slice(0, 10);
      if (period.name === '1D') day = tradingDay(day + DAY);
      if (period.name === '1W') day += 7 * DAY;
      if (period.name === '1M') day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
      return { time, days: period.days, newSession: true };
    }

    let offset = tradedMinutes;
    let localMinute = sessions[0][0];
    for (const [start, end] of sessions) {
      if (offset < end - start) {
        localMinute = start + offset;
        break;
      }
      offset -= end - start;
    }
    const zoneOffset = continuous ? 0 : region === '美股' ? usUtcOffset(date) : 480;
    const time = day / 1000 + (localMinute - zoneOffset) * 60;
    const length = Math.min(period.minutes, dailyMinutes - tradedMinutes);
    const newSession = tradedMinutes === 0;
    tradedMinutes += length;
    if (tradedMinutes === dailyMinutes) {
      tradedMinutes = 0;
      day = tradingDay(day + DAY);
    }
    return { time, days: length / dailyMinutes, newSession };
  };
}

/**
 * Generate an independent, deterministic practice scenario for one instrument
 * and timeframe. A longer request extends the same prefix. All timestamps are
 * UTC, with YYYY-MM-DD for daily or coarser bars and Unix seconds for intraday.
 */
export function generateBars(id, seed = 1, count = 720, timeframe = '1D') {
  const market = MARKETS.find((item) => item.id === id);
  if (!market) throw new RangeError('未知模拟市场：' + id);
  const profile = profiles[id];
  const period = periodOf(timeframe);
  // The ISO date interface uses four-digit years.
  const maxCount = period.name === '1M' ? (10000 - 1965) * 12 : 100000;
  if (!Number.isSafeInteger(count) || count < 0 || count > maxCount)
    throw new RangeError('K 线数量须为 0 至 ' + maxCount + ' 的整数');
  const random = makeRandom([id, seed, period.name].join('|'));
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const tick = 10 ** market.precision;
  const price = (value) => Math.max(1, Math.round(value * tick)) / tick;
  const nextTime = makeClock(period, market);
  let previous = price(profile.base * (0.94 + random() * 0.12));
  let variability = 1;
  let trend = 0;
  let remaining = 0;
  const bars = [];

  for (let i = 0; i < count; i++) {
    const { time, days, newSession } = nextTime();
    if (remaining <= 0) {
      trend = normal() * 0.16;
      variability = 0.65 + random() * 1.05;
      remaining = 12 + Math.floor(random() * 64);
    }
    remaining--;
    const volatility = profile.volatility * Math.sqrt(days) * variability;
    const gapScale = newSession && !market.continuous ? Math.min(profile.volatility, volatility) * 0.22 : 0;
    const open = price(previous * Math.exp(normal() * gapScale));
    const reversion = -0.0015 * days * Math.log(open / profile.base);
    const shock = random() < 0.019 ? normal() * 1.9 : 0;
    const change = volatility * (normal() * 0.8 + trend + shock) + reversion;
    const close = price(open * Math.exp(change));
    const high = price(Math.max(open, close) * Math.exp(Math.abs(normal()) * volatility * 0.36));
    const low = price(Math.min(open, close) * Math.exp(-Math.abs(normal()) * volatility * 0.36));
    const activity = (0.5 + Math.abs(change / volatility) * 0.48 + random() * 0.68) * variability;
    const volume = Math.max(1, Math.round(profile.activity * days * activity));
    bars.push({ time, open, high, low, close, volume });
    previous = close;
  }
  return bars;
}
