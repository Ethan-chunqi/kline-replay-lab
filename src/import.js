// Imported quotes stay in the browser. Date-only observations retain their
// exchange date. Timestamped observations use Unix seconds internally.
const DAY = 86400000;
const MAX_BARS = 20000;
const MIN_BARS = 30;
const formatters = new Map();

const columns = {
  date: ['date', 'day', 'tradedate', 'tradingday', 'tradingdate', '日期', '交易日期', '交易日'],
  time: ['time', 'timestamp', 'datetime', '日期时间', '交易时间', '时间', '时间戳'],
  open: ['open', 'openprice', 'openingprice', '开盘', '开盘价', '今开'],
  high: ['high', 'highprice', '最高', '最高价'],
  low: ['low', 'lowprice', '最低', '最低价'],
  close: ['close', 'closeprice', 'closingprice', '收盘', '收盘价', '今收'],
  volume: ['volume', 'vol', '成交量', '成交股数', '交易量'],
};

const labels = {
  date: '日期',
  time: '时间',
  open: '开盘',
  high: '最高',
  low: '最低',
  close: '收盘',
  volume: '成交量',
};

function splitRecords(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('CSV 文件为空。');
  if (text.length > 16 * 1024 * 1024) throw new Error('CSV 文件过大，请截取不超过 20,000 根的行情。');
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.trimStart().split(/[\r\n]/, 1)[0];
  const delimiters = [',', '\t', ';'];
  const delimiter = delimiters.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let cells = [];
  let value = '';
  let quoted = false;
  let closed = false;
  let line = 1;
  let startLine = 1;

  function finishCell() {
    cells.push(value.trim());
    value = '';
    closed = false;
  }

  function finishRecord() {
    finishCell();
    if (cells.some((cell) => cell !== '')) rows.push({ cells, line: startLine });
    if (rows.length > MAX_BARS + 1) throw new Error('每次最多导入 20,000 根 K 线。');
    cells = [];
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        value += char;
        if (char === '\n') line++;
      }
    } else if (char === delimiter) finishCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      finishRecord();
      startLine = ++line;
    } else if (char === '"') {
      if (closed || value.trim()) throw new Error('第 ' + line + ' 行的双引号位置有误。');
      value = '';
      quoted = true;
    } else if (closed && !/\s/.test(char)) {
      throw new Error('第 ' + line + ' 行的引号后出现多余字符。');
    } else value += char;
  }
  if (quoted) throw new Error('第 ' + startLine + ' 行的双引号没有闭合。');
  finishRecord();
  return rows;
}

function normalizeHeading(value) {
  return value
    .toLowerCase()
    .replace(/[（(][^（）()]*[）)]$/, '')
    .replace(/[\s_-]+/g, '');
}

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    try {
      formatters.set(
        timeZone,
        new Intl.DateTimeFormat('en-GB', {
          timeZone,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    } catch {
      throw new Error('无法识别 CSV 的时区 ' + timeZone + '。');
    }
  }
  return formatters.get(timeZone);
}

function localParts(ms, timeZone) {
  const parts = {};
  for (const part of formatter(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

function localAsUTC(ms, timeZone) {
  const p = localParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// Infer the offset in effect at the observation itself, including DST.
function fromWallClock(wall, timeZone) {
  if (timeZone === 'UTC') return wall;
  const candidates = new Set();
  for (const probe of [wall - DAY, wall + DAY]) {
    const offset = localAsUTC(probe, timeZone) - probe;
    const candidate = wall - offset;
    if (localAsUTC(candidate, timeZone) === wall) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error('该日期时间处于夏令时切换区间，请附上 UTC 偏移。');
  return candidates.values().next().value;
}

function parseTime(raw, timeZone) {
  if (/^\d{10}$|^\d{13}$/.test(raw)) return Math.floor(Number(raw) / (raw.length === 13 ? 1000 : 1));
  const expanded = raw.replace(/^(\d{4})(\d{2})(\d{2})(?=$|[ T])/, '$1-$2-$3');
  const match = expanded.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i,
  );
  if (!match) throw new Error('日期时间格式有误，例如 2024-01-02 或 2024-01-02 09:30:00。');
  const [, y, m, d, h = '0', min = '0', sec = '0', zone] = match;
  const wall = Date.UTC(+y, +m - 1, +d, +h, +min, +sec);
  const date = new Date(wall);
  if (
    date.getUTCFullYear() !== +y ||
    date.getUTCMonth() + 1 !== +m ||
    date.getUTCDate() !== +d ||
    +h > 23 ||
    +min > 59 ||
    +sec > 59
  )
    throw new Error('日期或时分秒超出有效范围。');
  if (match[4] === undefined) return date.toISOString().slice(0, 10);
  if (!zone) return fromWallClock(wall, timeZone) / 1000;
  if (zone.toUpperCase() === 'Z') return wall / 1000;
  const digits = zone.slice(1).replace(':', '');
  const hours = +digits.slice(0, 2),
    minutes = +digits.slice(2);
  if (hours > 23 || minutes > 59) throw new Error('UTC 偏移超出有效范围。');
  const offset = (hours * 60 + minutes) * (zone[0] === '+' ? 1 : -1);
  return wall / 1000 - offset * 60;
}

function readNumber(raw, field) {
  let value = raw;
  let unit = 1;
  if (field === 'volume' && /[万亿]$/.test(value)) {
    unit = value.endsWith('万') ? 1e4 : 1e8;
    value = value.slice(0, -1).trim();
  }
  // Accept properly grouped thousands inside a quoted field.
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) value = value.replace(/,/g, '');
  const number = Number(value) * unit;
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ||
    !Number.isFinite(number) ||
    (field === 'volume' ? number < 0 : number <= 0)
  ) {
    throw new Error(labels[field] + (field === 'volume' ? '必须为非负数。' : '必须为正数。'));
  }
  return number;
}

export function parseBarsCSV(text, timeZone = 'UTC') {
  const rows = splitRecords(text);
  if (!rows.length) throw new Error('CSV 文件为空。');
  const headings = rows[0].cells.map(normalizeHeading);
  const index = {};
  for (const [field, aliases] of Object.entries(columns)) {
    const matches = headings.map((key, i) => (aliases.includes(key) ? i : -1)).filter((i) => i >= 0);
    if (matches.length > 1) throw new Error('发现重复的' + labels[field] + '列。');
    index[field] = matches[0];
  }
  if (index.date === undefined && index.time === undefined) throw new Error('CSV 缺少日期或时间列。');
  const required = ['open', 'high', 'low', 'close'].filter((field) => index[field] === undefined);
  if (required.length)
    throw new Error('CSV 缺少以下列：' + required.map((field) => labels[field]).join('、') + '。');
  const seen = new Set();
  const bars = [];
  for (let i = 1; i < rows.length; i++) {
    const { cells, line } = rows[i];
    try {
      if (cells.length !== headings.length) throw new Error('字段数量与表头不一致，请检查分隔符或引号。');
      const rawTime = [index.date, index.time]
        .filter((column) => column !== undefined)
        .map((column) => cells[column])
        .join(' ');
      const time = parseTime(rawTime, timeZone);
      if (bars.length && typeof time !== typeof bars[0].time)
        throw new Error('同一文件中的日线和分时数据不能混用。');
      if (seen.has(time)) throw new Error('该 K 线的日期时间重复。');
      seen.add(time);
      const bar = { time };
      for (const field of ['open', 'high', 'low', 'close', 'volume']) {
        bar[field] = index[field] === undefined ? 0 : readNumber(cells[index[field]], field);
      }
      if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close)) {
        throw new Error('最高价和最低价必须覆盖开盘价与收盘价。');
      }
      bars.push(bar);
    } catch (error) {
      throw new Error('第 ' + line + ' 行：' + error.message);
    }
  }
  if (bars.length < MIN_BARS) throw new Error('历史行情至少需要 30 根 K 线，当前为 ' + bars.length + ' 根。');
  return bars.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

function periodKey(time, period, timeZone) {
  if (period === '1D') return time;
  let date = time;
  if (typeof time === 'number') {
    const { year, month, day } = localParts(time * 1000, timeZone);
    date = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  if (period === '1M') return date.slice(0, 7);
  if (period !== '1W') throw new Error('聚合周期须为 1D、1W 或 1M。');
  const utc = Date.parse(date + 'T00:00:00Z');
  const monday = utc - ((new Date(utc).getUTCDay() + 6) % 7) * DAY;
  return new Date(monday).toISOString().slice(0, 10);
}

/** Only pass revealed bars. The final aggregate then ends at the replay cursor. */
export function aggregateBars(bars, period, timeZone = 'UTC') {
  if (period === '1D') return bars;
  const result = [];
  let previousKey;
  let current;
  for (const bar of bars) {
    const key = periodKey(bar.time, period, timeZone);
    if (key !== previousKey) {
      current = { ...bar };
      result.push(current);
      previousKey = key;
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
  }
  return result;
}

/** Resolve an execution timestamp to its chart bar. Both raw and aggregated,
 * ascending visible bars work; a missing period returns null. */
export function mapToPeriod(time, period, bars, timeZone = 'UTC') {
  const target = periodKey(time, period, timeZone);
  let left = 0;
  let right = bars.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (periodKey(bars[mid].time, period, timeZone) < target) left = mid + 1;
    else right = mid;
  }
  return left < bars.length && periodKey(bars[left].time, period, timeZone) === target
    ? bars[left].time
    : null;
}
