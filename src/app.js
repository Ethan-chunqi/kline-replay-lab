import { MARKETS, generateBars } from './market.js';
import { timeframeOptions, periodBars, executionTime, nextDisplayCursor } from './periods.js?v=20261120b';
import { anchoredScenario, SNAPSHOT_QUOTES } from './anchor.js';
import { pickRandomStart, visitedBarRanges } from './random-period.js?v=20261120b';
import { replayCatalog, readHistoricalPeriod } from './replay-library.js';
import { loadChartFeed } from './feed-service.js';
import { fetchEastmoneyQuote, futuresTerms } from './eastmoney.js';
import { tradingBar, applyLiveQuote } from './live.js';
import {
  DEFAULT_INITIAL_CASH,
  createAccount,
  getSnapshot,
  advanceBar,
  placeOrder,
  cancelOrder,
  closePosition,
  updateProtection,
} from './engine.js?v=20261120c';
import { createTradingChart } from './chart.js';
import { renderJournal } from './journal.js';
import { openNew, openHelp, openMarkets } from './dialogs.js?v=20261120c';
import { openStorage } from './storage.js';
import { icon } from './icons.js';

const $ = (selector) => document.querySelector(selector);
const elements = (id) => document.getElementById(id);
const all = (selector) => [...document.querySelectorAll(selector)];
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const number = (n, places = 2) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
const signed = (n) => (n >= 0 ? '+' : '−') + number(Math.abs(n));
const tone = (n) => (n >= 0 ? 'positive' : 'negative');
const byId = (id) => MARKETS.find((m) => m.id === id);
const humanName = (name) => name.replace(/(\D)(\d)/, '$1 $2');
const defaultSeed = 10,
  defaultStart = 119;
const fmtTime = (t, zone) =>
  typeof t === 'string'
    ? t
    : new Date(t * 1000).toLocaleString('sv-SE', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
const ordersText = { market: '市价', limit: '限价', stop: '停止', stopLimit: '停止限价' };
const orderStatus = { pending: '待成交', filled: '已成交', cancelled: '已撤单', rejected: '已拒绝' };
const seedNumber = () => crypto.getRandomValues(new Uint32Array(1))[0];
const sessions = new Map();
let pendingInitialAction = '';
let activeDays = [];
let s,
  market,
  bars = [],
  visible = [],
  aggregated = [],
  chart,
  store,
  saveIssue = false,
  side = 'buy',
  tab = 'position',
  timer = null,
  view = 'terminal',
  cleanJournal,
  toastTimer,
  saveVersion = 0,
  loadVersion = 0,
  quoteBusy = false,
  loadBusy = false,
  randomBusy = false,
  refreshIssue = '',
  frameChoices = [];
const domestic = (id) => ['csi1000', 'csi500', 'csi300'].includes(id);
const watchStore = 'wavelab-main-contract-watch';
const watch = new Map(
  Object.entries(SNAPSHOT_QUOTES).map(([id, quote]) => [id, { quote: quote.future || quote, pinned: true }]),
);
const markBar = () => tradingBar(s, bars[s.cursor]);
const unitName = () => (s.account.contract ? '手' : '单位');
const baseIDs = ['1m', '3m', '5m', '10m', '15m', '30m', '1H', '2H', '4H', '1D', '1W', '1M', '1Q', '1Y'];
const baseNames = [
  '1分',
  '3分',
  '5分',
  '10分',
  '15分',
  '30分',
  '1小时',
  '2小时',
  '4小时',
  '日线',
  '周线',
  '月线',
  '季线',
  '年线',
];
for (const i of all('[data-i]')) i.innerHTML = icon(i.dataset.i);
const themeSwitch = elements('themeSwitch');
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? '浅色' : '深色';
  themeSwitch.querySelector('i').innerHTML = icon(dark ? 'sun' : 'moon');
  themeSwitch.querySelector('span').textContent = label;
  themeSwitch.title = '切换到' + label;
  themeSwitch.setAttribute('aria-label', themeSwitch.title);
}
updateThemeButton();
themeSwitch.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#1c1c1c' : '#f3f6f8';
  try {
    localStorage.setItem('wavelab-theme', theme);
  } catch {}
  updateThemeButton();
  document.dispatchEvent(new Event('wavelab-theme'));
});
function notify(message) {
  elements('toast').textContent = message;
  elements('toast').classList.add('toast-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements('toast').classList.remove('toast-on'), 3200);
}
const recoveryKey = 'wavelab-pending-save';
function recoveryRecord() {
  try {
    return JSON.parse(localStorage.getItem(recoveryKey));
  } catch {
    return null;
  }
}
function save() {
  s.updated = Date.now();
  sessions.set(s.id, s);
  const version = ++saveVersion;
  const { customBars, ...state } = s;
  const token = crypto.randomUUID();
  // A small synchronous journal covers a refresh before IndexedDB commits.
  // Imported source bars are immutable and only stored in IndexedDB.
  try {
    localStorage.setItem(recoveryKey, JSON.stringify({ token, state, usesImport: !!customBars }));
  } catch {}
  if (!store) {
    elements('saved').textContent = '浏览器存储受限';
    return Promise.resolve(false);
  }
  elements('saved').textContent = '正在保存训练记录…';
  return store
    .save(s)
    .then(() => {
      if (recoveryRecord()?.token === token) {
        try {
          localStorage.removeItem(recoveryKey);
        } catch {}
      }
      if (version === saveVersion) {
        saveIssue = false;
        elements('saved').textContent = '训练记录已保存至此浏览器';
      }
      return true;
    })
    .catch(() => {
      elements('saved').textContent = '浏览器未能保存本次更改';
      if (!saveIssue) notify('浏览器存储不可用，本次更改未写入存档');
      saveIssue = true;
      return false;
    });
}
function applyRecovery(active) {
  const record = recoveryRecord();
  if (!record?.state?.id) return active;
  const buffered = record.state,
    stored = sessions.get(buffered.id);
  if (record.usesImport && !stored?.customBars) return active;
  if ((active?.updated || 0) > buffered.updated || (stored?.updated || 0) > buffered.updated) return active;
  const next = { ...buffered, customBars: stored?.customBars };
  sessions.set(next.id, next);
  return next;
}
function getBars(config) {
  if (config.customBars) return config.customBars;
  const series = generateBars(config.marketId, config.seed, 720, config.base);
  const ref = config.simulationReference;
  if (!ref) return series;
  const scale = ref.price / series[ref.index].close;
  const ticksPerPoint = 1 / ref.tickSize;
  const price = (n) => Math.max(1, Math.round(n * scale * ticksPerPoint)) / ticksPerPoint;
  return series.map((bar) => ({
    ...bar,
    open: price(bar.open),
    high: price(bar.high),
    low: price(bar.low),
    close: price(bar.close),
  }));
}
function makeSession(config = {}) {
  const {
    marketId = 'csi1000',
    base = '1D',
    seed = seedNumber(),
    startIndex = defaultStart,
    customBars,
    customName = '',
  } = config;
  const series = getBars({
    marketId,
    base,
    seed,
    customBars,
    simulationReference: config.simulationReference,
  });
  const start = config.live ? series.length - 1 : Math.max(0, Math.min(startIndex, series.length - 2));
  const account = createAccount(config);
  if (!config.live) advanceBar(account, series[start]);
  const created = {
    id: crypto.randomUUID(),
    marketId,
    base,
    seed,
    start,
    cursor: start,
    customBars,
    customName,
    instrumentKind: config.kind || config.feed?.kind || (config.contract ? 'future' : 'spot'),
    simulationReference: config.simulationReference,
    account,
    notes: [],
    period: config.period || 'BASE',
    periodSchema: 2,
    historicalHome: true,
    customCapital: config.customCapital ?? (account.initialCash !== DEFAULT_INITIAL_CASH),
    feed: config.feed || null,
    live: !!config.live,
    scenarioId: config.scenarioId || crypto.randomUUID(),
    type: 'candles',
    drawings: {},
    speed: '1',
    created: Date.now(),
    updated: Date.now(),
  };
  if (config.live) {
    applyBoardQuote(created, config.quote);
    created.entryMark = config.quote.price;
    created.markHistory = [{ time: created.account.lastTime, price: config.quote.price }];
  }
  return created;
}
function displayMarket(session = s) {
  const profile = byId(session.marketId);
  if (session.feed)
    return {
      ...profile,
      name: session.feed.name,
      symbol: session.feed.symbol,
      exchange: session.account.contract ? 'CFFEX' : profile.exchange,
    };
  if (session.account.contract) {
    return {
      ...profile,
      exchange: 'CFFEX',
      symbol: session.account.contract.symbol,
      name: session.customName || profile.name + ' 股指期货模拟',
    };
  }
  return session.customBars ? { ...profile, name: session.customName || '自选行情', symbol: 'CSV' } : profile;
}
function activate(next) {
  stop();
  s = next;
  s.instrumentKind ??= s.account.contract ? 'future' : 'spot';
  loadVersion++;
  loadBusy = false;
  randomBusy = false;
  refreshIssue = '';
  if (!s.periodSchema) {
    if (s.period === '1D') s.period = 'BASE';
    s.periodSchema = 2;
  }
  s.type = 'candles';
  delete s.indicators;
  market = displayMarket();
  bars = getBars(s);
  frameChoices = timeframeOptions(s.base, bars, market.region);
  activeDays = s.live ? [] : tradingDates(bars, s.marketId).days;
  const range = elements('practiceRange');
  range.hidden = s.live;
  if (!s.live) {
    const coverage = s.feed?.archiveYears;
    const day = (b) => fmtTime(b.time, market.timeZone).slice(0, 10);
    range.textContent = (coverage ? '可抽年份 ' + coverage + '　·　' : '') +
      '本段行情 ' + day(bars[0]) + ' 至 ' + day(bars.at(-1));
  }
  if (!frameChoices.some((x) => x.id === s.period)) s.period = 'BASE';
  side = 'buy';
  tab = 'position';
  elements('orderType').value = 'market';
  elements('qty').value = '1';
  elements('tp').value = '';
  elements('sl').value = '';
  elements('protection').open = false;
  elements('speed').value = s.speed || '1';
  elements('chartPanel').classList.remove('expanded');
  chart.setTool('crosshair');
  setView('terminal');
  return save();
}
let marketLoad = null;
let periodLoad = null, lastPeriodMarkup = '';
async function switchMarket(id, requestedPeriod) {
  const target = byId(id);
  if (!target || !s) return;
  const display = requestedPeriod || s.feed?.preferredDisplay || effectivePeriod(s.period);
  if (marketLoad?.id === id && marketLoad.display === display) return;
  periodLoad?.controller.abort();
  if (marketLoad) {
    marketLoad.controller.abort();
    if (marketLoad.version === loadVersion) {
      ++loadVersion;
      loadBusy = false;
    }
    marketLoad = null;
  }
  const kind = domestic(id) ? 'future' : 'spot';
  const live = s.live;
  const year = live ? 'auto' : selectedArchiveYear();
  const mainSymbol = kind === 'future' ? watch.get(id)?.quote?.symbol : null;
  const matches = (session) => session.marketId === id && session.feed && !session.feed.anchored &&
    !!session.account.contract === (kind === 'future') && session.live === live &&
    (live ? !mainSymbol || session.account.contract?.symbol === mainSymbol :
      year === 'auto' || String(session.feed.archivePeriod?.year) === year);
  if (matches(s)) {
    render();
    notify('当前已是' + humanName(target.name) + (live ? '最新行情。' : '历史回放。'));
    return;
  }
  const past = [...sessions.values()].filter(matches).sort((a, b) => b.updated - a.updated)[0];
  if (past) {
    await activate(past);
    if (s !== past) return;
    const option = frameChoices.find((item) => effectivePeriod(item.id) === display);
    if (effectivePeriod(s.period) !== display && (option || s.live)) await choosePeriod(option?.id || display);
    else if (s.feed) {
      const wanted = effectivePeriod(s.period) === display ? undefined : display;
      if (s.feed.preferredDisplay !== wanted) {
        s.feed.preferredDisplay = wanted;
        renderMarkets();
        save();
      }
    }
    if (s === past) notify('已恢复' + humanName(target.name) + (live ? '模拟账户。' : '的历史训练。'));
    return;
  }

  const request = { id, display, origin: s, controller: new AbortController(), version: loadVersion + 1 };
  marketLoad = request;
  renderMarkets();
  const name = humanName(target.name);
  notify('正在打开' + name + (live ? '最新行情…' : '历史回放…'));
  const base = ['1D', '1W', '1M', '1Q', '1Y'].includes(display) ? '1D' :
    ['1m', '3m'].includes(display) ? '1m' : '5m';
  const options = { marketId: id, kind, base, period: display === base ? 'BASE' : display, archiveYear: year };
  async function open(useLive) {
    request.version = loadVersion + 1;
    const signal = useLive ? AbortSignal.any([request.controller.signal, AbortSignal.timeout(7000)]) :
      request.controller.signal;
    await startFeed({ ...options, live: useLive, signal });
  }
  const isCurrent = () => marketLoad === request && !request.controller.signal.aborted;
  try {
    try {
      await open(live);
    } catch (error) {
      if (!isCurrent() || request.version !== loadVersion) return;
      if (!live) throw error;
      notify(name + '的最新行情暂不可用，正在打开历史回放…');
      await open(false);
    }
    if (!isCurrent() || s.marketId !== id) return;
    const actual = effectivePeriod(s.period);
    const changed = actual !== display ? ' · ' + (baseNames[baseIDs.indexOf(actual)] || actual) : '';
    notify('已打开' + name + (s.live ? '最新行情' : '历史回放') + changed);
  } catch (error) {
    if (isCurrent() && request.version === loadVersion) notify('未能打开' + name + '：' + error.message);
  } finally {
    if (marketLoad === request) {
      marketLoad = null;
      if (s) renderMarkets();
    }
  }
}
function spark(values, n, id) {
  const min = Math.min(...values),
    span = Math.max(0.01, Math.max(...values) - min);
  const pts = values.map((v, i) => [
    (i * 110) / Math.max(1, values.length - 1),
    33 - ((v - min) / span) * 27,
  ]);
  const path = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2)).join(' ');
  const color = n >= 0 ? 'var(--rise, #c53342)' : 'var(--fall, #128061)';
  return (
    '<svg class="spark" viewBox="0 0 111 40" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="g' +
    id +
    '" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="' +
    color +
    '" stop-opacity=".23"/><stop offset="1" stop-color="' +
    color +
    '" stop-opacity="0"/></linearGradient></defs><path d="' +
    path +
    ' L110 40 L0 40Z" fill="url(#g' +
    id +
    ')"/><path d="' +
    path +
    '" fill="none" stroke="' +
    color +
    '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>'
  );
}
const cardRanges = new Map();
function historicalCard(id, active) {
  const kind = domestic(id) ? 'future' : 'spot';
  const symbol = kind === 'future' ? futuresTerms(id).symbol : byId(id).symbol;
  if (active) {
    const current = bars[s.cursor], previous = bars[s.cursor - 1];
    return {
      symbol: s.feed.symbol, value: number(current.close), stamp: '回放至 ' + fmtTime(current.time, market.timeZone),
      change: previous?.close ? (current.close / previous.close - 1) * 100 : null,
    };
  }
  const display = s.feed?.preferredDisplay || effectivePeriod(s.period), thisYear = new Date().getFullYear();
  const key = [id, display, thisYear, selectedArchiveYear()].join('/');
  if (!cardRanges.has(key)) {
    const catalog = replayCatalog(id, kind, display);
    const years = selectedArchiveYear() === 'auto' ? catalog.years.filter((year) => year < thisYear) : catalog.years;
    const interval = baseNames[baseIDs.indexOf(catalog.base)] || catalog.base;
    cardRanges.set(key, {
      symbol, value: years.length ? years[0] + '–' + years.at(-1) : '—',
      stamp: interval + '历史 · 可选年份', change: null,
    });
  }
  return cardRanges.get(key);
}
function renderMarkets() {
  const ids = ['csi1000', 'csi500', 'ndx', 'csi300'];
  const pending = marketLoad?.origin === s ? marketLoad : null;
  const activeId = pending?.id || s.marketId;
  if (!ids.includes(activeId)) ids[3] = activeId;
  const container = elements('watchlist');
  const historical = !!s.feed && !s.live && !s.feed.anchored;
  $('.watch-caption').textContent = historical ? '历史回放' : '最新报价';
  elements('chartPanel').setAttribute('aria-busy', String(!!pending));
  $('.ticket').inert = !!pending;
  elements('ledgerBody').inert = !!pending;
  const current = new Map([...container.children].map((button) => [button.dataset.market, button]));
  ids.forEach((id, index) => {
    const m = byId(id), item = watch.get(id), quote = item?.quote;
    const loading = pending?.id === id;
    const selected = activeId === id && (pending || !domestic(id) || !!s.account.contract);
    const history = historical ? historicalCard(id, s.marketId === id && (!domestic(id) || !!s.account.contract)) : null;
    const value = history ? history.value : quote ? number(quote.price) : '—';
    const change = history ? history.change : quote?.previousClose ? (quote.price / quote.previousClose - 1) * 100 : null;
    const stamp = loading ? '正在切换到' + humanName(m.name) + '…' : history ? history.stamp : quote
      ? quote.tradeDate +
        (domestic(id) ? ' · ' + quote.symbol + (item.pinned ? ' 收盘快照' : ' · 东方财富') :
          item.pinned ? ' · 收盘快照' : item.dailySource ? ' · 日线 ' + item.dailySource : ' · 指数现货')
      : '等待东方财富行情';
    let button = current.get(id);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.market = id;
      button.className = 'market-card';
    }
    button.classList.toggle('selected', !!selected);
    button.setAttribute('aria-pressed', String(!!selected));
    button.setAttribute('aria-busy', String(loading));
    const content =
      '<span class="card-top"><span class="card-name">' + humanName(m.name) +
      (domestic(id) ? historical ? ' 期货' : ' 主连' : '') + '</span><span class="card-code">' +
      (history?.symbol || (domestic(id) ? futuresTerms(id).continuous : m.symbol)) +
      '</span></span><span class="card-body"><span><span class="card-value">' + value +
      '</span><span class="card-change ' + (change == null ? '' : tone(change)) + '">' +
      (change == null ? historical ? '' : '—' : signed(change) + '%') + '</span></span>' +
      (!historical && item?.values?.length > 1 ? spark(item.values, change ?? 0, id) : '') +
      '</span><span class="market-stamp">' + esc(stamp) + '</span>';
    // Quote refreshes must keep the button under a pressed pointer or keyboard focus.
    if (button.innerHTML !== content) button.innerHTML = content;
    if (container.children[index] !== button) container.insertBefore(button, container.children[index] || null);
  });
  for (const [id, button] of current) if (!ids.includes(id)) button.remove();
}
function baseLabel() {
  return baseNames[baseIDs.indexOf(s.base)] || '原周期';
}
function writeOhlc(bar) {
  if (!bar) return;
  elements('ohlc').innerHTML =
    '<span class="ohlc-time">' +
    esc(fmtTime(bar.time, market.timeZone)) +
    '</span>' +
    [
      ['开', bar.open],
      ['高', bar.high],
      ['低', bar.low],
      ['收', bar.close],
    ]
      .map(
        ([k, v]) =>
          '<span>' + k + ' <b class="' + tone(bar.close - bar.open) + '">' + number(v) + '</b></span>',
      )
      .join('');
}
function applyBoardQuote(session, quote) {
  if (session.feed?.historySource !== '新浪财经') return applyLiveQuote(session, quote);
  // Keep the secondary feed's OHLC intact. Only Eastmoney marks the account.
  const history = session.customBars;
  session.customBars = [];
  try {
    return applyLiveQuote(session, quote);
  } finally {
    session.customBars = history;
  }
}
function sourceTimeForFill(time) {
  const stamp = (x) => (typeof x === 'number' ? x : Date.parse(x) / 1000);
  let lo = 0,
    hi = visible.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (stamp(visible[mid].time) <= stamp(time)) lo = mid + 1;
    else hi = mid;
  }
  return visible[Math.max(0, lo - 1)]?.time ?? time;
}
function renderChart() {
  aggregated = periodBars(visible, s.period, market);
  const a = s.account,
    p = a.position;
  const levels = [];
  if (p.qty) levels.push({ price: p.avgPrice, title: '持仓均价', color: '#a96813' });
  if (p.takeProfit) levels.push({ price: p.takeProfit, title: '止盈', color: '#00876c' });
  if (p.stopLoss) levels.push({ price: p.stopLoss, title: '止损', color: '#c44360' });
  for (const o of a.orders.filter((o) => o.status === 'pending')) {
    if (!o.activated)
      levels.push({
        price: o.price,
        title: ordersText[o.type] + ' ' + (o.side === 'buy' ? '买' : '卖'),
        color: '#5d6b9b',
      });
    if (o.type === 'stopLimit') levels.push({ price: o.limitPrice, title: '执行限价', color: '#526f89' });
  }
  const markers = a.fills.map((f) => ({
    time: executionTime(s.live ? sourceTimeForFill(f.time) : f.time, s.period, aggregated, market),
    side: f.side,
    price: f.price,
  }));
  chart.update(aggregated, {
    marketId: s.id,
    timeframe: s.period === 'BASE' ? s.base : s.period,
    timeZone: market.timeZone,
    type: 'candles',
    indicators: [],
    markers,
    levels,
    drawings: s.drawings[currentDrawingKey()] || [],
    precision: market.precision,
  });
  elements('drawingCount').textContent = (s.drawings[currentDrawingKey()]?.length || 0) + ' 条';
  writeOhlc(aggregated.at(-1));
}
function table(head, rows) {
  return (
    '<div class="table-scroll"><table><thead><tr>' +
    head.map((h) => '<th>' + h + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map((row) => '<tr>' + row.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>'
  );
}
function renderLedger() {
  const a = s.account,
    p = a.position,
    price = markBar().close,
    snap = getSnapshot(a, price);
  const pending = a.orders.filter((o) => o.status === 'pending');
  elements('ledgerTabs').innerHTML = [
    ['position', '当前持仓', p.qty ? 1 : 0],
    ['orders', '委托', pending.length],
    ['fills', '成交', a.fills.length],
  ]
    .map(
      ([k, v, n]) =>
        '<button data-tab="' +
        k +
        '" class="ledger-tab ' +
        (k === tab ? 'active' : '') +
        '">' +
        v +
        '<span class="counter">' +
        n +
        '</span></button>',
    )
    .join('');
  let content;
  if (tab === 'position' && p.qty)
    content = table(
      ['标的', '方向 / 数量', '持仓均价', '浮动盈亏', '止盈 / 止损', '操作'],
      [
        [
          esc(market.name),
          (p.qty > 0 ? '多头' : '空头') + ' / ' + Math.abs(p.qty),
          number(p.avgPrice),
          '<span class="' + tone(snap.unrealized) + '">' + signed(snap.unrealized) + '</span>',
          [p.takeProfit, p.stopLoss].map((v) => (v == null ? '—' : number(v))).join(' / '),
          '<button data-action="protect">修改保护</button><button data-action="closePosition">平仓</button>',
        ],
      ],
    );
  if (tab === 'orders' && a.orders.length)
    content = table(
      ['委托时间', '方向', '类型 / 报价', '数量', '状态', '操作'],
      a.orders
        .slice()
        .reverse()
        .map((o) => [
          esc(fmtTime(o.time, market.timeZone)),
          o.side === 'buy' ? '买入' : '卖出',
          ordersText[o.type] +
            ' / ' +
            (o.price ? number(o.price) : '市价') +
            (o.type === 'stopLimit' ? ' → ' + number(o.limitPrice) : ''),
          o.qty,
          o.status === 'rejected'
            ? orderStatus[o.status] + ' · ' + esc(o.reason)
            : o.status === 'pending' && o.type === 'stopLimit'
              ? o.activated
                ? '已触发 · 待限价'
                : '等待触发'
              : orderStatus[o.status],
          o.status === 'pending' ? '<button data-cancel="' + o.id + '">撤单</button>' : '—',
        ]),
    );
  if (tab === 'fills' && a.fills.length)
    content = table(
      ['成交时间', '方向', '数量', '成交价', '手续费'],
      a.fills
        .slice()
        .reverse()
        .map((f) => [
          esc(fmtTime(f.time, market.timeZone)),
          f.side === 'buy' ? '买入' : '卖出',
          f.qty,
          number(f.price),
          number(f.fee),
        ]),
    );
  elements('ledgerBody').innerHTML =
    content ||
    '<div class="empty">' +
      icon(tab === 'position' ? 'layers' : 'book') +
      (tab === 'position'
        ? '暂无持仓，可在模拟下单面板开始交易'
        : tab === 'orders'
          ? '暂无委托记录'
          : '暂无成交记录') +
      '</div>';
}
function qtyMaximum(fraction) {
  const a = s.account,
    price =
      Number(elements(elements('orderType').value === 'stopLimit' ? 'limitPrice' : 'orderPrice').value) ||
      bars[s.cursor].close,
    mark = markBar().close;
  const ref = elements('orderType').value === 'market' ? mark : price;
  const direction = side === 'buy' ? 1 : -1,
    qty = a.position.qty;
  const closeQty = Math.sign(qty) === -direction ? Math.abs(qty) : 0;
  if (closeQty) return Math.floor(closeQty * fraction);
  const capacity = getSnapshot(a, ref).available;
  const opening =
    a.allowShort || side === 'buy'
      ? Math.max(0, capacity) /
        (ref *
          (a.contract?.multiplier || 1) *
          ((a.contract?.marginRate || 1) + (a.slippageBps * 3 + a.feeBps * 2) / 10000) +
          (a.contract?.tickSize || 0) * (a.contract?.multiplier || 1))
      : 0;
  return Math.floor((closeQty + opening) * fraction);
}
function ticketEstimate() {
  const type = elements('orderType').value,
    price =
      type === 'market'
        ? markBar().close
        : Number(elements(type === 'stopLimit' ? 'limitPrice' : 'orderPrice').value);
  const terms = s.account.contract;
  const qty = Math.max(0, Number(elements('qty').value) || 0);
  const lotValue = Math.max(0, price || 0) * (terms?.multiplier || 1);
  const money = (amount) => number(amount) + ' ' + market.currency;
  elements('notional').textContent = money(qty * lotValue);
  elements('lotValueRow').hidden = !terms;
  elements('marginEstimateRow').hidden = !terms;
  elements('orderMarginRow').hidden = !terms;
  if (terms) {
    const position = s.account.position.qty;
    const closing = side === 'buy' ? Math.max(0, -position) : Math.max(0, position);
    const openingLots = Math.max(0, qty - closing);
    elements('lotValue').textContent = money(lotValue);
    elements('marginEstimate').textContent = money(lotValue * terms.marginRate);
    elements('orderMargin').textContent = money(openingLots * lotValue * terms.marginRate);
  }
}
function renderTicket() {
  const price = markBar().close,
    snap = getSnapshot(s.account, price);
  elements('equity').textContent = number(snap.equity);
  elements('available').textContent = number(snap.available) + ' ' + market.currency;
  for (const [id, val] of [
    ['liveUnrealized', snap.unrealized],
    ['liveRealized', snap.realized],
    ['liveTotalPnl', snap.pnl],
  ]) {
    const out = elements(id),
      n = Math.abs(val) < 0.005 ? 0 : val;
    out.textContent = n ? signed(n) : '0.00';
    out.className = n ? tone(n) : '';
  }
  const pos = s.account.position,
    terms = s.account.contract;
  elements('quickClose').disabled = !pos.qty;
  elements('qtyUnit').textContent = unitName();
  elements('positionSummary').textContent = pos.qty
    ? (pos.qty > 0 ? '多头 ' : '空头 ') +
      Math.abs(pos.qty) +
      ' ' +
      unitName() +
      ' · 均价 ' +
      number(pos.avgPrice)
    : '当前空仓';
  const marginRate = terms?.marginRate ?? 1;
  const percent = (rate) => Number((rate * 100).toFixed(2)) + '%';
  elements('contractInfo').hidden = false;
  elements('marginRateLabel').textContent = terms ? '开仓保证金率' : '资金占用比例';
  elements('contractMarginRate').textContent = percent(marginRate);
  elements('leverageLabel').textContent = terms ? '合约杠杆' : '交易倍数';
  elements('contractLeverage').textContent = number(1 / marginRate) + '×';
  elements('accountLeverage').textContent = snap.equity <= 0 && pos.qty ? '—' : number(snap.leverage) + '×';
  const termsNote = elements('contractTermsNote');
  termsNote.hidden = !terms;
  if (terms) {
    const meta = s.feed?.contract || terms;
    const exchangeRate = terms.exchangeMarginRate ?? meta.exchangeMarginRate;
    const date = meta.marginAsOf || meta.asOf;
    const source = (url, label) =>
      url
        ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>'
        : esc(label);
    termsNote.innerHTML =
      '<strong>' +
      esc(terms.symbol) +
      '</strong> · 每手每点 ' +
      number(terms.multiplier, 0) +
      ' 元 · 每跳 ' +
      number(terms.tickSize * terms.multiplier, 0) +
      ' 元（' +
      terms.tickSize +
      ' 点）<br>' +
      '已占保证金 ' +
      number(snap.marginUsed) +
      ' 元<br>' +
      source(meta.marginSourceUrl, '东财客户参考标准') +
      (Number.isFinite(exchangeRate)
        ? ' · ' + source(meta.exchangeMarginSourceUrl, '交易所参考 ' + percent(exchangeRate))
        : '') +
      (date ? ' · ' + esc(date) : '');
  }
  elements('currency').textContent = market.currency;
  elements('buy').classList.toggle('active', side === 'buy');
  elements('sell').classList.toggle('active', side === 'sell');
  elements('sell').textContent = s.account.allowShort ? '卖出 / 做空' : '卖出';
  elements('submitOrder').textContent = side === 'buy' ? '模拟买入' : '模拟卖出';
  elements('submitOrder').classList.toggle('sell', side === 'sell');
  elements('feeHint').textContent =
    '手续费 ' + s.account.feeBps + ' bp　·　滑点 ' + s.account.slippageBps + ' bp';
  elements('limitField').hidden = elements('orderType').value !== 'stopLimit';
  elements('priceField').hidden = elements('orderType').value === 'market';
  elements('priceLabel').textContent = elements('orderType').value === 'limit' ? '限价' : '触发价';
  elements('fractions').innerHTML = [25, 50, 75, 100]
    .map((n) => '<button data-fraction="' + n + '">' + n + '%</button>')
    .join('');
  ticketEstimate();
}
function renderPlay() {
  if (!s) return;
  const atEnd = s.cursor === bars.length - 1;
  for (const node of [
    elements('play'),
    $('[data-action="step"]'),
    elements('speed'),
    elements('progressBlock'),
  ])
    node.hidden = !!s.live;
  elements('feedMeta').hidden = !s.live && !s.feed?.anchored;
  if (s.feed?.anchored)
    elements('feedMeta').innerHTML =
      '实际收盘 ' +
      number(s.feed.anchorPrice) +
      ' · <a href="' +
      esc(s.feed.quoteUrl) +
      '" target="_blank" rel="noopener">' +
      esc(s.feed.tradeDate) +
      ' 东方财富</a><br>其余走势为模拟生成';
  elements('randomBtn').disabled = loadBusy || randomBusy || (bars.length < 3 && !s.feed);
  elements('randomLabel').textContent = randomBusy ? '抽取中…' : '随机时段';
  const clock = elements('trainingClock');
  clock.hidden = s.live;
  if (!s.live && bars[s.cursor]) {
    const date = marketDay(bars[s.cursor].time, s.marketId);
    const remaining = Math.max(0, activeDays.length - 1 - activeDays.indexOf(date));
    clock.textContent = '回放 ' + fmtTime(bars[s.cursor].time, market.timeZone) + '　·　后续 ' + remaining + ' 个交易日';
  }
  if (s.live)
    elements('feedMeta').innerHTML =
      (s.account.contract ? '公开行情或延时15分钟 · ' : '') +
      (refreshIssue ? esc(refreshIssue) + ' · ' : '') +
      (s.feed.limitedPeriod === effectivePeriod(s.period) ? '按现有样本合成 · ' : '') +
      (s.feed.quoteOnly ? '仅有当日行情 · ' : s.feed.historyCached ? '使用本机历史缓存 · ' : '') +
      '报价 ' +
      esc(fmtTime(s.liveQuote.time, market.timeZone)) +
      ' · <a href="' +
      esc(s.feed.quoteUrl) +
      '" target="_blank" rel="noopener">东方财富</a>';
  elements('play').innerHTML = icon(timer ? 'pause' : 'play', 16);
  elements('play').setAttribute('aria-label', timer ? '暂停' : '播放');
  elements('play').disabled = atEnd;
  $('[data-action="step"]').disabled = atEnd;
  elements('replayText').textContent = atEnd ? '回放结束' : timer ? '回放中' : '回放进度';
  const total = bars.length - s.start - 1,
    done = s.cursor - s.start;
  elements('progressNum').textContent = done + ' / ' + total;
  elements('progress').value = total > 0 ? (done / total) * 100 : 100;
}
function render() {
  visible = bars.slice(0, s.cursor + 1);
  const b = visible.at(-1),
    prev = visible.at(-2) || b,
    delta = b.close - prev.close;
  const quote = s.live ? s.liveQuote : null;
  const reference = quote?.previousClose || prev.close;
  const shownPrice = quote?.price || b.close,
    difference = shownPrice - reference;
  elements('modeBadge').textContent = s.feed
    ? s.feed.anchored
      ? '收盘价推演 · 模拟走势'
      : s.live
        ? '最新行情 · 模拟交易'
        : '真实历史回放'
    : s.customBars
      ? 'CSV 历史回放'
      : '模拟生成行情';
  elements('todayBtn').textContent = loadBusy ? '正在取行情…' : s.live ? '刷新报价' : '今日行情';
  elements('todayBtn').disabled = loadBusy;
  const main =
    domestic(s.marketId) &&
    s.live &&
    s.account.contract &&
    watch.get(s.marketId)?.quote.symbol === s.account.contract.symbol;
  elements('instrumentName').textContent = main
    ? humanName(byId(s.marketId).name) + ' 主连'
    : humanName(market.name);
  elements('region').textContent = market.region;
  elements('instrumentCode').textContent =
    market.exchange +
    ' · ' +
    market.symbol +
    ' / ' +
    market.currency +
    (s.feed
      ? ' · ' +
        (s.feed.anchored
          ? s.feed.tradeDate + ' 收盘基准'
          : (s.live ? '报价 东方财富 · ' : '') + 'K线 ' + (s.feed.historySource || '东方财富'))
      : s.simulationReference
        ? ' · 基准 ' +
          s.simulationReference.symbol +
          ' · ' +
          s.simulationReference.tradeDate +
          ' · ' +
          number(s.simulationReference.price) +
          ' 点'
        : domestic(s.marketId) && !s.account.contract
          ? ' · 指数现货练习（1×）'
          : '');
  elements('quotePrice').textContent = number(shownPrice);
  elements('quoteChange').textContent =
    signed(difference) + ' (' + signed((difference / reference) * 100) + '%)';
  elements('quoteChange').className = tone(difference);
  renderPeriods();
  renderChart();
  renderMarkets();
  renderTicket();
  renderPlay();
  renderLedger();
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  renderPlay();
}
function step() {
  if (s.live || s.cursor >= bars.length - 1) {
    stop();
    return;
  }
  const previous = s.account.fills.length;
  const until = nextDisplayCursor(bars, s.cursor, s.period, market);
  while (s.cursor < until) {
    advanceBar(s.account, bars[s.cursor + 1]);
    s.cursor++;
  }
  if (s.cursor === bars.length - 1) stop();
  render();
  save();
  if (s.account.fills.length > previous) notify('已撮合 ' + (s.account.fills.length - previous) + ' 笔成交');
}
function play() {
  if (timer) {
    stop();
    return;
  }
  if (s.live || s.cursor === bars.length - 1) return;
  timer = setInterval(step, 1100 / Number(s.speed || 1));
  renderPlay();
}
function setView(next) {
  stop();
  cleanJournal?.();
  cleanJournal = null;
  view = next;
  elements('terminal').hidden = next !== 'terminal';
  elements('journal').hidden = next !== 'journal';
  for (const item of all('nav .nav')) {
    item.classList.toggle('active', item.dataset.action === next);
    item.setAttribute('aria-current', item.dataset.action === next ? 'page' : 'false');
  }
  if (next === 'terminal') render();
  else {
    elements('chartPanel').classList.remove('expanded');
    const archives = [...sessions.values()]
      .filter((n) => n.id !== s.id)
      .sort((a, b) => b.updated - a.updated)
      .map((n) => ({
        id: n.id,
        label: n.customName || (n.base === '1D' ? '日线' : n.base) + '训练',
        marketName: displayMarket(n).name,
        date: new Date(n.updated).toISOString().slice(0, 10),
        returnPct: getSnapshot(n.account, n.account.lastPrice).returnPct,
      }));
    cleanJournal = renderJournal(elements('journal'), {
      session: s,
      market,
      bars: visible,
      bar: s.live ? { ...bars[s.cursor], close: markBar().close, time: markBar().time } : bars[s.cursor],
      onSave: async () => {
        if (!(await save())) throw Error('笔记尚未写入浏览器存储');
      },
      onRetry: () => {
        restartAt(s.live ? Math.max(0, bars.length - 61) : s.start);
        notify('已从相同数据重新开始，原训练已存档');
      },
      onBack: () => setView('terminal'),
      onRestore: (id) => {
        const chosen = sessions.get(id);
        if (!chosen) return;
        chosen.historicalHome = true;
        activate(chosen);
      },
      archives,
    });
  }
}
const dialog = elements('dialog');
function sessionConfig() {
  const a = s.account;
  return {
    marketId: s.marketId,
    kind: s.instrumentKind,
    simulationReference: s.simulationReference,
    base: s.base,
    seed: s.seed,
    customBars: s.customBars,
    customName: s.customName,
    feed: s.feed,
    period: s.period,
    scenarioId: s.scenarioId || s.id,
    initialCash: a.initialCash,
    // Older sessions stored the amount but did not record whether it was user-entered.
    customCapital: s.customCapital ?? (a.initialCash !== (a.contract ? 1_000_000 : 100_000)),
    contract: a.contract,
    feeBps: a.feeBps,
    slippageBps: a.slippageBps,
    allowShort: a.allowShort,
  };
}
function restartAt(startIndex, cfg = sessionConfig()) {
  // Replay keeps an immutable copy of the series at the instant of the jump.
  if (cfg.customBars) cfg.customBars = structuredClone(cfg.customBars);
  const next = makeSession({ ...cfg, startIndex });
  next.speed = s.speed;
  return activate(next);
}
// Calendar days are compared across chart intervals and across prior sessions.
const dayFormatters = new Map();
function marketDay(time, marketId) {
  if (typeof time === 'string') return time.slice(0, 10);
  const zone = byId(marketId).timeZone;
  if (!dayFormatters.has(zone)) {
    dayFormatters.set(zone, new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }));
  }
  return dayFormatters.get(zone).format(time * 1000);
}
function practiceHistory(marketId, kind) {
  return [...sessions.values()].filter((session) => session.marketId === marketId && !session.live &&
    session.feed && !session.feed.anchored && Boolean(session.account.contract) === (kind === 'future'));
}
function chooseStart(series, marketId, history, options = {}) {
  const day = (time) => marketDay(time, marketId);
  const spans = [];
  for (const prior of history) {
    const rows = prior.customBars || (prior.scenarioId === s?.scenarioId ? series : null);
    if (rows?.[prior.start] && rows[prior.cursor]) spans.push([day(rows[prior.start].time), day(rows[prior.cursor].time)]);
  }
  return pickRandomStart({ length: series.length, blockedRanges: visitedBarRanges(series, spans, day), ...options });
}
let preferredYear = 'auto';
try { preferredYear = localStorage.getItem('wavelab-replay-year') || 'auto'; } catch {}
function selectedArchiveYear() { return preferredYear; }
function setArchiveYear(value) {
  preferredYear = /^\d{4}$/.test(value) ? value : 'auto';
  try { localStorage.setItem('wavelab-replay-year', preferredYear); } catch {}
}
function renderYearPicker() {
  const field = elements('archiveYear');
  field.hidden = s.base === 'CSV';
  if (field.hidden) return;
  const {years} = replayCatalog(s.marketId, s.instrumentKind, effectivePeriod(s.period));
  const choices = ['<option value="auto">往年随机</option>',
    ...[...years].reverse().map((year) => '<option value="' + year + '">' + year + ' 年</option>')].join('');
  if (field.dataset.choices !== choices) { field.innerHTML = choices; field.dataset.choices = choices; }
  if (!years.includes(Number(preferredYear))) setArchiveYear('auto');
  field.value = preferredYear;
}
function readReplayArchive(marketId, kind, display, isCurrent, year = selectedArchiveYear(), signal) {
  return readHistoricalPeriod(marketId, kind, display, year, practiceHistory(marketId, kind), isCurrent, signal);
}
// Keep the clock tied to the replay cursor even when the crosshair is elsewhere.
function tradingDates(rows, marketId) {
  const days = [], indices = [];
  let previous;
  for (let i = 0; i < rows.length; i++) {
    const date = marketDay(rows[i].time, marketId);
    if (date !== previous) { days.push(date); indices.push(i); previous = date; }
  }
  return { days, indices };
}
function longRunBounds(dataset, marketId) {
  const { days, indices } = tradingDates(dataset.bars, marketId);
  const year = dataset.requestedYear;
  let first = 0, last = days.length - 1;
  if (year) {
    first = days.findIndex((d) => Number(d.slice(0, 4)) === year);
    if (first < 0) throw Error('该样本缺少所选年份的交易日');
    while (Number(days[last].slice(0, 4)) !== year) last--;
  }
  // Draw early in the actual available trading days, including shortened
  // sessions and holidays. With 100 trading days, at least 74 full days remain.
  const upperDay = Math.min(last, first + Math.floor((days.length - first - 1) / 4));
  return { earliestStart: indices[first], latestStart: (indices[upperDay + 1] ?? dataset.bars.length - 1) - 1 };
}
function replaySession(config, dataset, display) {
  const { marketId, kind } = config;
  const contract = dataset.contract ? { ...dataset.contract, maintenanceRate: dataset.contract.exchangeMarginRate } : null;
  const history = practiceHistory(marketId, kind);
  const period = dataset.display || display;
  return makeSession({
    marketId, kind, base: dataset.base, period: dataset.base === period ? 'BASE' : period,
    customBars: dataset.bars, contract, startIndex: chooseStart(dataset.bars, marketId, history, longRunBounds(dataset, marketId)),
    initialCash: config.initialCash, customCapital: config.customCapital, feeBps: config.feeBps,
    slippageBps: config.slippageBps, allowShort: config.allowShort,
    feed: {
      kind, symbol: dataset.symbol, name: dataset.name, historySource: dataset.historySource,
      preferredDisplay: period === display ? undefined : display,
      quoteUrl: dataset.sourceUrl, tradeDate: dataset.tradeDate, contract,
      archivePeriod: dataset.archivePeriod, archiveYears: dataset.archiveYears, requestedYear: dataset.requestedYear, historyCached: !!dataset.historyCached,
    },
  });
}
async function randomPeriod() {
  if (randomBusy || loadBusy) return;
  stop();
  const original = s, group = s.scenarioId || s.id;
  const version = ++loadVersion;
  const isCurrent = () => s === original && version === loadVersion;
  randomBusy = version;
  renderPlay();
  try {
    const cfg = sessionConfig();
    if (!cfg.customCapital) cfg.initialCash = DEFAULT_INITIAL_CASH;
    const display = effectivePeriod(s.period);
    if (s.base !== 'CSV') {
      const archive = await readReplayArchive(s.marketId, cfg.kind, display, isCurrent);
      if (!isCurrent()) return;
      if (!archive) {
        notify('所选历史时段未能载入，可换一个年份重试。');
        return;
      }
      const next = replaySession(cfg, archive, display);
      await activate(next);
      if (s === next) notify('已跳至 ' + fmtTime(bars[s.cursor].time, market.timeZone) + ' · ' + market.symbol +
        (archive.display !== display ? ' · 该年份提供日线' : ''));
      return;
    }
    if (bars.length < 3) {
      notify('此周期暂时没有足够的历史 K 线。可切换周期后再抽取。');
      return;
    }
    const related = [...sessions.values()].filter((other) => (other.scenarioId || other.id) === group);
    const prior = s.feed && !s.feed.anchored ? practiceHistory(s.marketId, cfg.kind) : related;
    const start = chooseStart(bars, s.marketId, prior, {
      currentIndex: s.cursor, previousStart: s.start, blockedStarts: related.map((other) => other.start),
    });
    await restartAt(start, cfg);
    notify('已跳至 ' + fmtTime(bars[s.cursor].time, market.timeZone) + ' · 本段行情内抽取');
  } catch (error) {
    if (isCurrent()) notify('抽取未完成：' + error.message);
  } finally {
    if (randomBusy === version) { randomBusy = false; renderPlay(); }
  }
}
const shortcuts = ['5m', '30m', '1D'];
function effectivePeriod(p) {
  return p === 'BASE' ? s.base : p;
}
function renderPeriods() {
  renderYearPicker();
  const options = s.live
    ? baseIDs.map((id, i) => ({ id: id === s.base ? 'BASE' : id, label: baseNames[i] }))
    : frameChoices;
  const highlighted = options.find((o) => o.id === s.period);
  const buttons = shortcuts.map((id) => {
    const label = baseNames[baseIDs.indexOf(id)];
    // A CSV's native interval has the internal id BASE but exposes the inferred label.
    const option = options.find((o) => o.label === label);
    const active = !!option && option.id === s.period;
    const state = option ? 'data-period="' + option.id + '"' : s.feed
      ? 'data-unavailable-period="' + label + '" title="查看这个周期的行情范围"'
      : 'disabled title="原始行情不支持此周期"';
    return (
      '<button ' +
      state +
      ' aria-pressed="' +
      active +
      '" class="' +
      (active ? 'active' : '') +
      '">' +
      label +
      (periodLoad?.session === s && periodLoad.display === id ? '…' : '') +
      '</button>'
    );
  });
  const showExtra =
    highlighted && !shortcuts.some((id) => baseNames[baseIDs.indexOf(id)] === highlighted.label);
  const select =
    '<select id="allPeriods" aria-label="所有K线周期"><option value="">更多周期</option>' +
    options
      .map(
        (o) =>
          '<option value="' +
          o.id +
          '"' +
          (showExtra && o.id === s.period ? ' selected' : '') +
          '>' +
          o.label +
          '</option>',
      )
      .join('') +
    '</select>';
  const markup = buttons.join('') + select;
  if (lastPeriodMarkup !== markup) {
    lastPeriodMarkup = markup;
    elements('periodButtons').innerHTML = markup;
  } else {
    const field = elements('allPeriods');
    const value = showExtra ? s.period : '';
    if (field.value !== value) field.value = value;
  }
}
function currentDrawingKey(period = s.period) {
  return s.live ? 'live:' + effectivePeriod(period) : period;
}
async function choosePeriod(period) {
  if (marketLoad?.origin === s) {
    await switchMarket(marketLoad.id, effectivePeriod(period));
    return;
  }
  if (loadBusy) {
    renderPeriods();
    notify('正在读取新行情，载入后即可切换周期。');
    return;
  }
  const instance = s;
  const desired = effectivePeriod(period);
  if (s.feed) delete s.feed.preferredDisplay;
  const version = ++loadVersion;
  periodLoad?.controller.abort();
  periodLoad = null;
  try {
    // For the live board ask for native historical depth at the requested resolution.
    // A replay always stays on the same instrument, dataset, and cursor.
    if (s.live) {
      let source =
        { '3m': '1m', '10m': '5m', '2H': '1H', '4H': '1H', '1W': '1D', '1M': '1D', '1Q': '1D', '1Y': '1D' }[
          desired
        ] || desired;
      if (['5m', '10m', '15m', '30m', '1H', '2H', '4H'].includes(desired) && s.base === '5m') source = '5m';
      if (source !== s.base) {
        const controller = new AbortController();
        periodLoad = { session: s, display: desired, version, controller };
        const available = frameChoices.find((o) => effectivePeriod(o.id) === desired);
        if (available) {
          s.period = available.id;
          chart.setTool('crosshair');
          render();
          save();
        } else {
          renderPeriods();
        }
        notify('正在读取' + (baseNames[baseIDs.indexOf(desired)] || desired) + '行情…');
        const feed = await loadChartFeed(s.marketId, source, {
          contract: s.feed.kind === 'future' ? s.feed.symbol : 'index',
          limit: source === '1D' ? 5000 : 720,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (version !== loadVersion || s !== instance || !s.live) return;
        if (feed.bars.length < 2) throw Error('此周期可用的历史行情不足。');
        rememberHistory(s.marketId, source, feed);
        const oldStartTime = bars[s.start]?.time;
        s.base = source;
        s.customBars = feed.bars;
        s.feed.quoteOnly = false;
        s.feed.historyCached = false;
        s.feed.historySource = feed.historySource || '东方财富';
        const latest = s.liveQuote.time > feed.quote.time ? s.liveQuote : feed.quote;
        applyBoardQuote(s, latest);
        bars = s.customBars;
        s.cursor = bars.length - 1;
        // Account history stays intact even when the displayed base changes.
        s.start = Math.min(
          s.cursor,
          Math.max(
            0,
            bars.findIndex((b) => b.time === oldStartTime),
          ),
        );
        frameChoices = timeframeOptions(source, bars, market.region);
      }
      delete s.feed.limitedPeriod;
      s.period = desired === s.base ? 'BASE' : desired;
    } else {
      if (!frameChoices.some((x) => x.id === period)) return;
      s.period = period;
    }
    chart.setTool('crosshair');
    render();
    save();
  } catch (err) {
    if (s !== instance || version !== loadVersion) return;
    const available = frameChoices.find((o) => effectivePeriod(o.id) === desired);
    if (s.live && available) {
      s.period = available.id;
      s.feed.limitedPeriod = desired;
      chart.setTool('crosshair');
      render();
      save();
      notify('已按当前已有的 ' + bars.length + ' 根' + baseLabel() + ' K 线合成。');
    } else {
      renderPeriods();
      notify((baseNames[baseIDs.indexOf(desired)] || desired) + '行情暂不可用。');
    }
  } finally {
    if (periodLoad?.version === version) {
      periodLoad = null;
      renderPeriods();
    }
  }
}
function openAnchor({
  marketId = 'csi1000',
  kind = 'future',
  base = '5m',
  initialCash,
  feeBps,
  slippageBps,
  allowShort,
}) {
  const desired = base;
  base = '1m';
  const data = anchoredScenario(marketId, { base, kind: kind === 'future' ? 'future' : 'index', deep: true });
  const feed = {
    kind,
    anchored: true,
    anchorPrice: data.quote.price,
    symbol: data.symbol,
    name: data.name,
    quoteUrl: data.quoteUrl,
    tradeDate: data.quote.tradeDate,
    contract: data.contract,
  };
  const config = {
    marketId,
    base,
    period: desired === base ? 'BASE' : desired,
    feed,
    customBars: data.bars,
    startIndex: data.startIndex,
    contract: data.contract,
    initialCash,
    feeBps,
    slippageBps,
    allowShort,
  };
  return activate(makeSession(config));
}
const historyStore = 'wavelab-public-candle-cache';
let candleCache = [];
try {
  candleCache = JSON.parse(localStorage.getItem(historyStore) || '[]');
  if (!Array.isArray(candleCache)) candleCache = [];
} catch {}
function rememberHistory(marketId, base, d) {
  if (!d?.bars?.length || d.bars.length < 4) return;
  const key = [marketId, d.symbol, base].join('/');
  const old = candleCache.find((x) => x.key === key);
  if (
    old &&
    old.last === d.bars.at(-1).time &&
    old.close === d.bars.at(-1).close &&
    old.bars.length >= d.bars.length
  )
    return;
  candleCache = [
    {
      key,
      last: d.bars.at(-1).time,
      close: d.bars.at(-1).close,
      bars: d.bars.slice(-720),
      historySource: d.historySource || '东方财富',
    },
    ...candleCache.filter((x) => x.key !== key),
  ].slice(0, 14);
  try {
    localStorage.setItem(historyStore, JSON.stringify(candleCache));
  } catch {}
}
function cachedBars(marketId, base, symbol) {
  const key = [marketId, symbol, base].join('/');
  const cached = candleCache.find((x) => x.key === key);
  if (cached) return cached;
  const old = [...sessions.values()].find(
    (x) =>
      x.marketId === marketId &&
      x.feed?.symbol === symbol &&
      !x.feed.anchored &&
      !x.feed.quoteOnly &&
      x.base === base &&
      x.customBars?.length > 3,
  );
  return old ? { bars: old.customBars, historySource: old.feed.historySource || '东方财富' } : null;
}
async function startFeed({
  marketId,
  base = '5m',
  period = 'BASE',
  kind = 'future',
  live = true,
  archiveYear = selectedArchiveYear(),
  signal,
  initialCash,
  feeBps = 3,
  slippageBps = 2,
  allowShort = true,
}) {
  const version = ++loadVersion;
  loadBusy = true;
  elements('todayBtn').textContent = '正在取行情…';
  elements('todayBtn').disabled = true;
  stop();
  try {
    if (!live) {
      const desired = period === 'BASE' ? base : period;
      const current = () => loadVersion === version && !signal?.aborted;
      const archived = await readReplayArchive(marketId, kind, desired, current, archiveYear, signal);
      signal?.throwIfAborted();
      if (!current()) return;
      if (!archived) throw Error('所选历史时段暂不可用，请换一个年份重试。');
      const next = replaySession({ marketId, kind, initialCash, feeBps, slippageBps, allowShort }, archived, desired);
      await activate(next);
      if (s === next && archived.display !== desired) notify('该市场所选历史年份提供日线，已打开同一指数的日线回放。');
      return;
    }
    const request = {
      contract: kind === 'future' ? 'active' : 'index',
      limit: base === '1D' ? 5000 : 720,
      signal,
    };
    let dataset,
      quoteOnly = false,
      desiredBase = base;
    try {
      dataset = await loadChartFeed(marketId, base, request);
      signal?.throwIfAborted();
      rememberHistory(marketId, base, dataset);
      if (dataset.bars.length < 3) throw Error('此周期可用行情不足，请选择其他周期。');
    } catch (err) {
      signal?.throwIfAborted();
      const q = await fetchEastmoneyQuote(marketId, request);
      signal?.throwIfAborted();
      const cached = cachedBars(marketId, base, q.symbol);
      if (cached) {
        dataset = {
          quote: q,
          name: q.name,
          symbol: q.symbol,
          tradeDate: q.tradeDate,
          quoteUrl: q.quoteUrl,
          contract: q.contract,
          bars: structuredClone(cached.bars),
          historySource: cached.historySource,
          historyCached: true,
        };
      } else {
        let daily;
        if (kind !== 'future' && base !== '1D') {
          try {
            daily = await loadChartFeed(marketId, '1D', { ...request, limit: 5000 });
          } catch { signal?.throwIfAborted(); }
        }
        if (daily?.bars.length >= 30) {
          base = '1D';
          dataset = daily;
          rememberHistory(marketId, base, daily);
        } else {
          if (![q.open, q.high, q.low].every((v) => Number.isFinite(v) && v > 0)) throw err;
          quoteOnly = true;
          base = '1D';
          dataset = {
            quote: q,
            name: q.name,
            symbol: q.symbol,
            tradeDate: q.tradeDate,
            quoteUrl: q.quoteUrl,
            contract: q.contract,
            bars: [
              {
                time: q.tradeDate,
                open: q.open,
                high: Math.max(q.high, q.open, q.price),
                low: Math.min(q.low, q.open, q.price),
                close: q.price,
                volume: q.volume || 0,
              },
            ],
          };
        }
      }
    }
    signal?.throwIfAborted();
    if (version !== loadVersion) return;
    if (kind === 'future' && dataset.quote) watch.set(marketId, { quote: dataset.quote });
    const contract = dataset.contract
      ? { ...dataset.contract, maintenanceRate: dataset.contract.exchangeMarginRate }
      : undefined;
    const feed = {
      kind,
      quoteOnly,
      desiredBase,
      historySource: dataset.historySource || '东方财富',
      historyCached: !!dataset.historyCached,
      symbol: dataset.symbol,
      name: dataset.name,
      quoteUrl: dataset.quoteUrl,
      tradeDate: dataset.tradeDate,
      contract,
    };
    const startIndex = dataset.bars.length - 1;
    const next = makeSession({
      marketId,
      base,
      period,
      customBars: dataset.bars,
      feed,
      live,
      quote: dataset.quote,
      contract,
      startIndex,
      initialCash,
      feeBps,
      slippageBps,
      allowShort,
    });
    await activate(next);
  } finally {
    if (version === loadVersion || !loadBusy) {
      loadBusy = false;
      elements('todayBtn').disabled = false;
      if (s) renderPlay();
      elements('todayBtn').textContent = s?.live ? '刷新报价' : '今日行情';
    }
  }
}
async function refreshLive(manual = false) {
  if (!s?.live || quoteBusy) return;
  const instance = s,
    sourceBase = s.base;
  quoteBusy = true;
  try {
    const options = { contract: s.feed.kind === 'future' ? s.feed.symbol : 'index' };
    // Refresh actual candles after a suspended tab or a trading-day change.

    const full = manual || !s.lastHistoryFetch || Date.now() - s.lastHistoryFetch > 90000;
    let data = null;
    const requestBase = s.feed.quoteOnly ? s.feed.desiredBase : sourceBase;
    if (full) {
      try {
        data = await loadChartFeed(s.marketId, requestBase, {
          ...options,
          limit: requestBase === '1D' ? 5000 : 720,
        });
      } catch {}
    }

    const q = data?.quote || (await fetchEastmoneyQuote(s.marketId, options));
    if (s !== instance || s.base !== sourceBase) return;
    const result = applyBoardQuote(s, q);
    if (result.changed && s.markHistory && s.markHistory.at(-1)?.time !== s.account.lastTime)
      s.markHistory.push({ time: s.account.lastTime, price: s.account.lastPrice });
    if (data && q.time >= s.liveQuote.time) {
      s.customBars = data.bars;
      s.lastHistoryFetch = Date.now();
      rememberHistory(s.marketId, requestBase, data);
      s.feed.historyCached = false;
      s.feed.historySource = data.historySource || '东方财富';
      if (s.feed.quoteOnly && data.bars.length > 1) {
        s.base = requestBase;
        s.period = 'BASE';
        s.feed.quoteOnly = false;
        frameChoices = timeframeOptions(s.base, s.customBars, market.region);
      }
    } else if (full) {
      s.lastHistoryFetch = Date.now();
    }
    bars = s.customBars;
    s.cursor = bars.length - 1;
    s.feed.tradeDate = s.liveQuote.tradeDate;
    refreshIssue = '';
    if (view === 'terminal') render();
    else if (result.changed) setView('journal');
    if (result.changed || data) save();
    if (manual) notify('已核对东方财富报价 · ' + fmtTime(s.liveQuote.time, market.timeZone));
  } catch (err) {
    if (s === instance) {
      refreshIssue = '报价更新失败，保留上次报价';
      if (view === 'terminal') renderPlay();
      if (manual) notify(err.message);
    }
  } finally {
    quoteBusy = false;
  }
}
let lastWatch = 0;
async function refreshWatch() {
  if (s?.feed && !s.live && !s.feed.anchored) return;
  if (Date.now() - lastWatch < 60000) return;
  lastWatch = Date.now();
  const wanted = MARKETS.filter((m) => ['csi1000', 'csi500', 'ndx', 'csi300', s?.marketId].includes(m.id));
  for (const m of wanted) {
    try {
      const old = watch.get(m.id);
      if (domestic(m.id)) {
        const quote = await fetchEastmoneyQuote(m.id, { contract: 'active' });
        watch.set(m.id, { quote });
      } else if (old?.values?.length && !old.dailySource) {
        const quote = await fetchEastmoneyQuote(m.id, { contract: 'index' });
        watch.set(m.id, { quote, values: [...old.values.slice(0, -1), quote.price] });
      } else {
        const d = await loadChartFeed(m.id, '1D', { contract: 'index', limit: 38, historyOnly: true });
        const last = d.bars.at(-1);
        const quote = d.quote || {
          price: last.close,
          previousClose: d.bars.at(-2)?.close,
          tradeDate: last.time,
        };
        if (!old?.quote || quote.tradeDate >= old.quote.tradeDate) {
          watch.set(m.id, {
            quote,
            values: d.bars.map((b) => b.close),
            dailySource: d.quote ? '' : d.historySource,
          });
        }
      }
      if (s && view === 'terminal') renderMarkets();
    } catch {}
  }
  try {
    localStorage.setItem(watchStore, JSON.stringify([...watch]));
  } catch {}
}
document.addEventListener('change', (event) => {
  if (event.target.id === 'allPeriods' && event.target.value) choosePeriod(event.target.value);
  if (event.target.id === 'archiveYear' && s) {
    setArchiveYear(event.target.value);
    // A second choice while a jump is loading supersedes the first choice.
    if (randomBusy) { ++loadVersion; randomBusy = false; }
    randomPeriod();
  }
});
setInterval(() => {
  if (!document.hidden && s) {
    refreshLive();
    refreshWatch();
  }
}, 15000);
function show(title, html) {
  stop();
  elements('dialogTitle').textContent = title;
  elements('dialogBody').innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
const dial = { show, close: () => dialog.close(), notify };
function context() {
  return {
    market,
    session: s,
    markets: MARKETS,
    onNew: (config) => {
      if (config.kind === 'future') {
        config.contract = futuresTerms(config.marketId);
        if (!config.customBars) {
          const quote = watch.get(config.marketId).quote;
          config.simulationReference = {
            symbol: quote.symbol,
            tradeDate: quote.tradeDate,
            price: quote.price,
            tickSize: config.contract.tickSize,
            index: config.startIndex,
          };
        }
      }
      return activate(makeSession(config));
    },
    onSwitch: switchMarket,
    onFeed: startFeed,
    onJournal: () => setView('journal'),
  };
}
function submit() {
  const qty = Number(elements('qty').value);
  if (!Number.isSafeInteger(qty) || qty < 1) throw Error('请输入正整数交易数量');
  const type = elements('orderType').value,
    order = { side, type, qty };
  if (type !== 'market') order.price = Number(elements('orderPrice').value);
  if (type === 'stopLimit') order.limitPrice = Number(elements('limitPrice').value);
  if (elements('protection').open) {
    if (elements('tp').value) order.takeProfit = Number(elements('tp').value);
    if (elements('sl').value) order.stopLoss = Number(elements('sl').value);
  }
  const result = placeOrder(s.account, order, markBar());
  tab = type === 'market' ? 'position' : 'orders';
  render();
  save();
  notify(
    result.status === 'filled'
      ? '已模拟成交 ' + result.filledQty + ' ' + unitName() + '，成交价 ' + number(result.fillPrice)
      : '委托已提交，下一根 K 线起撮合',
  );
}
function editProtection() {
  const p = s.account.position;
  show(
    '持仓保护',
    '<form id="editProtection"><div class="twocol"><label class="field"><span>止盈价</span><input id="editTp" type="number" step="any" value="' +
      (p.takeProfit ?? '') +
      '"></label><label class="field"><span>止损价</span><input id="editSl" type="number" step="any" value="' +
      (p.stopLoss ?? '') +
      '"></label></div><p class="note">留空可取消对应保护。</p><p class="error"></p><button class="primary modal-action">保存保护</button></form>',
  );
  elements('editProtection').onsubmit = (e) => {
    e.preventDefault();
    try {
      updateProtection(
        s.account,
        { takeProfit: elements('editTp').value || null, stopLoss: elements('editSl').value || null },
        markBar(),
      );
      dialog.close();
      render();
      save();
      notify('已更新持仓保护');
    } catch (err) {
      $('#editProtection .error').textContent = err.message;
    }
  };
}
function action(key) {
  switch (key) {
    case 'play':
      play();
      break;
    case 'step':
      stop();
      step();
      break;
    case 'new':
      openNew(dial, context());
      break;
    case 'help':
      openHelp(dial, context());
      break;
    case 'markets':
      openMarkets(dial, context());
      break;
    case 'random':
      randomPeriod();
      break;
    case 'today':
      if (s.live) refreshLive(true);
      else
        startFeed({
          marketId: s.marketId,
          kind: s.feed?.kind || (domestic(s.marketId) ? 'future' : 'spot'),
          base: '5m',
          live: true,
        }).catch((err) => notify(err.message));
      break;
    case 'undoDraw': {
      const items = s.drawings[currentDrawingKey()] || [];
      if (items.length) {
        s.drawings[currentDrawingKey()] = items.slice(0, -1);
        renderChart();
        save();
      }
      break;
    }
    case 'dismiss':
      dialog.close();
      break;
    case 'terminal':
    case 'journal':
      setView(key);
      break;
    case 'fit':
      chart.resetView();
      break;
    case 'expand':
      elements('chartPanel').classList.toggle('expanded');
      break;
    case 'clearDraw':
      chart.clearDrawings();
      notify('当前周期画线已清除');
      break;
    case 'more':
    case 'less':
      elements('qty').value = Math.max(
        1,
        Math.floor(Number(elements('qty').value) || 1) + (key === 'more' ? 1 : -1),
      );
      ticketEstimate();
      break;
    case 'submit':
      submit();
      break;
    case 'closePosition':
      const result = closePosition(s.account, markBar());
      render();
      save();
      notify('已全部平仓 ' + result.filledQty + ' ' + unitName() + '，成交价 ' + number(result.fillPrice));
      break;
    case 'protect':
      editProtection();
      break;
  }
}
document.addEventListener('click', (event) => {
  const btn = event.target.closest('button,a.brand');
  if (!btn) return;
  if (!s) {
    if (btn.dataset.action) {
      pendingInitialAction = btn.dataset.action;
      elements('modeBadge').textContent = '正在打开历史训练…';
    }
    return;
  }
  try {
    if (btn.matches('a.brand')) {
      event.preventDefault();
      setView('terminal');
      return;
    }
    const d = btn.dataset;
    if (d.action) action(d.action);
    else if (d.market) switchMarket(d.market);
    else if (d.unavailablePeriod) {
      notify('本段基础行情为' + baseLabel() + '。要看' + d.unavailablePeriod + '，可在「新建训练」选择分钟行情。');
    } else if (d.period) {
      choosePeriod(d.period);
    } else if (d.tool) {
      chart.setTool(d.tool);
      if (d.tool !== 'crosshair')
        notify(d.tool === 'trend' ? '在图中依次点选趋势线的两个端点' : '在图中点选水平线价格');
    } else if (d.side) {
      side = d.side;
      renderTicket();
    } else if (d.fraction) {
      elements('qty').value = qtyMaximum(Number(d.fraction) / 100);
      ticketEstimate();
    } else if (d.tab) {
      tab = d.tab;
      renderLedger();
    } else if (d.cancel) {
      cancelOrder(s.account, Number(d.cancel));
      render();
      save();
      notify('已撤销委托');
    }
  } catch (err) {
    notify(err.message);
  }
});
elements('orderType').addEventListener('change', () => {
  elements('orderPrice').value = markBar().close;
  elements('limitPrice').value = markBar().close;
  renderTicket();
});
for (const name of ['qty', 'orderPrice', 'limitPrice'])
  elements(name).addEventListener('input', ticketEstimate);
elements('speed').addEventListener('change', () => {
  s.speed = elements('speed').value;
  if (timer) {
    stop();
    play();
  }
  save();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    elements('chartPanel').classList.remove('expanded');
    if (chart) chart.setTool('crosshair');
  }
  if (
    !s ||
    e.repeat ||
    e.altKey ||
    e.metaKey ||
    e.ctrlKey ||
    dialog.open ||
    view !== 'terminal' ||
    e.target.closest('input,select,textarea,[contenteditable=true]')
  )
    return;
  if (e.code === 'Space' && !e.target.closest('button,summary,a')) {
    e.preventDefault();
    play();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    stop();
    step();
  }
});
dialog.addEventListener('click', (e) => {
  if (e.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else if (s) {
    refreshLive();
    refreshWatch();
  }
});
function initChart() {
  const quickDelete = elements('trendQuickDelete');
  chart = createTradingChart(elements('plot'), {
    onHover: (b) => writeOhlc(b || aggregated.at(-1)),
    onDrawingAnchor: (point) => {
      quickDelete.hidden = !point;
      if (!point) return;
      quickDelete.style.setProperty('--anchor-x', point.x + 'px');
      quickDelete.style.setProperty('--anchor-y', point.y + 'px');
      quickDelete.style.setProperty('--pane-width', point.width + 'px');
      quickDelete.style.setProperty('--pane-height', point.height + 'px');
      quickDelete.classList.toggle('below-anchor', point.y < quickDelete.offsetHeight + 14);
    },
    onDrawingSelection: (style) => {
      elements('trendEditor').hidden = !style;
      if (!style) return;
      if (elements('toast').textContent === '在图中依次点选趋势线的两个端点') elements('toast').classList.remove('toast-on');
      elements('trendColor').value = style.color;
      elements('trendWidth').value = String(style.width);
      for (const button of all('[data-trend-color]')) {
        button.setAttribute('aria-pressed', String(button.dataset.trendColor === style.color.toLowerCase()));
      }
    },
    onDrawingChange: (drawings) => {
      if (s) {
        s.drawings[currentDrawingKey()] = drawings;
        elements('drawingCount').textContent = drawings.length + ' 条';
        save();
      }
    },
    onToolChange: (tool) =>
      all('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool)),
  });
  elements('trendEditor').addEventListener('click', (event) => {
    const swatch = event.target.closest('[data-trend-color]');
    if (swatch) chart.setTrendStyle({ color: swatch.dataset.trendColor });
  });
  elements('trendWidth').addEventListener('change', (event) => {
    chart.setTrendStyle({ width: Number(event.target.value) });
  });
  elements('trendColor').addEventListener('input', (event) =>
    chart.setTrendStyle({ color: event.target.value }),
  );
  elements('trendColor').addEventListener('change', (event) =>
    chart.setTrendStyle({ color: event.target.value }),
  );
  elements('deleteTrend').addEventListener('click', () => chart.deleteSelectedTrend());
  quickDelete.addEventListener('click', () => {
    if (chart.deleteSelectedTrend()) elements('plot').querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
  });
}
try {
  initChart();
  let active;
  try {
    store = await openStorage();
    const [stored, id] = await store.load();
    for (const st of stored) sessions.set(st.id, st);
    active = sessions.get(id);
  } catch {
    store = null;
  }
  try {
    for (const [id, item] of JSON.parse(localStorage.getItem(watchStore) || '[]'))
      if (byId(id) && item?.quote?.price && item.quote.tradeDate >= watch.get(id).quote.tradeDate)
        watch.set(id, item);
  } catch {}
  const restored = applyRecovery(active);
  const untouched = restored && !restored.account.position.qty && !restored.account.orders.length &&
    !restored.account.fills.length && !restored.notes?.length &&
    !Object.values(restored.drawings || {}).some((items) => items.length) &&
    (restored.live || restored.cursor === restored.start);
  const oldLanding = untouched && !restored.historicalHome && (restored.live || restored.feed?.anchored ||
    (!restored.feed && !restored.customBars && !restored.periodSchema) ||
    (restored.feed?.archivePeriod?.year >= new Date().getFullYear()));
  if (restored && !oldLanding) {
    await activate(restored);
    if (s.live) refreshLive();
  } else {
    elements('modeBadge').textContent = '正在打开往年历史训练…';
    const id = restored?.marketId || 'csi1000';
    try {
      await startFeed({ marketId: id, kind: domestic(id) ? 'future' : 'spot', base: '5m',
        live: false, archiveYear: 'auto' });
    } catch (error) {
      if (restored) await activate(restored);
      else throw error;
      notify('暂时无法打开历史训练，已恢复浏览器存档。');
    }
  }
  if (pendingInitialAction) {
    const actionToOpen = pendingInitialAction;
    pendingInitialAction = '';
    action(actionToOpen);
  }
  refreshWatch();
  if (location.hash === '#journal') setView('journal');
} catch (err) {
  elements('saved').textContent = '加载失败';
  notify('训练终端未能启动：' + err.message);
  console.error(err);
}
