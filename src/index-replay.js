// Tencent's cash-index chart service supports dated daily queries from a static site.
// It can return extra US sessions before "from", so enforce both boundaries locally.
const indices = {
  ndx: { ticker: 'us.NDX', symbol: 'NDX', name: '纳斯达克100', start: '2000-01-03' },
  spx: { ticker: 'us.INX', symbol: 'SPX', name: '标普500', start: '1970-01-02' },
  hsi: { ticker: 'hkHSI', symbol: 'HSI', name: '恒生指数', start: '1990-01-02' },
  csi1000: { ticker: 'sh000852', symbol: '000852', name: '中证1000', start: '2014-10-17' },
  csi500: { ticker: 'sh000905', symbol: '000905', name: '中证500', start: '2007-01-15' },
  csi300: { ticker: 'sh000300', symbol: '000300', name: '沪深300', start: '2005-04-08' },
};

export function indexArchivePeriods(marketId, base) {
  const index = indices[marketId];
  if (!index || base !== '1D') return [];
  // Allow the current year once it has three full months. Stop at the last
  // completed month so a still-trading session can never enter a training archive.
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const lastMonthEnd = new Date(Date.UTC(currentYear, today.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const lastYear = today.getUTCMonth() >= 3 ? currentYear : currentYear - 1;
  const firstYear = Number(index.start.slice(0, 4));
  const periods = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const from = year === firstYear ? index.start : year + '-01-01';
    const to = year === currentYear ? lastMonthEnd : year + '-12-31';
    periods.push({ key: marketId + ':1D:' + year, year, from, to });
  }
  return periods;
}

export async function loadIndexArchivePeriod(marketId, base, candidate, { signal } = {}) {
  const period = indexArchivePeriods(marketId, base).find((item) => item.key === candidate?.key);
  if (!period) throw new Error('该指数和周期没有相应的历史区间');
  const { ticker, name, symbol } = indices[marketId];
  const method = ticker.startsWith('us') ? 'usfqkline/get' : 'fqkline/get';
  const url = new URL('https://web.ifzq.gtimg.cn/appstock/app/' + method);
  url.searchParams.set('param', [ticker, 'day', period.from, period.to, 320, 'qfq'].join(','));
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('腾讯历史行情暂不可用');
  const data = await response.json();
  const rows = data.data?.[ticker]?.day;
  if (data.code !== 0 || !Array.isArray(rows)) throw new Error('腾讯未返回相应指数的日线');
  const bars = [];
  let rejected = 0;
  for (const row of rows) {
    const time = row?.[0];
    if (typeof time !== 'string' || time < period.from || time > period.to) continue;
    const [open, close, high, low] = row.slice(1, 5).map(Number);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(time) ||
      ![open, close, high, low].every((price) => Number.isFinite(price) && price > 0) ||
      high < Math.max(open, close) || low > Math.min(open, close) || (bars.length && time <= bars.at(-1).time)
    ) {
      rejected++;
      continue;
    }
    const volume = row[5] == null || row[5] === '' ? null : Number(row[5]);
    bars.push({ time, open, high, low, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : null });
  }
  if (bars.length < 30) throw new Error('该年度通过校验的指数日线不足');
  const sourceUrl = 'https://gu.qq.com/' + ticker;
  const tradeDate = bars.at(-1).time;
  return {
    bars, base, symbol, name, contract: null, historySource: '腾讯行情', sourceUrl, historySourceUrl: sourceUrl,
    dataUrl: url.href, asOf: Date.parse(tradeDate + 'T00:00:00Z') / 1000, asOfPrecision: 'date', tradeDate,
    rejected,
  };
}
