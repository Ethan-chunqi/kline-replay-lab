// The public Shinny EDB API serves dated CFFEX candles. A delayed archive
// may end before today's feed; callers keep real gaps visible.
const inflightDays = new Map();
async function edbMinutes(symbol, firstDate, quoteDate, signal) {
  if (!/^(IM|IF)\d{2}(0[1-9]|1[0-2])$/.test(symbol)) throw Error('无效的中金所合约。');
  const key = [symbol, firstDate, quoteDate].join('/');
  const cached = inflightDays.get(key);
  if (cached && Date.now() - cached.at < 15 * 60000) return cached.data;
  const url = new URL('https://edb.shinnytech.com/md/kline');
  url.search = new URLSearchParams({symbol:'CFFEX.' + symbol,period:'60',
    start_time:firstDate + ' 00:00:00',end_time:quoteDate + ' 15:00:00'});
  const timeout = AbortSignal.timeout(3000);
  const response = await fetch(url, {signal:signal ? AbortSignal.any([signal,timeout]) : timeout, credentials:'omit'});
  if (!response.ok) throw Error('信易 EDB 合约分钟线暂不可用。');
  const lines = (await response.text()).trim().split(/\r?\n/);
  if (lines.shift() !== 'datetime_nano,open,high,low,close,volume,open_oi,close_oi') throw Error('信易 EDB 数据列异常。');
  const bars = [];
  for (const line of lines) {
    const [timestamp, ...fields] = line.split(',');
    const [open,high,low,close,volume] = fields.map(Number);
    if (!/^\d{10}0{9}$/.test(timestamp) || ![open,high,low,close,volume].every(Number.isFinite)
      || low <= 0 || high < Math.max(open,close) || low > Math.min(open,close) || volume < 0) continue;
    const time = Number(timestamp.slice(0, -9));
    if (time <= (bars.at(-1)?.time || 0)) continue;
    bars.push({time,open,high,low,close,volume});
  }
  if (!bars.length) throw Error('信易 EDB 当期没有分钟 K 线。');
  if (inflightDays.size >= 8) inflightDays.delete(inflightDays.keys().next().value);
  const data = {bars,sourceUrl:url.href};
  inflightDays.set(key,{at:Date.now(),data});
  return data;
}

// This site's public terminal archives the same dated contract. A snapshot
// contributes only when its published candles overlap the requested range.
async function terminalMinutes(root, symbol, firstDate, quoteDate, signal) {
  const sourceUrl = root + '/year/futures/' + symbol + '.json.gz';
  const timeout = AbortSignal.timeout(3500);
  const response = await fetch(sourceUrl, {credentials:'omit', signal:signal ? AbortSignal.any([signal,timeout]) : timeout});
  if (!response.ok) throw Error('站内期货快照暂不可用。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const content = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')))
    : new Response(bytes);
  const archive = await content.json();
  if (archive.schema !== 1 || archive.contract !== symbol || archive.symbol !== symbol.slice(0, 2)
    || archive.sourceId !== 'cffex-' + symbol || archive.source !== 'Sina Finance' || !Array.isArray(archive.frames?.['1m']))
    throw Error('站内期货快照与所选合约不符。');
  const bars = unpackRows(archive.frames['1m'],firstDate,quoteDate);
  return {bars, sourceUrl, historySource:'新浪财经（站内快照）'};
}

function unpackRows(rows, firstDate, lastDate) {
  const from = Date.parse(firstDate + 'T00:00:00+08:00') / 1000;
  const to = Date.parse(lastDate + 'T15:00:00+08:00') / 1000;
  const bars = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [time, open, high, low, close, volume] = row;
    if (!Number.isSafeInteger(time) || time % 60 || time < from || time >= to || time <= (bars.at(-1)?.time || 0)
      || ![open,high,low,close,volume].every(Number.isFinite) || low <= 0 || volume < 0
      || high < Math.max(open,close) || low > Math.min(open,close)) continue;
    bars.push({time,open,high,low,close,volume});
  }
  if (!bars.length) throw Error('站内期货快照未覆盖所选时段。');
  return bars;
}

// This compact file is an independently checked original close-labelled
// minute series, stored as UTC candle starts, for the documented gap only.
async function verifiedSession(symbol, firstDate, quoteDate, signal) {
  const date = '2026-11-16';
  if (!['IM2612','IF2612'].includes(symbol) || firstDate > date || quoteDate < date) return null;
  const sourceUrl = new URL('../data/cffex-tdx-20261116.json', import.meta.url).href;
  const response = await fetch(sourceUrl, {signal});
  if (!response.ok) throw Error('该合约的站内分钟补档暂不可用。');
  const archive = await response.json();
  const rows = archive.contracts?.[symbol];
  if (archive.schema !== 1 || archive.source !== '通达信' || archive.market !== 'CFFEX'
    || archive.base !== '1m' || archive.date !== date || !Array.isArray(rows))
    throw Error('合约分钟补档标识无效。');
  const bars = unpackRows(rows,date,date);
  const sessionOpen = Date.parse(date + 'T09:30:00+08:00') / 1000;
  if (bars.length !== 240 || bars.some((bar,i) => bar.time !== sessionOpen + (i < 120 ? i : i + 90) * 60))
    throw Error('合约分钟补档的交易时段不完整。');
  return {bars, sourceUrl, historySource:'通达信'};
}

export async function archivedFuturesMinutes(symbol, firstDate, quoteDate, signal) {
  if (!/^(IM|IF)\d{2}(0[1-9]|1[0-2])$/.test(symbol)) throw Error('无效的中金所合约。');
  const rollingTerminal = 'https://raw.githubusercontent.com/Ethan-chunqi/kline-replay-lab/market-data/quotes';
  const originalTerminal = 'https://ethan-chunqi.github.io/kline-replay-lab/bulls-and-bears';
  const snapshot = terminalMinutes(rollingTerminal,symbol,firstDate,quoteDate,signal).catch(() => {
    signal?.throwIfAborted();
    return terminalMinutes(originalTerminal,symbol,firstDate,quoteDate,signal);
  });
  const results = await Promise.allSettled([
    snapshot,
    verifiedSession(symbol,firstDate,quoteDate,signal),
    edbMinutes(symbol,firstDate,quoteDate,signal).then(data => ({...data, historySource:'信易 EDB'})),
  ]);
  signal?.throwIfAborted();
  const sources = results.filter(result => result.status === 'fulfilled').map(result => result.value).filter(Boolean);
  if (!sources.length) throw Error('当前无覆盖该时段的分钟历史档案。');
  const merged = new Map();
  for (const source of sources) for (const bar of source.bars) merged.set(bar.time, bar);
  return {bars:[...merged.values()].sort((a,b) => a.time-b.time), sourceUrl:sources.at(-1).sourceUrl,
    archiveSources:sources.map(source => source.sourceUrl), historySource:sources.map(source => source.historySource).join(' · ')};
}
