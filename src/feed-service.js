// Equity and index execution marks come from Eastmoney. A historical
// replay can run entirely from verified candles for the requested instrument.
import { fetchEastmoneyBars, fetchEastmoneyQuote } from './eastmoney.js';
import { getBinanceQuote, loadBitcoinFeed } from './binance-history.js';
import { fetchSecondaryHistory } from './secondary-history.js';
import { fetchIndexHistory } from './index-history.js';
import { MARKETS } from './market.js?v=20261124';

const minutes = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1H': 60 };

function availableAtQuote(bar, base, quote, market) {
  if (typeof bar.time === 'number') return (bar.endTime ?? bar.time + minutes[base] * 60) <= quote.time;
  if (bar.time !== quote.tradeDate) return bar.time < quote.tradeDate;
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: market.timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(quote.time * 1000);
  return Number(hour) >= (market.region === 'A股' ? 15 : 16);
}

export function fetchMarketQuote(marketId, options = {}) {
  if (marketId === 'btc' || marketId === 'btcPerp') return getBinanceQuote({ ...options, marketId });
  return fetchEastmoneyQuote(marketId, options);
}

export async function loadChartFeed(marketId, base, options = {}) {
  if (marketId === 'btc' || marketId === 'btcPerp') return loadBitcoinFeed(base, { ...options, marketId });
  let primary, reason;
  try {
    primary = await fetchEastmoneyBars(marketId, base, options);
    if (primary.bars.length >= 30) return { ...primary, historySource: '东方财富' };
  } catch (err) {
    reason = err;
  }
  const isIndex = !options.contract || options.contract === 'index';
  const market = MARKETS.find((m) => m.id === marketId);
  try {
    let quote = primary?.quote;
    if (!quote && (!isIndex || !options.historyOnly)) quote = await fetchEastmoneyQuote(marketId, options);
    const fallback = isIndex
      ? await fetchIndexHistory(marketId, base, { signal: options.signal })
      : await fetchSecondaryHistory(marketId, quote.symbol, base, { signal: options.signal });
    const available = quote
      ? fallback.bars.filter((bar) => availableAtQuote(bar, base, quote, market))
      : fallback.bars;
    if (available.length >= 30) {
      return {
        bars: available.slice(-(options.limit || 720)),
        quote,
        symbol: quote?.symbol || market.symbol,
        name: quote?.name || market.name,
        secid: quote?.secid,
        quoteUrl: quote?.quoteUrl || fallback.sourceUrl,
        tradeDate: quote?.tradeDate || (base === '1D' ? available.at(-1).time : undefined),
        asOf: quote?.time || fallback.asOf,
        contract: quote?.contract || null,
        sourceUrl: fallback.sourceUrl,
        historySource: fallback.historySource,
      };
    }
  } catch (err) {
    reason ||= err;
  }
  if (primary) return { ...primary, historySource: '东方财富' };
  throw reason || Error('此周期的历史行情暂不可用。');
}
