import { fullContractSessions } from './contract-catalog.js';
import { loadFullContractHistory } from './contract-history.js';
import { futuresTerms } from './eastmoney.js';
import { fetchSecondaryHistory, loadPublicRows, parseRows } from './secondary-history.js';

const markets = {
  csi1000: { prefix: 'IM', name: '中证1000' },
  csi500: { prefix: 'IC', name: '中证500' },
  csi300: { prefix: 'IF', name: '沪深300' },
};

const intervals = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '60m', '1H': '60m', '1D': '1D' };

// The catalogue holds delivery months only. Each replay loads one dated
// contract directly from the provider and validates its time series.
// Verified 2026-11-20. The dedicated CFFEX daily feed covers early quarterly
// contracts. The newer feed covers monthly deliveries from April 2020 onward.
const firstIntraday = { '1m': 2004, '5m': 2004, '15m': 2005, '30m': 2004, '60m': 2004 };
const firstDelivery = { IM: 2208, IC: 1505, IF: 1005 };
const verifiedThrough = 2611;
const excluded = {
  IC2006: ['30m', '60m'],
  IC2009: ['60m', '1D'],
  IC2104: ['60m'],
  IF1503: ['1D'],
  IF1506: ['1D'],
  IF2006: ['30m', '60m'],
  IF2009: ['60m'],
  IF2104: ['15m', '30m', '60m'],
  IF2106: ['30m'],
  IF2507: ['5m', '60m'],
  IF2508: ['60m'],
  IF2509: ['15m', '60m'],
  IF2512: ['60m'],
};

export function archivePeriods(marketId, base) {
  const spec = markets[marketId];
  const interval = intervals[base];
  if (!spec || !interval) return [];
  const launch = firstDelivery[spec.prefix];
  const first = interval === '1D' || interval === '5m' ? launch : Math.max(launch, firstIntraday[interval]);
  // After the verified catalogue, offer newly completed months. The loader
  // checks the returned dates and actual trading activity before using them.
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const lastDelivery = Math.max(verifiedThrough, (lastMonth.getUTCFullYear() % 100) * 100 + lastMonth.getUTCMonth() + 1);
  const periods = [];
  for (let year = 2000 + Math.floor(first / 100); year <= 2000 + Math.floor(lastDelivery / 100); year++) {
    for (let month = 1; month <= 12; month++) {
      const delivery = (year % 100) * 100 + month;
      if (delivery < first || delivery > lastDelivery) continue;
      const symbol = spec.prefix + delivery;
      const sessions = interval === '5m' ? fullContractSessions(symbol) : 0;
      if (!sessions) {
        if (interval === '5m' && delivery < firstIntraday[interval]) continue;
        if (delivery < 2004 && delivery !== launch && month % 3 !== 0) continue;
        if (excluded[symbol]?.includes(interval)) continue;
      }
      periods.push({ key: symbol, symbol, year, month, sessions });
    }
  }
  return periods;
}

function tradingDate(time) {
  if (typeof time === 'string') return time;
  return new Date((time + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

async function fetchEarlyDaily(symbol, signal) {
  // This feed returns [date, open, high, low, close, volume-in-lots].
  const dataUrl = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20wavelabCffexRows=/CffexFuturesService.getCffexFuturesDailyKLine?symbol=' + symbol;
  const rows = await loadPublicRows(dataUrl, signal);
  const bars = parseRows(rows.map((r) => {
    if (!Array.isArray(r) || r.length !== 6) throw new Error('中金所历史日线格式异常。');
    const [d, o, h, l, c, v] = r;
    return { d, o, h, l, c, v };
  }), 0);
  const sourceUrl = 'https://finance.sina.com.cn/futures/quotes/' + symbol + '.shtml';
  return {
    bars, symbol, base: '1D', historySource: '新浪财经', sourceUrl, historySourceUrl: sourceUrl, dataUrl,
    asOf: Date.parse(bars.at(-1).time + 'T15:00:00+08:00') / 1000,
  };
}

export async function loadArchivePeriod(marketId, base, candidate, { signal } = {}) {
  const period = archivePeriods(marketId, base).find(({ key }) => key === candidate?.key);
  if (!period) return null;
  let history;
  if (period.sessions) {
    history = await loadFullContractHistory(period.symbol, signal);
  } else if (base === '1D' && period.symbol.slice(2) < '1906') {
    history = await fetchEarlyDaily(period.symbol, signal);
  } else {
    history = await fetchSecondaryHistory(marketId, period.symbol, base, { signal });
  }
  const firstDate = tradingDate(history.bars[0].time);
  const tradeDate = tradingDate(history.bars.at(-1).time);
  const deliveryMonth = period.year + '-' + String(period.month).padStart(2, '0');
  const earliest = new Date(Date.UTC(period.year - 1, period.month - 1, 1)).toISOString().slice(0, 10);
  if (history.bars.length < 20 || firstDate < earliest || !tradeDate.startsWith(deliveryMonth + '-'))
    throw new Error('新浪返回的历史行情与所选交割月份不符。');
  const activeBars = history.bars.reduce((n, bar) => n + Number(bar.volume > 0), 0);
  if (activeBars <= history.bars.length / 2) throw new Error('这个合约的实际成交过于稀疏，请换一个时段。');
  return {
    ...history,
    name: markets[marketId].name + '期货 ' + period.symbol,
    contract: futuresTerms(marketId, period.symbol),
    tradeDate,
    period,
  };
}
