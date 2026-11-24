import { MARKETS, generateBars } from './market.js?v=20261124';
import { timeframeOptions, periodBars, executionTime, nextDisplayCursor, exchangeClock, tradingWindows } from './periods.js?v=20261120b';
import { anchoredScenario, SNAPSHOT_QUOTES } from './anchor.js';
import { pickRandomStart, visitedBarRanges } from './random-period.js?v=20261120b';
import { replayCatalog, readHistoricalPeriod } from './replay-library.js?v=20261124';
import { fetchMarketQuote, loadChartFeed } from './feed-service.js?v=20261124live2';
import { subscribeBitcoinLive, applyBitcoinCandle, isFreshBitcoinQuote } from './bitcoin-stream.js?v=20261124live2';
import { futuresTerms } from './eastmoney.js';
import { tradingBar, applyLiveQuote } from './live.js?v=20261124live2';
import {
  bitcoinPerpTerms,
  bitcoinOpeningCapacity,
  defaultCapital,
  setPerpLeverage,
  createAccount,
  getSnapshot,
  advanceBar,
  placeOrder,
  cancelOrder,
  closePosition,
  updateProtection,
} from './engine.js?v=20261124';
import { createTradingChart } from './chart.js?v=20261124trend3';
import { renderJournal } from './journal.js?v=20261124';
import { openNew, openHelp, openMarkets } from './dialogs.js?v=20261124live2';
import { openStorage } from './storage.js';
import { icon } from './icons.js?v=20261124';
import { createDrawingToolbar } from './drawing-toolbar.js?v=20261124trend3';
import { renderExposure } from './exposure-display.js';
import { renderTradeHistory } from './trade-history-view.js?v=20261124live2';

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
const initialViewHash = location.hash;
let pendingInitialAction = '';
let activeDays = [];
let workspaceRequest = null;
let btcSubscription = null;
let liveTransport = 'connecting';
let lastLiveSave = 0;
let livePaint = 0;
let lastQuoteCheck = 0;
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
  drawingToolbar,
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
const unitName = () => market.quantityUnit || (s.account.contract ? '手' : '单位');
const formatQty = (value) => market.quantityDecimals ? number(value, market.quantityDecimals) : String(value);
const quoteSource = (id) => byId(id)?.continuous ? '币安' : '东方财富';
const defaultKind = (id) => domestic(id) || id === 'btcPerp' ? 'future' : 'spot';
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
const leverageSelect = elements('perpLeverage');
for (let n = 1; n <= 100; n++) leverageSelect.add(new Option(n + '×', String(n)));
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
  const instrument = byId(marketId);
  const spotRules = marketId === 'btc' ? {
    unit: instrument.quantityUnit, quantityDecimals: instrument.quantityDecimals, tickSize: 1 / 10 ** instrument.precision,
  } : null;
  const contract = marketId === 'btcPerp' ? bitcoinPerpTerms(config.contract?.leverage) : config.contract;
  const account = createAccount({
    ...config, initialCash: config.initialCash ?? defaultCapital(marketId),
    contract, spotRules, allowShort: marketId === 'btcPerp' ? true : config.allowShort,
  });
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
    instrumentKind: config.kind || config.feed?.kind || (contract ? 'future' : 'spot'),
    simulationReference: config.simulationReference,
    account,
    notes: [],
    period: config.period || 'BASE',
    periodSchema: 2,
    historicalHome: true,
    customCapital: config.customCapital ?? (account.initialCash !== defaultCapital(marketId)),
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
      exchange: domestic(session.marketId) && session.account.contract ? 'CFFEX' : profile.exchange,
    };
  if (session.account.contract) {
    return {
      ...profile,
      exchange: domestic(session.marketId) ? 'CFFEX' : profile.exchange,
      symbol: session.account.contract.symbol,
      name: session.customName || (domestic(session.marketId) ? profile.name + ' 股指期货模拟' : profile.name),
    };
  }
  return session.customBars ? { ...profile, name: session.customName || '自选行情', symbol: 'CSV' } : profile;
}
function activate(next) {
  stop();
  stopBitcoinStream();
  clearWorkspaceRequest();
  lastQuoteCheck = 0;
  liveTransport = 'connecting';
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
  const quantity = elements('qty');
  const quantityStep = 1 / 10 ** (market.quantityDecimals || 0);
  quantity.step = quantity.min = String(quantityStep);
  quantity.inputMode = market.quantityDecimals ? 'decimal' : 'numeric';
  quantity.value = market.quantityDecimals ? (0.01).toFixed(market.quantityDecimals) : '1';
  elements('tp').value = '';
  elements('sl').value = '';
  elements('protection').open = false;
  elements('speed').value = s.speed || '1';
  elements('chartPanel').classList.remove('expanded');
  chart.setTool('trend');
  setView('terminal');
  if (s.live) {
    if (market.continuous) { startBitcoinStream(); void refreshBitcoinHistory(next); }
    else void refreshLive();
  }
  return save();
}
let marketLoad = null;
let periodLoad = null, lastPeriodMarkup = '';
function clearWorkspaceRequest() {
  workspaceRequest?.controller.abort();
  clearTimeout(workspaceRequest?.retry);
  workspaceRequest = null;
  document.body.removeAttribute('data-workspace-pending');
  elements('workspaceNotice').hidden = true;
}
function showWorkspaceNavigation(live, next = 'terminal') {
  const mode = live ? 'live' : 'replay';
  document.body.dataset.workspace = mode;
  elements('workspaceTitle').textContent = live ? '实时交易' : '历史训练';
  for (const item of all('nav .nav')) {
    const active = item.dataset.action === (next === 'terminal' ? mode : next);
    item.classList.toggle('active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  }
}
async function openWorkspace(live, marketId, savedSession) {
  stop();
  clearWorkspaceRequest();
  marketLoad?.controller.abort();
  marketLoad = null;
  periodLoad?.controller.abort();
  ++loadVersion;
  loadBusy = randomBusy = false;
  const recent = savedSession || [...sessions.values()].filter(item =>
    !!item.live === live && (!marketId || item.marketId === marketId)
  ).sort((a, b) => b.updated - a.updated)[0];
  if (recent) {
    if (s === recent) { chart.setTool('trend'); setView('terminal'); }
    else await activate(recent);
    return;
  }
  const id = marketId || (live ? 'btcPerp' : 'csi1000');
  const request = { live, id, controller: new AbortController() };
  workspaceRequest = request;
  view = 'terminal';
  cleanJournal?.();
  cleanJournal = null;
  elements('terminal').hidden = false;
  elements('history').hidden = elements('journal').hidden = true;
  showWorkspaceNavigation(live);
  history.replaceState(history.state, '', live ? '#live' : '#replay');
  document.body.setAttribute('data-workspace-pending', '');
  elements('workspaceNotice').hidden = false;
  elements('workspaceNoticeTitle').textContent = '正在打开' + humanName(byId(id).name);
  elements('workspaceNoticeText').textContent = live ? '正在连接行情源，等待交易所报价。' : '正在载入历史 K 线。';
  elements('liveStatus').textContent = live ? '连接中' : '';
  elements('liveStatus').dataset.state = 'connecting';
  const retry = elements('workspaceNotice').querySelector('[data-action=retryWorkspace]');
  retry.hidden = true;
  try {
    const signal = AbortSignal.any([request.controller.signal, AbortSignal.timeout(live ? 20000 : 30000)]);
    await startFeed({ marketId:id, kind:defaultKind(id), base:'5m', live, archiveYear:'auto', signal });
  } catch (error) {
    if (workspaceRequest !== request) return;
    elements('workspaceNoticeTitle').textContent = humanName(byId(id).name) + (live ? '行情暂不可用' : '历史数据暂不可用');
    elements('workspaceNoticeText').textContent = live ? '未取得可核实的报价，模拟交易已暂停。可以重试或切换到历史训练。' : '请检查网络后重试。';
    elements('liveStatus').textContent = live ? '未连接' : '';
    elements('liveStatus').dataset.state = 'offline';
    retry.hidden = false;
    if (live) request.retry = setTimeout(() => {
      if (workspaceRequest === request && !document.hidden) void openWorkspace(live, id);
    }, 20000);
  }
}
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
  const kind = defaultKind(id);
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
    const signal = useLive ? AbortSignal.any([request.controller.signal, AbortSignal.timeout(18000)]) :
      request.controller.signal;
    await startFeed({ ...options, live: useLive, signal });
  }
  const isCurrent = () => marketLoad === request && !request.controller.signal.aborted;
  try {
    await open(live);
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
  const kind = defaultKind(id);
  const symbol = domestic(id) ? futuresTerms(id).symbol : byId(id).symbol;
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
  const ids = ['csi1000', 'csi500', 'btcPerp', 'ndx', 'csi300'];
  const pending = marketLoad?.origin === s ? marketLoad : null;
  const activeId = pending?.id || s.marketId;
  if (!ids.includes(activeId)) ids[ids.length - 1] = activeId;
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
          item.pinned ? ' · 收盘快照' : item.dailySource ? ' · 日线 ' + item.dailySource : id === 'btcPerp' ? ' · 币安永续' : id === 'btc' ? ' · 币安现货' : ' · 指数现货')
      : '等待' + quoteSource(id) + '行情';
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
          (p.qty > 0 ? '多头' : '空头') + ' / ' + formatQty(Math.abs(p.qty)) + ' ' + unitName(),
          number(p.avgPrice),
          '<span class="' + tone(snap.unrealized) + '">' + signed(snap.unrealized) + '</span>',
          [p.takeProfit, p.stopLoss].map((v) => (v == null ? '—' : number(v))).join(' / '),
          '<button data-action="protect">修改保护</button><button data-action="closePosition">平仓</button>',
        ],
      ],
    );
  if (tab === 'orders' && a.orders.length)
    content = table(
      ['委托时间', '方向', '类型 / 报价', '数量（' + unitName() + '）', '状态', '操作'],
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
          formatQty(o.qty),
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
      ['成交时间', '方向', '数量（' + unitName() + '）', '成交价', '手续费'],
      a.fills
        .slice()
        .reverse()
        .map((f) => [
          esc(fmtTime(f.time, market.timeZone)),
          f.side === 'buy' ? '买入' : '卖出',
          formatQty(f.qty),
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
  const scale = 10 ** (market.quantityDecimals || 0);
  const floorQty = (amount) => Math.floor(amount * scale + Number.EPSILON * amount * scale * 4) / scale;
  if (closeQty) return floorQty(closeQty * fraction);
  if (market.quantityUnit === 'BTC') {
    const order = { side, type: elements('orderType').value, price: ref, limitPrice: ref };
    return floorQty(bitcoinOpeningCapacity(a, order, ref) * fraction);
  }
  const capacity = getSnapshot(a, ref).available;
  const opening =
    a.allowShort || side === 'buy'
      ? Math.max(0, capacity) /
        (ref *
          (a.contract?.multiplier || 1) *
          ((a.contract?.marginRate || 1) + (a.slippageBps * 3 + a.feeBps * 2) / 10000) +
          (a.contract?.tickSize || 0) * (a.contract?.multiplier || 1))
      : 0;
  return floorQty((closeQty + opening) * fraction);
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
  elements('lotValueRow').hidden = !terms || terms.perpetual;
  elements('marginEstimateRow').hidden = !terms || terms.perpetual;
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
  elements('quickClose').disabled = !pos.qty || !liveGate().ok;
  elements('qtyUnit').textContent = unitName();
  renderExposure(elements('exposureStats'), s, bars);
  elements('positionSummary').textContent = pos.qty
    ? (pos.qty > 0 ? '多头 ' : '空头 ') +
      formatQty(Math.abs(pos.qty)) +
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
  const leverageControl = elements('perpLeverageField');
  leverageControl.hidden = !terms?.perpetual;
  if (terms?.perpetual) {
    elements('perpLeverage').value = terms.leverage;
    termsNote.textContent = '全仓模拟 · 维持保证金率 0.4% · 已占用 ' + number(snap.marginUsed) +
      ' USDT · 按合约成交行情强平，不计资金费。';
  } else if (terms) {
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
  elements('buy').textContent = s.marketId === 'btc' ? '买入 BTC' : '买入 / 做多';
  elements('buy').classList.toggle('active', side === 'buy');
  elements('sell').classList.toggle('active', side === 'sell');
  elements('sell').textContent = s.marketId === 'btc' ? '卖出 BTC' : s.account.allowShort ? '卖出 / 做空' : '卖出';
  elements('submitOrder').textContent = side === 'buy' ? '模拟买入' : '模拟卖出';
  elements('submitOrder').classList.toggle('sell', side === 'sell');
  elements('feeHint').textContent =
    '手续费 ' + s.account.feeBps + ' bp　·　滑点 ' + s.account.slippageBps + ' bp';
  elements('limitField').hidden = elements('orderType').value !== 'stopLimit';
  elements('priceField').hidden = elements('orderType').value === 'market';
  elements('priceLabel').textContent = elements('orderType').value === 'limit' ? '限价' : '触发价';
  if (!elements('fractions').children.length) elements('fractions').innerHTML = [25, 50, 75, 100]
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
    clock.textContent = '回放 ' + fmtTime(bars[s.cursor].time, market.timeZone) + (market.timeZone === 'UTC' ? ' UTC' : '') + '　·　后续 ' + remaining + ' 个交易日';
  }
  if (s.live)
    elements('feedMeta').innerHTML =
      (s.account.contract && domestic(s.marketId) ? '公开行情或延时15分钟 · ' : '') +
      (refreshIssue ? esc(refreshIssue) + ' · ' : '') +
      (s.feed.limitedPeriod === effectivePeriod(s.period) ? '按现有样本合成 · ' : '') +
      (s.feed.quoteOnly ? (market.continuous ? '按收到的成交开始绘图 · ' : '仅有当日行情 · ') : s.feed.historyCached ? '使用本机历史缓存 · ' : '') +
      '报价 ' +
      esc(fmtTime(s.liveQuote.time, market.timeZone)) + ':' + String(s.liveQuote.time % 60).padStart(2, '0') + (market.timeZone === 'UTC' ? ' UTC' : '') +
      ' · <a href="' +
      esc(s.feed.quoteUrl) +
      '" target="_blank" rel="noopener">' + quoteSource(s.marketId) + '</a>';
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
  elements('todayBtn').textContent = loadBusy ? '正在取行情…' : s.live ? '刷新报价' : '看实时行情';
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
          : (s.live ? '报价 ' + quoteSource(s.marketId) + ' · ' : '') + 'K线 ' + (s.feed.historySource || quoteSource(s.marketId)))
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
  renderLiveControls();
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
  elements('history').hidden = next !== 'history';
  showWorkspaceNavigation(!!s.live, next);
  history.replaceState(history.state, '', '#' + (next === 'terminal' ? (s.live ? 'live' : 'replay') : next));
  if (next === 'terminal') render();
  else if (next === 'history') {
    elements('chartPanel').classList.remove('expanded');
    renderTradeHistory(elements('history'), sessions, s);
  } else {
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
window.addEventListener('hashchange', () => {
  if (location.hash === '#live') void openWorkspace(true);
  else if (location.hash === '#replay' || location.hash === '#bitcoin') void openWorkspace(false, location.hash === '#bitcoin' ? 'btcPerp' : undefined);
  else if (s && ['#terminal', '#history', '#journal'].includes(location.hash)) {
    clearWorkspaceRequest();
    setView(location.hash.slice(1));
  }
});
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
  field.hidden = s.live || s.base === 'CSV';
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
  const contract = marketId === 'btcPerp' ? bitcoinPerpTerms(config.contract?.leverage)
    : dataset.contract ? { ...dataset.contract, maintenanceRate: dataset.contract.exchangeMarginRate } : null;
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
    if (!cfg.customCapital) cfg.initialCash = defaultCapital(cfg.marketId);
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
          chart.setTool('trend');
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
        s.feed.historySource = feed.historySource || quoteSource(s.marketId);
        const latest = (s.liveQuote.tradeTimeMs ?? s.liveQuote.time * 1000) > (feed.quote.tradeTimeMs ?? feed.quote.time * 1000)
          || (market.continuous && s.liveQuote.sequence > feed.quote.sequence) ? s.liveQuote : feed.quote;
        if (market.continuous ? isFreshBitcoinQuote(s.marketId, latest) : stockQuoteState(s, latest) === 'fresh')
          applyBoardQuote(s, latest);
        if (market.continuous) startBitcoinStream();
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
    chart.setTool('trend');
    render();
    save();
  } catch (err) {
    if (s !== instance || version !== loadVersion) return;
    const available = frameChoices.find((o) => effectivePeriod(o.id) === desired);
    if (s.live && available) {
      s.period = available.id;
      s.feed.limitedPeriod = desired;
      chart.setTool('trend');
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
      x.live && x.feed?.symbol === symbol &&
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
      const q = await fetchMarketQuote(marketId, request);
      signal?.throwIfAborted();
      const cached = cachedBars(marketId, base, q.symbol);
      if (byId(marketId).continuous) {
        // A confirmed trade can start a partial candle while historical depth is unavailable.
        const minutes = base === '1D' ? 1440 : parseInt(base) * (base.endsWith('H') ? 60 : 1);
        const width = minutes * 60;
        const time = base === '1D' ? q.tradeDate : Math.floor(q.time / width) * width;
        quoteOnly = true;
        dataset = { quote:q, name:q.name, symbol:q.symbol, tradeDate:q.tradeDate, quoteUrl:q.quoteUrl,
          bars:[{time, open:q.price, high:q.price, low:q.price, close:q.price, volume:0}] };
      } else if (cached) {
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
      historySource: dataset.historySource || quoteSource(marketId),
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
    if (!quoteOnly && !dataset.historyCached) next.lastHistoryFetch = Date.now();
    await activate(next);
  } finally {
    if (version === loadVersion || !loadBusy) {
      loadBusy = false;
      elements('todayBtn').disabled = false;
      if (s) renderPlay();
      elements('todayBtn').textContent = s?.live ? '刷新报价' : '看实时行情';
    }
  }
}
function stockQuoteState(session, quote) {
  const profile = byId(session.marketId);
  const now = Date.now();
  const current = exchangeClock(Math.floor(now / 60000) * 60, profile);
  const day = new Date(current.date + 'T12:00:00Z').getUTCDay();
  const inSession = day !== 0 && day !== 6 && tradingWindows(profile, current.date)
    .some(([open, close]) => current.minute >= open && current.minute < close);
  if (!inSession) return 'closed';
  const age = now - quote.time * 1000;
  if (current.date !== quote.tradeDate || age > 90000 || age < -3000) return 'delayed';
  return 'fresh';
}
function liveGate() {
  if (!s?.live) return { ok:true };
  if (!navigator.onLine || liveTransport === 'offline') return { status:'offline', text:'行情断开 · 暂停成交' };
  if (market.continuous) {
    if (liveTransport === 'connecting') return { status:'connecting', text:'正在连接实时成交' };
    if (!isFreshBitcoinQuote(s.marketId, s.liveQuote)) return { status:'stale', text:'报价已过期 · 暂停成交' };
    return { ok:true, status:'connected', text:liveTransport === 'websocket' ? '币安实时推送' : '币安实时轮询' };
  }
  const state = stockQuoteState(s, s.liveQuote);
  if (state === 'closed') return { status:'stale', text:'休市 · 最近报价' };
  if (state === 'delayed') return { status:'stale', text:'报价延时 · 暂停成交' };
  if (liveTransport !== 'polling' || Date.now() - lastQuoteCheck > 35000)
    return { status:'connecting', text:'等待最新报价' };
  return { ok:true, status:'connected', text:'行情轮询 · 15 秒' };
}
function renderLiveControls() {
  if (!s || workspaceRequest) return;
  const gate = liveGate();
  const status = elements('liveStatus');
  if (status.textContent !== (gate.text || '')) status.textContent = gate.text || '';
  status.dataset.state = gate.status || '';
  const disabled = s.live && !gate.ok;
  const submitButton = elements('submitOrder');
  submitButton.disabled = disabled;
  submitButton.title = disabled ? gate.text : '';
  for (const button of all('[data-action="closePosition"]')) button.disabled = disabled || !s.account.position.qty;
}
function requireLiveQuote() {
  if (workspaceRequest || marketLoad) throw Error('请等待行情切换完成');
  const gate = liveGate();
  if (!gate.ok) throw Error(gate.text + '，请等待可交易的最新报价。');
}
function stopBitcoinStream() {
  btcSubscription?.();
  btcSubscription = null;
  clearTimeout(livePaint);
  livePaint = 0;
}
function paintLiveSoon() {
  if (livePaint || document.hidden || view !== 'terminal' || workspaceRequest) return;
  livePaint = setTimeout(() => {
    livePaint = 0;
    if (!document.hidden && s?.live && view === 'terminal' && !workspaceRequest) render();
  }, 240);
}
// Retain each minute's first, last and extreme marks for the journal and drawdown curve.
function compactLiveMinute(series, field) {
  if (!series || series.length < 5) return;
  const start = series.length - 5;
  const points = series.slice(start);
  if (Math.floor(points[0].time / 60) !== Math.floor(points[4].time / 60)) return;
  const values = points.map(p => p[field]);
  const extremes = new Set([0, 4, values.indexOf(Math.min(...values)), values.indexOf(Math.max(...values))]);
  series.splice(start, 5, ...points.filter((_, index) => extremes.has(index)));
}
function recordLiveMark(session, result) {
  if (!result.changed || !session.markHistory) return;
  const {lastTime:time, lastPrice:price} = session.account;
  if (session.markHistory.at(-1)?.time !== time) session.markHistory.push({time, price});
  compactLiveMinute(session.markHistory, 'price');
  compactLiveMinute(session.account.equityCurve, 'equity');
}
function startBitcoinStream() {
  stopBitcoinStream();
  if (!s?.live || !market.continuous) return;
  const session = s;
  liveTransport = 'connecting';
  btcSubscription = subscribeBitcoinLive(session.marketId, session.base, {
    initialQuote: session.liveQuote,
    onQuote(quote) {
      if (s !== session || !isFreshBitcoinQuote(session.marketId, quote)) return;
      const result = applyBoardQuote(session, quote);
      if (!result.changed) return;
      bars = session.customBars;
      session.cursor = bars.length - 1;
      session.feed.tradeDate = quote.tradeDate;
      watch.set(session.marketId, {quote});
      recordLiveMark(session, result);
      if (result.newFills.length || Date.now() - lastLiveSave > 15000) {
        lastLiveSave = Date.now();
        void save();
      }
      if (result.newFills.length && view === 'history') renderTradeHistory(elements('history'), sessions, s);
      paintLiveSoon();
    },
    onCandle(update) {
      if (s === session && applyBitcoinCandle(session, update)) paintLiveSoon();
    },
    onStatus(state) {
      if (s !== session) return;
      liveTransport = state;
      renderLiveControls();
    },
  });
}
const restoringDepth = new WeakMap();
async function refreshBitcoinHistory(session, force = false) {
  if (restoringDepth.get(session) === session.base || (!force && Date.now() - (session.lastHistoryFetch || 0) < 90000)) return;
  const base = session.base;
  restoringDepth.set(session, base);
  try {
    const data = await loadChartFeed(session.marketId, base, {limit:720, signal:AbortSignal.timeout(9000)});
    if (s !== session || s.base !== base || !data.bars.length) return;
    const epoch = (bar) => typeof bar.time === 'number' ? bar.time : Date.parse(bar.time) / 1000;
    const last = epoch(data.bars.at(-1));
    const newerLocal = session.liveQuote.sequence > data.quote.sequence;
    const tail = session.customBars.filter(bar => epoch(bar) > last || (epoch(bar) === last && newerLocal));
    session.customBars = data.bars;
    for (const bar of tail) applyBitcoinCandle(session, {
      marketId:session.marketId, base, bar, asOfMs:data.quote.tradeTimeMs,
    });
    session.feed.quoteOnly = false;
    session.feed.historyCached = false;
    session.feed.historySource = data.historySource;
    bars = session.customBars;
    session.cursor = bars.length - 1;
    session.lastHistoryFetch = Date.now();
    frameChoices = timeframeOptions(base, bars, market.region);
    paintLiveSoon();
  } catch { /* The quote stream can continue while chart history is unavailable. */ }
  finally { if (restoringDepth.get(session) === base) restoringDepth.delete(session); }
}
async function refreshLive(manual = false) {
  if (!s?.live) return;
  if (market.continuous) { await refreshBitcoinHistory(s, manual); return; }
  if (quoteBusy) return;
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

    if (s !== instance || s.base !== sourceBase) return;
    const q = data?.quote || (await fetchMarketQuote(instance.marketId, options));
    if (s !== instance || s.base !== sourceBase) return;
    lastQuoteCheck = Date.now();
    liveTransport = 'polling';
    const fresh = stockQuoteState(s, q) === 'fresh';
    const result = fresh ? applyBoardQuote(s, q) : { changed:false, newFills:[] };
    if (!fresh && q.time >= s.liveQuote.time) s.liveQuote = q;
    recordLiveMark(s, result);
    if (data && q.time >= s.liveQuote.time) {
      s.customBars = data.bars;
      s.lastHistoryFetch = Date.now();
      rememberHistory(s.marketId, requestBase, data);
      s.feed.historyCached = false;
      s.feed.historySource = data.historySource || quoteSource(s.marketId);
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
    else if (result.newFills.length && view === 'history') renderTradeHistory(elements('history'), sessions, s);
    if (result.changed || data) save();
    if (manual) notify('已核对' + quoteSource(s.marketId) + '报价 · ' + fmtTime(s.liveQuote.time, market.timeZone));
  } catch (err) {
    if (s === instance) {
      liveTransport = 'offline';
      renderLiveControls();
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
  const wanted = MARKETS.filter((m) => ['csi1000', 'csi500', 'btcPerp', 'ndx', 'csi300', s?.marketId].includes(m.id));
  for (const m of wanted) {
    try {
      const old = watch.get(m.id);
      if (domestic(m.id)) {
        const quote = await fetchMarketQuote(m.id, { contract: 'active' });
        watch.set(m.id, { quote });
      } else if (old?.values?.length && !old.dailySource) {
        const quote = await fetchMarketQuote(m.id, { contract: 'index' });
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
  if (event.target.id === 'perpLeverage' && s?.account.contract?.perpetual) {
    try {
      setPerpLeverage(s.account, Number(event.target.value), markBar().close);
      save();
    } catch (error) { notify(error.message); }
    renderTicket();
  }
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
setInterval(() => { if (s?.live && !document.hidden) renderLiveControls(); }, 1000);
window.addEventListener('offline', renderLiveControls);
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
      if (config.kind === 'future' && domestic(config.marketId)) {
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
  requireLiveQuote();
  const qty = Number(elements('qty').value);
  if (!market.quantityDecimals && (!Number.isSafeInteger(qty) || qty < 1))
    throw Error('请输入正整数交易数量');
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
      ? '已模拟成交 ' + formatQty(result.filledQty) + ' ' + unitName() + '，成交价 ' + number(result.fillPrice)
      : s.live ? '模拟委托已提交，按后续行情撮合' : '委托已提交，下一根 K 线起撮合',
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
      requireLiveQuote();
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
    case 'live':
    case 'replay':
      void openWorkspace(key === 'live');
      break;
    case 'retryWorkspace':
      if (workspaceRequest) void openWorkspace(workspaceRequest.live, workspaceRequest.id);
      break;
    case 'today':
      if (s.live) {
        if (market.continuous) { startBitcoinStream(); void refreshLive(true); }
        else void refreshLive(true);
      } else void openWorkspace(true, s.marketId);
      break;
    case 'undoDraw': {
      if (drawingToolbar.options.locked) return notify('请先解锁画线');
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
    case 'history':
    case 'journal':
      clearWorkspaceRequest();
      setView(key);
      break;
    case 'fit':
      chart.resetView();
      break;
    case 'expand':
      elements('chartPanel').classList.toggle('expanded');
      break;
    case 'clearDraw':
      if (drawingToolbar.options.locked) return notify('请先解锁画线');
      if (!s.drawings[currentDrawingKey()]?.length) break;
      if (!confirm('清除本训练当前周期的全部画线？')) break;
      chart.clearDrawings();
      notify('当前周期画线已清除');
      break;
    case 'more':
    case 'less': {
      const field = elements('qty'), step = Number(field.step);
      const ticks = Math.floor(Number(field.value || step) / step + 1e-9);
      field.value = (Math.max(1, ticks + (key === 'more' ? 1 : -1)) * step)
        .toFixed(market.quantityDecimals || 0);
      ticketEstimate();
      break;
    }
    case 'submit':
      submit();
      break;
    case 'closePosition':
      requireLiveQuote();
      const result = closePosition(s.account, markBar());
      render();
      save();
      notify('已全部平仓 ' + formatQty(result.filledQty) + ' ' + unitName() + '，成交价 ' + number(result.fillPrice));
      break;
    case 'protect':
      editProtection();
      break;
  }
}
document.addEventListener('click', (event) => {
  const btn = event.target.closest('button,a.brand');
  if (!btn) return;
  if (workspaceRequest && ['live', 'replay', 'retryWorkspace'].includes(btn.dataset.action)) {
    action(btn.dataset.action);
    return;
  }
  if (!s && workspaceRequest && ['history','journal'].includes(btn.dataset.action)) {
    const target = btn.dataset.action;
    void openWorkspace(false).then(() => { if (s && !workspaceRequest) setView(target); });
    return;
  }
  if (!s) {
    if (btn.dataset.action) {
      pendingInitialAction = btn.dataset.action;
      elements('modeBadge').textContent = '正在打开交易终端…';
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
    if (btn.closest('#drawingTools')) return;
    if (d.action) action(d.action);
    else if (d.market) switchMarket(d.market);
    else if (d.unavailablePeriod) {
      notify('本段基础行情为' + baseLabel() + '。要看' + d.unavailablePeriod + '，可在「新建训练」选择分钟行情。');
    } else if (d.period) {
      choosePeriod(d.period);
    } else if (d.side) {
      side = d.side;
      renderTicket();
    } else if (d.fraction) {
      elements('qty').value = qtyMaximum(Number(d.fraction) / 100).toFixed(market.quantityDecimals || 0);
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
  if (e.key === 'Escape' && !dialog.open) {
    elements('chartPanel').classList.remove('expanded');
    if (chart) chart.cancelDrawing();
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
  if (document.hidden) { stop(); if (s?.live) void save(); }
  else if (workspaceRequest && !elements('workspaceNotice').querySelector('[data-action=retryWorkspace]').hidden) {
    void openWorkspace(workspaceRequest.live, workspaceRequest.id);
  } else if (s) {
    renderLiveControls();
    refreshLive();
    refreshWatch();
  }
});
function initChart() {
  const quickDelete = elements('trendQuickDelete');
  const swatches = [...elements('trendColors').querySelectorAll('[data-trend-color]')];
  const colorKey = 'wavelab-trend-color';
  let preferredColor = swatches[0].dataset.trendColor;
  try {
    const stored = localStorage.getItem(colorKey);
    if (swatches.some(button => button.dataset.trendColor === stored)) preferredColor = stored;
  } catch {}
  function showColor(color) {
    for (const button of swatches) {
      button.setAttribute('aria-pressed', String(button.dataset.trendColor === color.toLowerCase()));
    }
  }
  drawingToolbar = createDrawingToolbar({
    rail: elements('drawingTools'), menu: elements('drawingMenu'),
    onTool: (id) => chart.setTool(id), onOption: (flags) => chart.setDrawingOptions(flags),
    onAction: (key) => { if (s) action(key); }, notify,
  });
  chart = createTradingChart(elements('plot'), {
    requestText: (initial) => new Promise((resolve) => {
      show('图表文本', '<form id="chartTextForm"><label class="field"><span>标注内容</span><input id="chartText" maxlength="160" required></label><button class="primary modal-action">保存</button></form>');
      const input = elements('chartText');
      input.value = initial;
      input.focus();
      input.select();
      let value = null;
      elements('chartTextForm').onsubmit = (e) => { e.preventDefault(); value = input.value; dialog.close(); };
      dialog.addEventListener('close', () => resolve(value), { once: true });
    }),
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
      showColor(style?.color || preferredColor);
      if (!style) return;
      elements('trendPattern').value = style.pattern;
      elements('trendWidth').value = String(style.width);
    },
    onDrawingChange: (drawings) => {
      if (s) {
        s.drawings[currentDrawingKey()] = drawings;
        elements('drawingCount').textContent = drawings.length + ' 条';
        save();
      }
    },
    onToolChange: drawingToolbar.setTool,
  });
  chart.setDrawingOptions({ trendColor: preferredColor });
  showColor(preferredColor);
  elements('trendColors').addEventListener('click', (event) => {
    const swatch = event.target.closest('[data-trend-color]');
    if (!swatch) return;
    preferredColor = swatch.dataset.trendColor;
    try { localStorage.setItem(colorKey, preferredColor); } catch {}
    chart.setDrawingOptions({ trendColor: preferredColor });
    chart.setTrendStyle({ color: preferredColor });
    showColor(preferredColor);
  });
  elements('trendPattern').addEventListener('change', (e) => chart.setTrendStyle({ pattern: e.target.value }));
  elements('trendWidth').addEventListener('change', (event) => {
    chart.setTrendStyle({ width: Number(event.target.value) });
  });
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
      if (byId(id) && item?.quote?.price && item.quote.tradeDate >= (watch.get(id)?.quote?.tradeDate || ''))
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
  const wanted = initialViewHash;
  if (wanted === '#live') await openWorkspace(true);
  else if (wanted === '#bitcoin') await openWorkspace(false, 'btcPerp');
  else if (wanted === '#replay') await openWorkspace(false);
  else if (restored && !oldLanding) await activate(restored);
  else if (['#history', '#journal', '#terminal'].includes(wanted) || oldLanding) await openWorkspace(false);
  else await openWorkspace(true);
  if (pendingInitialAction && s) {
    const actionToOpen = pendingInitialAction;
    pendingInitialAction = '';
    action(actionToOpen);
  }
  if (s) refreshWatch();
  if (s && ['#history', '#journal'].includes(initialViewHash)) setView(initialViewHash.slice(1));
} catch (err) {
  elements('saved').textContent = '加载失败';
  notify('训练终端未能启动：' + err.message);
  console.error(err);
}
