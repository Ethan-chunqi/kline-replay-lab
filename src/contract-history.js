// CC0 public dataset, fixed to the snapshot used to verify the contract catalogue.
const repository = 'Freddy-Hexas/china-futures-5min-2015-2025';
const revision = '1a402721d639432875504a343e2b9ffe9508cd36';

export function parseContractHistory(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.shift() !== 'datetime,open,high,low,close,volume,money,open_interest')
    throw new Error('历史合约档案格式有误。');
  const bars = [];
  let previousTime = 0;
  for (const line of lines) {
    const [stamp, ...fields] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(stamp) || fields.length !== 7)
      throw new Error('历史合约档案行或时间格式有误。');
    const volume = Number(fields[4]);
    if (fields[4] === '' || !Number.isSafeInteger(volume) || volume < 0) throw new Error('历史成交量异常。');
    // Empty intervals on illiquid, far-dated contracts are not executable prices.
    if (!volume) continue;
    const prices = fields.slice(0, 4).map(Number);
    const [open, high, low, close] = prices;
    const minute = Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));
    const earlyHours = stamp < '2016-01-01';
    const morning = minute >= (earlyHours ? 555 : 570) && minute < 690;
    const afternoon = minute >= 780 && minute < (earlyHours ? 915 : 900);
    // This archive uses exchange-local bar starts. The Sina feed uses end labels.
    const time = Date.parse(stamp.replace(' ', 'T') + '+08:00') / 1000;
    if (!Number.isSafeInteger(time) || time <= previousTime || (!morning && !afternoon) || minute % 5 ||
        prices.some(p => !Number.isFinite(p) || p <= 0 || Math.abs(p * 5 - Math.round(p * 5)) > 1e-5) ||
        high < Math.max(open, close) || low > Math.min(open, close)) {
      throw new Error('历史合约的价格、交易时段或最小变动价位异常。');
    }
    bars.push({ time, open, high, low, close, volume });
    previousTime = time;
  }
  if (bars.length < 20) throw new Error('历史合约的有效成交 K 线不足。');
  return bars;
}

export async function loadFullContractHistory(symbol, signal) {
  if (!/^(IM|IC|IF)\d{2}(0[1-9]|1[0-2])$/.test(symbol)) throw new Error('交割月合约代码有误。');
  const path = '5min/CFFEX/' + symbol.slice(0, 2) + '/' + symbol + '.csv';
  const dataUrl = 'https://raw.githubusercontent.com/' + repository + '/' + revision + '/' + path;
  const response = await fetch(dataUrl, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('历史合约档案暂不可用。');
  const bars = parseContractHistory(await response.text());
  const sourceUrl = 'https://github.com/' + repository + '/blob/' + revision + '/' + path;
  return {
    bars, base: '5m', symbol, historySource: '5 分钟合约档案（CC0）', sourceUrl, historySourceUrl: sourceUrl,
    dataUrl, asOf: bars.at(-1).time + 300,
  };
}
