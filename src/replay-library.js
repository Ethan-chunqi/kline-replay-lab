// Historic periods use dated contracts or dated index observations throughout.
import { archivePeriods, loadArchivePeriod } from './replay-archive.js?v=20261120b';
import { indexArchivePeriods, loadIndexArchivePeriod } from './index-replay.js?v=20261120b';
import { localPeriods, loadLocalPeriod } from './local-archive.js';
import { rankArchivePeriods } from './random-period.js?v=20261120b';

function sources(marketId, kind, base) {
  const remote = kind === 'future' ? archivePeriods(marketId, base) : indexArchivePeriods(marketId, base);
  const entries = new Map(remote.map((item) => [item.key, item]));
  for (const item of localPeriods(marketId, kind, base)) {
    entries.set(item.key, { ...entries.get(item.key), ...item, local: true });
  }
  return [...entries.values()];
}
const catalogs = new Map();
export function replayCatalog(marketId, kind, display) {
  const key = [marketId, kind, display, new Date().toISOString().slice(0, 7)].join('/');
  if (catalogs.has(key)) return catalogs.get(key);
  let base = ['1D', '1W', '1M', '1Q', '1Y'].includes(display) ? '1D' :
    ['1m', '3m'].includes(display) ? '1m' : '5m';
  let periods = sources(marketId, kind, base);
  if (!periods.length && display !== base) {
    base = display;
    periods = sources(marketId, kind, base);
  }
  // Older cash-index dates often have only verified daily candles.
  if (!periods.length && kind !== 'future') {
    base = '1D';
    periods = sources(marketId, kind, base);
  }
  const catalog = { base, periods, years: [...new Set(periods.map((p) => p.year))].sort((a, b) => a - b) };
  catalogs.set(key, catalog);
  return catalog;
}

const failures = new Map();
export async function readHistoricalPeriod(marketId, kind, display, requestedYear, history, isCurrent, signal) {
  const { base, periods, years } = replayCatalog(marketId, kind, display);
  const thisYear = new Date().getFullYear();
  const selected = years.includes(Number(requestedYear)) ? Number(requestedYear) : null;
  let eligible = periods.filter((p) => selected ? p.year === selected : p.year < thisYear);
  if (!eligible.length) return null;
  // Quarterly futures have months of history while late-listed near months
  // may have only a handful of trading days. Prefer the longer training pool.
  const longPeriods = eligible.filter((p) => {
    const days = p.sessions ?? (base === '5m' ? (p.count || 0) / 48 : base === '1D' ? p.count : 0);
    return days >= 60;
  });
  if (longPeriods.length) eligible = longPeriods;
  const visits = history.map((s) => s.feed.archivePeriod ||
    (kind === 'future' && eligible.find((p) => p.symbol === s.feed.symbol))).filter(Boolean);
  const ordered = rankArchivePeriods(eligible, visits);
  const loadRemote = kind === 'future' ? loadArchivePeriod : loadIndexArchivePeriod;
  const cached = new Map();
  for (const entry of history) {
    if (entry.base === base && entry.feed.archivePeriod && entry.customBars?.length >= 20)
      cached.set(entry.feed.archivePeriod.key, entry);
  }

  async function read(item) {
    const key = [marketId, base, item.key].join('/');
    const prior = cached.get(item.key);
    let data;
    if (item.local) {
      data = await loadLocalPeriod(marketId, kind, base, item, {signal});
    } else if (prior) {
      data = {
        bars: prior.customBars, base, name: prior.feed.name, symbol: prior.feed.symbol,
        sourceUrl: prior.feed.quoteUrl, historySource: prior.feed.historySource, tradeDate: prior.feed.tradeDate,
        contract: prior.feed.contract, historyCached: true,
      };
    } else {
      if ((failures.get(key) || 0) > Date.now()) return null;
      const timeout = AbortSignal.timeout(4500);
      try {
        data = await loadRemote(marketId, base, item, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      } catch (err) {
        if (isCurrent()) failures.set(key, Date.now() + 120000);
        throw err;
      }
    }
    if (!data || data.bars.length < 20) return null;
    const dataBase = data.base || base;
    return { ...data, base: dataBase, archivePeriod: item, archiveYears: years[0] + '–' + years.at(-1),
      requestedYear: selected, display: dataBase === '1D' && !['1D','1W','1M','1Q','1Y'].includes(display) ? '1D' : display };
  }

  // A bundled unpracticed contract opens without waiting for a quote server.
  // When all bundled dates have been visited, allow an online archive to add more.
  const used = new Set(visits.map((p) => p.key));
  const freshLocal = ordered.filter((p) => p.local && !used.has(p.key));
  const freshKeys = new Set(freshLocal.map((p) => p.key));
  const remaining = ordered.filter((p) => !freshKeys.has(p.key));
  const queue = [...freshLocal, ...remaining.filter((p) => !p.local && !used.has(p.key)).slice(0, 1),
    ...remaining.filter((p) => p.local || cached.has(p.key)), ...remaining.slice(0, 3)];
  for (const candidate of new Set(queue)) {
    if (!isCurrent()) return null;
    signal?.throwIfAborted();
    try {
      const data = await read(candidate);
      if (data) return data;
    } catch { signal?.throwIfAborted(); }
  }
  return null;
}
