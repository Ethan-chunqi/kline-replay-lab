// Eastmoney's unadjusted quote and K-line feeds. Network errors deliberately
// propagate so the caller can identify any cached/offline observation by date.
const QUOTE_API = 'https://push2.eastmoney.com/api/qt/';
const HISTORY_API = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const MARGIN_URL = 'https://qhweb.eastmoney.com/bzj/cffex';
const MARGIN_DATE = '2026-11-20';
const EXCHANGE_MARGIN_SOURCE = 'https://www.sywgqh.com.cn/Pc/Customer_Service/Cover_Cost/132313.html';
const CONTRACT_RULES = {
  IM: 'https://www.cffex.com.cn/u/cms/www/202207/18190308vxpv.pdf',
  IC: 'https://www.cffex.com.cn/u/cms/www/202003/27165943rkyd.pdf',
  IF: 'https://www.cffex.com.cn/u/cms/www/202003/27160915uqs5.pdf',
};
const SERIES = {
  csi1000: { secid: '1.000852', prefix: 'IM', multiplier: 200, zone: 'Asia/Shanghai' },
  csi500: { secid: '1.000905', prefix: 'IC', multiplier: 200, zone: 'Asia/Shanghai' },
  csi300: { secid: '1.000300', prefix: 'IF', multiplier: 300, zone: 'Asia/Shanghai' },
  // On this feed NDX is the Nasdaq Composite; NDX100 is the Nasdaq-100.
  ndx: { secid: '100.NDX100', zone: 'America/New_York' },
  spx: { secid: '100.SPX', zone: 'America/New_York' },
  hsi: { secid: '100.HSI', zone: 'Asia/Hong_Kong' },
};
const PERIOD = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1h': 60, '1H': 60, '1D': 101 };
const activeCache = new Map();

function makeURL(endpoint, params) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

const pending = new Map();
const recent = new Map();
const cooldown = new Map();
const waiting = [];
let running = 0;
let nextRequestAt = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function drain() {
  while (running < 2 && waiting.length) {
    const job = waiting.shift();
    running++;
    const start = Math.max(Date.now(), nextRequestAt);
    nextRequestAt = start + 350;
    sleep(Math.max(0, start - Date.now()))
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        running--;
        drain();
      });
  }
}

async function performRequest(url, signal) {
  const endpoint = new URL(url);
  const key = endpoint.origin + endpoint.pathname;
  if (Date.now() < (cooldown.get(key) || 0)) throw new Error('东方财富正在暂停响应此行情接口。');
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 11000);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      if ([403, 429, 503].includes(response.status)) cooldown.set(key, Date.now() + 60000);
      const error = new Error('HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof TypeError || controller.signal.aborted) cooldown.set(key, Date.now() + 12000);
    const wrapped = new Error(
      '东方财富行情暂时不可用（' + (controller.signal.aborted ? '请求超时' : error.message) + '）。',
    );
    wrapped.status = error.status;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

// Quotes are shared by the ticket and watchlist. Serialize request starts
// and share short-lived results so loading six cards does not burst upstream.
async function json(url, signal) {
  if (signal?.aborted) throw signal.reason;
  const cached = recent.get(url);
  if (cached && Date.now() - cached.at < 5000) return cached.data;
  if (!signal && pending.has(url)) return pending.get(url);
  const work = new Promise((resolve, reject) => {
    waiting.push({ task: () => performRequest(url, signal), resolve, reject });
    drain();
  })
    .then((data) => {
      if (recent.size > 96) recent.delete(recent.keys().next().value);
      recent.set(url, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      if (!signal) pending.delete(url);
    });
  if (!signal) pending.set(url, work);
  return work;
}

async function request(url, signal) {
  const payload = await json(url, signal);
  if (payload.rc !== 0 || !payload.data) throw new Error('东方财富未返回该标的行情。');
  return payload.data;
}

function retryable(error, signal) {
  return !signal?.aborted && ![401, 403, 429].includes(error.status);
}

function isPositive(value) {
  return Number.isFinite(value) && value > 0;
}

function quoteLink(secid) {
  return 'https://quote.eastmoney.com/q/' + secid + '.html';
}

function tradeDate(time, zone) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(time * 1000);
  return ['year', 'month', 'day'].map((type) => p.find((x) => x.type === type).value).join('-');
}

function quoteOf(data, instrument) {
  if (
    data.f57 !== instrument.symbol ||
    !isPositive(data.f43) ||
    !Number.isSafeInteger(data.f86) ||
    data.f86 <= 0
  ) {
    throw new Error('东方财富未返回可核对的报价和时间。');
  }
  const priceOrNull = (price) => (isPositive(price) ? price : null);
  return {
    symbol: data.f57,
    name: data.f58,
    secid: instrument.secid,
    price: data.f43,
    time: data.f86,
    asOf: data.f86,
    tradeDate: tradeDate(data.f86, instrument.zone),
    open: priceOrNull(data.f46),
    high: priceOrNull(data.f44),
    low: priceOrNull(data.f45),
    previousClose: priceOrNull(data.f60),
    volume: Number.isFinite(data.f47) && data.f47 >= 0 ? data.f47 : null,
    quoteUrl: quoteLink(instrument.secid),
    sourceUrl: quoteLink(instrument.secid),
  };
}

async function activeSymbols(prefix, signal) {
  const cached = activeCache.get(prefix);
  if (cached && Date.now() - cached.fetched < 60000) return cached.symbol;
  const fields = 'f2,f5,f12,f13,f14,f15,f16,f17,f18,f124';
  const pageSize = 100;
  const page = async (pn) => {
    const url = makeURL(QUOTE_API + 'clist/get', {
      fs: 'm:220',
      pn,
      pz: pageSize,
      fields,
      fltt: 2,
      fid: 'f12',
      po: 0,
      np: 1,
    });
    const result = await request(url, signal);
    return { rows: Object.values(result.diff || {}), total: Number(result.total) };
  };
  let rows = [];
  try {
    const listURL = makeURL('https://futsseapi.eastmoney.com/list/220', {
      orderBy: 'dm',
      sort: 'asc',
      pageSize: 200,
      pageIndex: 0,
      field: 'dm,p,h,l,o,qrspj,vol',
    });
    const data = await json(listURL, signal);
    if (!Array.isArray(data.list) || data.list.length < data.total) throw new Error('期货快照列表不完整。');
    rows = data.list.map((q) => ({
      f12: q.dm,
      f2: q.p,
      f15: q.h,
      f16: q.l,
      f17: q.o,
      f18: q.qrspj,
      f5: q.vol,
    }));
    if (!rows.some((q) => q.f12 === prefix + 'M' && isPositive(q.f17) && isPositive(q.f18))) {
      throw new Error('期货快照缺少主力信息。');
    }
  } catch (error) {
    if (!retryable(error, signal)) throw error;
    const first = await page(1);
    rows = [...first.rows];
    for (let pn = 2; rows.length < first.total && pn <= 8; pn++) {
      const next = await page(pn);
      if (!next.rows.length) break;
      rows.push(...next.rows);
    }
  }
  for (const key of ['IM', 'IC', 'IF']) {
    const continuous = rows.find((row) => row.f12 === key + 'M');
    if (!continuous || !isPositive(continuous.f2)) continue;
    const dated = rows.filter((row) => new RegExp('^' + key + '\\d{2}(?:0[1-9]|1[0-2])$').test(row.f12));
    // Identify the dated contract whose daily OHLC and previous close match
    // the provider's own main-continuous instrument in the same snapshot.
    const fingerprint = ['f15', 'f16', 'f17', 'f18'];
    const matching = dated.filter((row) =>
      fingerprint.every((field) => isPositive(continuous[field]) && row[field] === continuous[field]),
    );
    const exact = matching.filter((row) => row.f2 === continuous.f2 && row.f5 === continuous.f5);
    const candidates = exact.length === 1 ? exact : matching;
    if (candidates.length === 1) activeCache.set(key, { symbol: candidates[0].f12, fetched: Date.now() });
  }
  const resolved = activeCache.get(prefix);
  if (!resolved || Date.now() - resolved.fetched >= 60000) {
    throw new Error('东方财富未能唯一确认当前主力月份，请选择具体合约后重试。');
  }
  return resolved.symbol;
}

async function resolve(marketId, contract, signal) {
  const spec = SERIES[marketId];
  if (!spec) throw new Error('此市场暂未接入东方财富。');
  if (contract === 'index') return { ...spec, symbol: spec.secid.split('.')[1], contract: null };
  if (!spec.prefix) throw new Error('此市场仅支持指数行情。');
  const symbol =
    contract === 'active' ? await activeSymbols(spec.prefix, signal) : String(contract).toUpperCase();
  if (!new RegExp('^' + spec.prefix + '\\d{2}(?:0[1-9]|1[0-2])$').test(symbol)) {
    throw new Error('请选择与该指数对应的单一期货月份合约。');
  }
  return {
    ...spec,
    secid: '220.' + symbol,
    symbol,
    contract: {
      symbol,
      multiplier: spec.multiplier,
      tickSize: 0.2,
      marginRate: 0.15,
      exchangeMarginRate: 0.12,
      sourceUrl: MARGIN_URL,
      marginSourceUrl: MARGIN_URL,
      exchangeMarginSourceUrl: EXCHANGE_MARGIN_SOURCE,
      specSourceUrl: CONTRACT_RULES[spec.prefix],
      asOf: MARGIN_DATE,
      marginAsOf: MARGIN_DATE,
    },
  };
}

async function currentQuote(instrument, signal) {
  const url = makeURL(QUOTE_API + 'stock/get', {
    secid: instrument.secid,
    fltt: 2,
    fields: 'f43,f44,f45,f46,f47,f57,f58,f60,f86',
  });
  let result;
  let source = url;
  if (instrument.contract) {
    source = 'https://futsseapi.eastmoney.com/static/220_' + instrument.symbol;
    try {
      const { qt } = await json(source, signal);
      if (!qt || qt.dm !== instrument.symbol) throw new Error('该合约暂无报价。');
      result = quoteOf(
        {
          f57: qt.dm,
          f58: qt.name,
          f43: qt.p,
          f86: qt.utime,
          f44: qt.h,
          f45: qt.l,
          f46: qt.o,
          f47: qt.vol,
          f60: qt.qrspj,
        },
        instrument,
      );
    } catch (error) {
      if (!retryable(error, signal)) throw error;
    }
  }
  if (!result) {
    try {
      source = url;
      result = quoteOf(await request(url, signal), instrument);
    } catch (error) {
      if (!retryable(error, signal)) throw error;
      source = makeURL(QUOTE_API + 'ulist/get', {
        secids: instrument.secid,
        fields: 'f2,f5,f12,f13,f14,f15,f16,f17,f18,f124',
        fltt: 2,
        pn: 1,
        pz: 1,
        np: 1,
      });
      const list = await request(source, signal);
      const q = Object.values(list.diff || {}).find((row) => row.f12 === instrument.symbol);
      if (!q) throw new Error('东方财富未返回该标的报价。');
      result = quoteOf(
        {
          f57: q.f12,
          f58: q.f14,
          f43: q.f2,
          f86: q.f124,
          f44: q.f15,
          f45: q.f16,
          f46: q.f17,
          f47: q.f5,
          f60: q.f18,
        },
        instrument,
      );
    }
  }
  return { ...result, dataUrl: source, contract: instrument.contract };
}

function startOfBar(stamp, klt, marketId, previousEnd) {
  // Unlike the daily date, the provider's intraday end label is in Beijing
  // time, including for US indexes (e.g. 05:00 in November = 16:00 EST).
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(stamp);
  if (!match) throw new Error('东方财富分钟 K 线时间格式异常。');
  const end = Date.parse(match[1] + 'T' + match[2] + ':' + match[3] + ':00+08:00') / 1000;
  let start = end - klt * 60;
  // HK hourly bars can span the noon recess (11:30–12:00 + 13:00–13:30).
  const localMinutes = Number(match[2]) * 60 + Number(match[3]);
  if (marketId === 'hsi' && localMinutes > 780 && localMinutes - klt < 780) start -= 3600;
  // A short final interval begins at the preceding bar's close.
  if (previousEnd !== null) start = Math.max(start, previousEnd);
  if (!Number.isFinite(end) || start >= end) throw new Error('东方财富 K 线时间顺序异常。');
  return { start, end };
}

function parseBars(rows, klt, marketId) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('东方财富未返回该周期的 K 线。');
  let previousEnd = null;
  let previousTime = null;
  return rows.map((row) => {
    const [stamp, o, c, h, l, v] = String(row).split(',');
    let time = stamp;
    if (klt !== 101) {
      const span = startOfBar(stamp, klt, marketId, previousEnd);
      time = span.start;
      previousEnd = span.end;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(time)) throw new Error('东方财富交易日期无效。');
    const [open, close, sourceHigh, sourceLow] = [o, c, h, l].map(Number);
    const volume = v === '-' ? 0 : Number(v);
    // The S&P feed sometimes publishes the official opening print separately
    // from its intrabar high/low range. Include that actual price in the chart
    // envelope and retain both reported extremes when the envelope changes.
    const spxIntraday = marketId === 'spx' && klt !== 101;
    const high = spxIntraday ? Math.max(open, sourceHigh) : sourceHigh;
    const low = spxIntraday ? Math.min(open, sourceLow) : sourceLow;
    if (
      ![open, sourceHigh, sourceLow, close].every(isPositive) ||
      sourceLow > sourceHigh ||
      low > Math.min(open, close) ||
      high < Math.max(open, close) ||
      !Number.isFinite(volume) ||
      volume < 0 ||
      (previousTime !== null && time <= previousTime)
    )
      throw new Error('东方财富 K 线数据校验失败。');
    previousTime = time;
    const bar = { time, open, high, low, close, volume };
    if (high !== sourceHigh || low !== sourceLow) Object.assign(bar, { sourceHigh, sourceLow });
    return bar;
  });
}

// The public futures page also lists time-and-sales. It returns, at most,
// roughly 2,000 actual executions; a fast contract may cover only minutes.
// Exclude the leftmost incomplete bucket and use no interpolated prices.
async function historyFromTrades(instrument, duration, limit, signal) {
  const sourceUrl = 'https://futsseapi.eastmoney.com/static/220_' + instrument.symbol + '_mx/2000';
  const payload = await json(sourceUrl, signal);
  if (!Array.isArray(payload.mx) || payload.mx.length < 2) throw new Error('东方财富成交明细不足。');
  const output = [];
  let previousTime = -Infinity;
  for (const trade of [...payload.mx].reverse()) {
    const time = trade.utime;
    if (
      trade.dm !== instrument.symbol ||
      !Number.isSafeInteger(time) ||
      time < previousTime ||
      !isPositive(trade.p) ||
      !Number.isFinite(trade.vol) ||
      trade.vol < 0
    )
      throw new Error('东方财富成交明细异常。');
    previousTime = time;
    const second = ((time % 86400) + 8 * 3600) % 86400;
    const open = second <= 41400 ? 34200 : 46800;
    const close = open === 34200 ? 41400 : 54000;
    if (second < open || second > close) continue;
    // A print exactly at 11:30 or 15:00 belongs to the closing interval.
    const elapsed = Math.min(second, close - 1) - open;
    const start = time - second + open + Math.floor(elapsed / (duration * 60)) * duration * 60;
    let bar = output.at(-1);
    if (!bar || bar.time !== start) {
      bar = { time: start, open: trade.p, high: trade.p, low: trade.p, close: trade.p, volume: 0 };
      output.push(bar);
    }
    bar.high = Math.max(bar.high, trade.p);
    bar.low = Math.min(bar.low, trade.p);
    bar.close = trade.p;
    bar.volume += trade.vol;
  }
  const bars = output.slice(1).slice(-limit);
  if (!bars.length) throw new Error('东方财富的最近成交明细不足以覆盖此 K 线周期。');
  return { bars, sourceUrl, name: null, historyKind: 'trades' };
}

async function historyOf(instrument, klt, marketId, limit, signal) {
  const params = {
    secid: instrument.secid,
    klt,
    fqt: 0,
    lmt: limit,
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56',
  };
  // The standard and numbered origins are both published in Eastmoney's
  // own quote frontend. Use one alternate only on availability failures.
  const hosts = [HISTORY_API, HISTORY_API.replace('://push2his.', '://1.push2his.')];
  let lastError;
  for (const host of hosts) {
    const sourceUrl = makeURL(host, params);
    try {
      const data = await request(sourceUrl, signal);
      if (data.code !== instrument.symbol) throw new Error('东方财富返回了不同的证券代码。');
      return {
        bars: parseBars(data.klines, klt, marketId),
        name: data.name,
        sourceUrl,
        historyKind: 'klines',
      };
    } catch (error) {
      if (!retryable(error, signal)) throw error;
      lastError = error;
    }
  }
  // The recent-minute feed is independent of the historical K-line endpoint.
  // It occasionally omits the minute opens for past days. Only use the
  // contiguous tail with actual full OHLC, without substituting previous closes.
  if (klt === 101) throw lastError;
  const sourceUrl = makeURL('https://push2his.eastmoney.com/api/qt/stock/trends2/get', {
    secid: instrument.secid,
    ndays: 5,
    iscr: 0,
    fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
  });
  try {
    const data = await request(sourceUrl, signal);
    if (data.code !== instrument.symbol || !Array.isArray(data.trends))
      throw new Error('东方财富未返回对应分时序列。');
    const rows = [];
    for (const line of data.trends) {
      const parts = String(line).split(',');
      // The 09:30 entry on this feed is an opening-auction snapshot.
      if (parts[0].endsWith(' 09:30') && instrument.zone !== 'America/New_York') continue;
      if (!parts.slice(1, 5).map(Number).every(isPositive)) rows.length = 0;
      else rows.push(line);
    }
    const minutes = parseBars(rows, 1, marketId);
    let bars = minutes;
    if (klt !== 1) {
      const { periodBars } = await import('./periods.js');
      bars = periodBars(minutes, klt === 60 ? '1H' : klt + 'm', { timeZone: instrument.zone });
    }
    return { bars: bars.slice(-limit), name: data.name, sourceUrl, historyKind: 'recent-minutes' };
  } catch (error) {
    if (!retryable(error, signal) || !instrument.contract) throw error;
    return historyFromTrades(instrument, klt, limit, signal);
  }
}

export async function fetchEastmoneyQuote(marketId, options = {}) {
  const instrument = await resolve(marketId, options.contract || 'index', options.signal);
  return currentQuote(instrument, options.signal);
}

export async function fetchEastmoneyBars(marketId, base = '1D', options = {}) {
  const klt = PERIOD[base];
  if (!klt) throw new Error('东方财富暂不支持这个基础 K 线周期。');
  const limit = options.limit ?? 720;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error('行情条数须在 1 至 10000 之间。');
  const instrument = await resolve(marketId, options.contract || 'index', options.signal);
  const [history, quote] = await Promise.all([
    historyOf(instrument, klt, marketId, limit, options.signal),
    currentQuote(instrument, options.signal),
  ]);
  return {
    ...history,
    name: history.name || quote.name,
    quote,
    symbol: instrument.symbol,
    secid: instrument.secid,
    quoteUrl: quote.quoteUrl,
    asOf: quote.time,
    tradeDate: quote.tradeDate,
    contract: instrument.contract,
  };
}
