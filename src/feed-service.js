// The mark and contract details always belong to Eastmoney. If its history
// feed is sparse, obtain candles for the same dated contract and disclose their source.
import { fetchEastmoneyBars, fetchEastmoneyQuote } from './eastmoney.js';
import { fetchSecondaryHistory } from './secondary-history.js';

export async function loadChartFeed(marketId, base, options = {}) {
  let primary, reason;
  try {
    primary = await fetchEastmoneyBars(marketId, base, options);
    if (primary.bars.length >= 30 || !primary.contract) return { ...primary, historySource: '东方财富' };
  } catch (err) {
    reason = err;
  }
  if (options.contract && options.contract !== 'index' && ['1m', '5m', '15m', '30m', '1H'].includes(base)) {
    try {
      const quote = primary?.quote || (await fetchEastmoneyQuote(marketId, options));
      if (!quote.contract || !/^(IM|IC|IF)\d{4}$/.test(quote.symbol)) throw Error('缺少具体合约');
      const secondary = await fetchSecondaryHistory(marketId, quote.symbol, base);
      const seconds = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1H': 3600 }[base];
      const bars = secondary.bars.filter((b) =>
        typeof b.time === 'number' ? b.time + seconds <= quote.time : b.time <= quote.tradeDate,
      );
      if (bars.length >= 30) {
        return {
          bars: bars.slice(-(options.limit || 720)),
          quote,
          symbol: quote.symbol,
          name: quote.name,
          secid: quote.secid,
          quoteUrl: quote.quoteUrl,
          tradeDate: quote.tradeDate,
          asOf: quote.time,
          contract: quote.contract,
          sourceUrl: secondary.sourceUrl,
          historySource: '新浪财经',
        };
      }
    } catch (err) {
      reason ||= err;
    }
  }
  if (primary) return { ...primary, historySource: '东方财富' };
  throw reason || Error('此周期的历史行情暂不可用。');
}
