// Use individually identified quotes and genuine candles for the selected instrument.
import { fetchEastmoneyBars, fetchEastmoneyQuote } from './eastmoney.js';
import { getBinanceQuote, loadBitcoinFeed } from './binance-history.js?v=20261124range2';
import { fetchSecondaryHistory } from './secondary-history.js';
import { fetchIndexHistory } from './index-history.js?v=20261124range2';
import { assessLiveDepth, liveMinutes } from './live-depth.js';
import { archivedFuturesMinutes } from './live-depth-futures.js';
import { supportsTencentIndex, tencentIndexQuote, tencentIndexMinutes } from './live-depth-index.js';
import { exchangeClock } from './periods.js?v=20261124exposure';
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

export async function fetchMarketQuote(marketId, options = {}) {
  if (marketId === 'btc' || marketId === 'btcPerp') return getBinanceQuote({ ...options, marketId });
  if (options.contract && options.contract !== 'index') return fetchEastmoneyQuote(marketId, options);
  const {signal} = options;
  const deadline = AbortSignal.timeout(2500);
  try {
    return await fetchEastmoneyQuote(marketId, {...options,signal:signal ? AbortSignal.any([signal,deadline]) : deadline});
  } catch (error) {
    signal?.throwIfAborted();
    if (supportsTencentIndex(marketId)) return tencentIndexQuote(marketId, signal);
    if (['ndx', 'spx', 'hsi'].includes(marketId)) {
      const { fetchGlobalIndexQuote } = await import('./global-index-depth.js');
      const quote = await fetchGlobalIndexQuote(marketId, {signal});
      return {...quote, providerName:'腾讯自选股'};
    }
    throw error;
  }
}

async function recentChartFeed(marketId, base, options = {}) {
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
    if (!quote && (!isIndex || !options.historyOnly)) quote = await fetchMarketQuote(marketId, options);
    const fallback = isIndex
      ? await fetchIndexHistory(marketId, base, { signal: options.signal, limit:options.limit })
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

function combineBars(archive, recent) {
  const combined = new Map(archive.map(bar => [bar.time, bar]));
  for (const bar of recent) combined.set(bar.time, bar);
  return [...combined.values()].sort((a, b) => a.time - b.time);
}

const dailyCalendars = new Map();

function recentPriorDates(dates, date, count) {
  const previousWeekday = new Date(date + 'T12:00:00Z');
  do { previousWeekday.setUTCDate(previousWeekday.getUTCDate() - 1); }
  while ([0,6].includes(previousWeekday.getUTCDay()));
  const last = dates.at(-1);
  if (!last || last < previousWeekday.toISOString().slice(0,10)) return null;
  return dates.filter(value => value < date).slice(-count);
}

async function previousSessions(marketId, quoteDate, count, signal) {
  const key = [marketId,quoteDate,count].join('/');
  if (dailyCalendars.has(key)) return dailyCalendars.get(key);
  // A regular session calendar is independent of trading volume or the
  // listing date of the selected futures delivery month.
  let daily;
  try {
    daily = await fetchIndexHistory(marketId, '1D', {signal, limit:count + 10});
  } catch { signal?.throwIfAborted(); }
  if (!daily) {
    const timeout = AbortSignal.timeout(1800);
    try {
      daily = await fetchEastmoneyBars(marketId, '1D', {contract:'index',limit:count + 10,
        signal:signal ? AbortSignal.any([signal,timeout]) : timeout});
    } catch { signal?.throwIfAborted(); }
  }
  const result = recentPriorDates(daily?.bars.map(bar => bar.time) || [], quoteDate, count);
  if (result?.length === count) {
    if (dailyCalendars.size >= 30) dailyCalendars.delete(dailyCalendars.keys().next().value);
    dailyCalendars.set(key,result);
  }
  return result;
}

export async function loadChartFeed(marketId, base, options = {}) {
  if (marketId === 'btc' || marketId === 'btcPerp') return loadBitcoinFeed(base, {...options, marketId});
  if (!options.tradeDays) return recentChartFeed(marketId, base, options);

  const count = options.tradeDays, market = MARKETS.find(m => m.id === marketId);
  if (!market || !Number.isInteger(count) || count < 1 || count > 60) throw Error('实时回看交易日参数无效。');
  const {signal} = options;
  const quote = await fetchMarketQuote(marketId, options);
  const contract = quote.contract ? quote.symbol : 'index';
  const interval = liveMinutes[base] || 1;
  const dayMinutes = market.region === 'A股' ? 240 : 390;
  const limit = Math.min(10000, Math.max(options.limit || 720, Math.ceil(dayMinutes / interval) * (count + 1) + 1));
  const calendar = previousSessions(marketId, quote.tradeDate, count, signal);
  const make = (source, prior) => {
    const input = source.bars.filter(bar => availableAtQuote(bar, base, quote, market));
    const depth = assessLiveDepth(marketId, base, input, quote.tradeDate, count, prior);
    const first = depth.expectedDates[0] || quote.tradeDate;
    const bars = base === '1D' ? input : input.filter(b => exchangeClock(b.time, market).date >= first);
    return {...source, bars, quote, symbol:quote.symbol, name:quote.name, quoteUrl:quote.quoteUrl,
      secid:quote.secid, contract:quote.contract, tradeDate:quote.tradeDate, asOf:quote.time, depth};
  };
  let best;
  try {
    const [source, prior] = await Promise.all([
      contract === 'index' ? fetchIndexHistory(marketId,base,{signal,limit})
        : fetchSecondaryHistory(marketId,quote.symbol,base,{signal}), calendar,
    ]);
    best = make(source, prior);
    if (best.depth.complete && best.bars.length) return best;
  } catch { signal?.throwIfAborted(); }

  if (base === '1m' && (contract !== 'index' || supportsTencentIndex(marketId))) {
    const prior = await calendar;
    const dates = prior || assessLiveDepth(marketId, base, [], quote.tradeDate, count).expectedDates;
    try {
      if (contract === 'index') {
        const source = await tencentIndexMinutes(marketId, [...dates, quote.tradeDate], quote.tradeDate, signal);
        best = make(source, prior);
      } else {
        const archive = await archivedFuturesMinutes(quote.symbol, dates[0], quote.tradeDate, signal);
        const bars = combineBars(archive.bars, best?.bars || []);
        best = make({ ...archive, bars, historySource:archive.historySource + (best?.bars.length ? ' · 新浪财经' : ''),
          archiveSourceUrl:archive.sourceUrl }, prior);
      }
      if (best.depth.complete) return best;
    } catch { signal?.throwIfAborted(); }
  }
  // A thin fallback must not replace a longer dated-contract series.
  const deadline = best?.bars.length ? AbortSignal.timeout(2000) : null;
  const primarySignal = deadline ? (signal ? AbortSignal.any([signal,deadline]) : deadline) : signal;
  try {
    const [em, prior] = await Promise.all([
      fetchEastmoneyBars(marketId,base,{contract,limit,signal:primarySignal}), calendar,
    ]);
    if (em.symbol === quote.symbol) {
      let candidate = make({...em,historySource:'东方财富'},prior);
      if (best?.bars.length && em.historyKind === 'klines' && base !== '1D') {
        const merged = combineBars(candidate.bars, best.bars);
        if (merged.length > best.bars.length) candidate = make({...best, bars:merged,
          historySource:best.historySource + ' · 东方财富'},prior);
      }
      if (candidate.bars.length && (!best?.bars.length || candidate.depth.completeDays > best.depth.completeDays
        || (candidate.depth.completeDays === best.depth.completeDays && candidate.depth.barCount >= best.depth.barCount))) best = candidate;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (!best?.bars.length) throw error;
  }
  if (!best?.bars.length) throw Error('该品种当前没有可核验的历史 K 线。');
  return best;
}
