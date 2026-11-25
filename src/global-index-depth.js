// Tencent's public cash-index data. Daily candles and quote snapshots use
// different endpoints. The latter carries an exchange-local quote timestamp.
const indices = {
  hsi: { code: 'hkHSI', sourceSymbol: 'HSI', symbol: 'HSI', name: '恒生指数', zone: 'Asia/Hong_Kong' },
  spx: { code: 'us.INX', sourceSymbol: '.INX', symbol: 'SPX', name: '标普500', zone: 'America/New_York' },
  ndx: { code: 'us.NDX', sourceSymbol: '.NDX', symbol: 'NDX100', name: '纳斯达克100', zone: 'America/New_York' },
};
const api = 'https://ifzq.gtimg.cn/appstock/app/';

async function readIndex(marketId, path, query, signal) {
  const index = indices[marketId];
  if (!index) throw Error('腾讯行情未接入此指数');
  const url = new URL(path, api);
  url.search = new URLSearchParams(query);
  const timeout = AbortSignal.timeout(4500);
  const response = await fetch(url, { credentials: 'omit', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw Error('腾讯指数行情请求失败');
  const json = await response.json();
  const data = json.data?.[index.code];
  const quote = data?.qt?.[index.code];
  // A provider can resolve us.NDX to the unrelated stock DX.N in its
  // daily snapshot. Enforce both identity fields before accepting anything.
  if (json.code !== 0 || quote?.[2] !== index.sourceSymbol || quote[1] !== index.name)
    throw Error('腾讯未返回所选指数');
  return { data, quote, index, sourceUrl: 'https://gu.qq.com/' + index.code, dataUrl: url.href };
}

function validDate(stamp) {
  const parsed = Date.parse(stamp + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(stamp) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === stamp;
}

export async function fetchGlobalIndexDaily(marketId, { signal, limit = 720 } = {}) {
  if (!['hsi','spx'].includes(marketId)) throw Error('腾讯指数日线不支持此市场');
  const count = Math.min(720, Math.max(1, Math.floor(limit)));
  const { data, index, dataUrl, sourceUrl } = await readIndex(marketId, 'kline/kline',
    { param: [indices[marketId].code, 'day', '', '', count, ''].join(',') }, signal);
  if (!Array.isArray(data.day) || !data.day.length) throw Error('腾讯未返回指数日线');
  let previous = '';
  const bars = data.day.map(row => {
    const time = row[0];
    const [open, close, high, low, volume] = row.slice(1, 6).map(value => value == null || value === '' ? NaN : Number(value));
    if (!validDate(time) || time <= previous || ![open, high, low, close, volume].every(Number.isFinite)
      || low <= 0 || low > Math.min(open, close) || high < Math.max(open, close) || volume < 0)
      throw Error('腾讯指数日线校验失败');
    previous = time;
    return { time, open, high, low, close, volume };
  });
  const tradeDate = bars.at(-1).time;
  return { bars, base: '1D', symbol: index.symbol, sourceSymbol: index.sourceSymbol, historySource: '腾讯自选股',
    sourceUrl, historySourceUrl: sourceUrl, dataUrl, tradeDate,
    asOf: Date.parse(tradeDate + 'T00:00:00Z') / 1000, asOfPrecision: 'date' };
}

export async function fetchGlobalIndexQuote(marketId, { signal } = {}) {
  const code = indices[marketId]?.code;
  const hk = marketId === 'hsi';
  const { quote, index, dataUrl, sourceUrl } = await readIndex(marketId, hk ? 'hkMinute/query' : 'UsMinute/query', {code}, signal);
  const stamp = String(quote[30]).replaceAll('/', '-');
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
  if (!match || !validDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59)
    throw Error('腾讯指数报价时间无效');
  const date = match[1];
  const offset = new Intl.DateTimeFormat('en', {timeZone:index.zone, timeZoneName:'shortOffset'})
    .formatToParts(new Date(date + 'T12:00:00Z')).find(part => part.type === 'timeZoneName').value;
  if (!(hk ? offset === 'GMT+8' : ['GMT-4', 'GMT-5'].includes(offset))) throw Error('腾讯指数时区无效');
  const time = Date.parse(stamp.replace(' ', 'T') + 'Z') / 1000 - Number(offset.slice(3)) * 3600;
  const [price, previousClose, open, high, low] = [3, 4, 5, 33, 34].map(i => Number(quote[i]));
  if (![price, previousClose, open, high, low].every(v => Number.isFinite(v) && v > 0)
    || low > Math.min(price, open) || high < Math.max(price, open)) throw Error('腾讯指数报价无效');
  return { symbol:index.symbol, name:index.name, price, previousClose, open, high, low, time, asOf:time,
    tradeDate:date, secid: '100.' + index.symbol, quoteUrl:sourceUrl, sourceUrl, dataUrl, contract:null };
}
