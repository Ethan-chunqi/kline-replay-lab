import { MARKETS, generateBars } from './market.js';
import { aggregateBars, mapToPeriod } from './import.js';
import {
  createAccount,
  getSnapshot,
  advanceBar,
  placeOrder,
  cancelOrder,
  closePosition,
  updateProtection,
} from './engine.js';
import { createTradingChart } from './chart.js';
import { renderJournal } from './journal.js';
import { openNew, openHelp, openMarkets, openIndicators } from './dialogs.js';
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
const sessions = new Map(),
  demo = new Map();
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
  saveVersion = 0;
for (const i of all('[data-i]')) i.innerHTML = icon(i.dataset.i);
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
  return config.customBars || generateBars(config.marketId, config.seed, 720, config.base);
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
  const series = getBars({ marketId, base, seed, customBars });
  const start = Math.max(0, Math.min(startIndex, series.length - 2));
  const account = createAccount(config);
  advanceBar(account, series[start]);
  return {
    id: crypto.randomUUID(),
    marketId,
    base,
    seed,
    start,
    cursor: start,
    customBars,
    customName,
    account,
    notes: [],
    period: '1D',
    indicators: ['MA', 'VOL'],
    type: 'candles',
    drawings: {},
    speed: '1',
    created: Date.now(),
    updated: Date.now(),
  };
}
function displayMarket(session = s) {
  const profile = byId(session.marketId);
  return session.customBars ? { ...profile, name: session.customName || '自选行情', symbol: 'CSV' } : profile;
}
function activate(next) {
  stop();
  s = next;
  market = displayMarket();
  bars = getBars(s);
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
function initDemo(id) {
  if (!demo.has(id)) demo.set(id, generateBars(id, defaultSeed, defaultStart + 1, '1D'));
  return demo.get(id);
}
function latestMarket(id) {
  return [...sessions.values()]
    .filter((st) => st.marketId === id && !st.customBars)
    .sort((a, b) => b.updated - a.updated)[0];
}
function switchMarket(id) {
  if (!byId(id)) return;
  if (s.marketId === id && !s.customBars) return;
  const prev = latestMarket(id);
  return activate(prev || makeSession({ marketId: id, seed: defaultSeed }));
}
function spark(values, n, id) {
  const min = Math.min(...values),
    span = Math.max(0.01, Math.max(...values) - min);
  const pts = values.map((v, i) => [
    (i * 110) / Math.max(1, values.length - 1),
    33 - ((v - min) / span) * 27,
  ]);
  const path = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2)).join(' ');
  const color = n >= 0 ? '#00876c' : '#c44360';
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
const previewCache = new Map();
function previewOf(st, id) {
  if (!st) return initDemo(id);
  if (st === s) return visible;
  if (!previewCache.has(st.id) || previewCache.get(st.id).cursor !== st.cursor)
    previewCache.set(st.id, {
      cursor: st.cursor,
      bars: getBars(st).slice(Math.max(0, st.cursor - 42), st.cursor + 1),
    });
  return previewCache.get(st.id).bars;
}
function renderMarkets() {
  const ids = ['csi1000', 'csi500', 'ndx', 'spx'];
  if (!ids.includes(s.marketId)) ids[3] = s.marketId;
  elements('watchlist').innerHTML = ids
    .map((id) => {
      const selected = id === s.marketId && !s.customBars;
      const m = byId(id),
        data = previewOf(selected ? s : latestMarket(id), id),
        last = data.at(-1),
        prev = data.at(-2) || last;
      const change = (last.close / prev.close - 1) * 100;
      return (
        '<button class="market-card ' +
        (selected ? 'selected' : '') +
        '" data-market="' +
        id +
        '" aria-pressed="' +
        selected +
        '"><span class="card-top"><span class="card-name">' +
        humanName(m.name) +
        '</span><span class="card-code">' +
        m.symbol +
        '</span>' +
        (selected ? '<span class="card-check">' + icon('check', 14) + '</span>' : '') +
        '</span><span class="card-body"><span><span class="card-value">' +
        number(last.close) +
        '</span><span class="card-change ' +
        tone(change) +
        '">' +
        signed(change) +
        '%</span></span>' +
        spark(
          data.slice(-36).map((b) => b.close),
          change,
          id,
        ) +
        '</span></button>'
      );
    })
    .join('');
}
function baseLabel() {
  return s.base === '1D' ? '日线' : s.base === 'CSV' ? '原周期' : s.base === '15m' ? '15分' : '1小时';
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
function renderChart() {
  aggregated = aggregateBars(visible, s.period, market.timeZone);
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
    time: mapToPeriod(f.time, s.period, aggregated, market.timeZone),
    side: f.side,
    price: f.price,
  }));
  chart.update(aggregated, {
    marketId: s.id,
    timeframe: s.period === '1D' ? s.base : s.period,
    timeZone: market.timeZone,
    type: s.type,
    indicators: s.indicators,
    markers,
    levels,
    drawings: s.drawings[s.period] || [],
    precision: market.precision,
  });
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
    price = bars[s.cursor].close,
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
    mark = bars[s.cursor].close;
  const ref = elements('orderType').value === 'market' ? mark : price;
  const direction = side === 'buy' ? 1 : -1,
    qty = a.position.qty;
  const closeQty = Math.sign(qty) === -direction ? Math.abs(qty) : 0;
  if (closeQty) return Math.floor(closeQty * fraction);
  const capacity = getSnapshot(a, ref).available;
  const opening =
    a.allowShort || side === 'buy'
      ? Math.max(0, capacity) / (ref * (1 + (a.slippageBps * 3 + a.feeBps * 2) / 10000))
      : 0;
  return Math.floor((closeQty + opening) * fraction);
}
function ticketEstimate() {
  const type = elements('orderType').value,
    price =
      type === 'market'
        ? bars[s.cursor].close
        : Number(elements(type === 'stopLimit' ? 'limitPrice' : 'orderPrice').value);
  elements('notional').textContent =
    number(Math.max(0, Number(elements('qty').value) || 0) * (price || 0)) + ' ' + market.currency;
}
function renderTicket() {
  const price = bars[s.cursor].close,
    snap = getSnapshot(s.account, price);
  elements('equity').textContent = number(snap.equity);
  elements('available').textContent = number(snap.available) + ' ' + market.currency;
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
  elements('play').innerHTML = icon(timer ? 'pause' : 'play', 16);
  elements('play').setAttribute('aria-label', timer ? '暂停' : '播放');
  elements('play').disabled = atEnd;
  $('[data-action="step"]').disabled = atEnd;
  elements('replayText').textContent = atEnd ? '回放结束' : timer ? '回放中' : '回放进度';
  const total = bars.length - s.start - 1,
    done = s.cursor - s.start;
  elements('progressNum').textContent = done + ' / ' + total;
  elements('progress').value = (done / total) * 100;
}
function render() {
  visible = bars.slice(0, s.cursor + 1);
  const b = visible.at(-1),
    prev = visible.at(-2) || b,
    delta = b.close - prev.close;
  elements('modeBadge').textContent = s.customBars ? '已导入历史行情' : '模拟生成行情';
  elements('instrumentName').textContent = humanName(market.name);
  elements('region').textContent = market.region;
  elements('instrumentCode').textContent =
    market.exchange + ' · ' + market.symbol + '  /  ' + market.currency;
  elements('quotePrice').textContent = number(b.close);
  elements('quoteChange').textContent = signed(delta) + ' (' + signed((delta / prev.close) * 100) + '%)';
  elements('quoteChange').className = tone(delta);
  elements('periodButtons').innerHTML = [
    ['1D', baseLabel()],
    ['1W', '周线'],
    ['1M', '月线'],
  ]
    .map(
      ([p, label]) =>
        '<button data-period="' +
        p +
        '" class="' +
        (s.period === p ? 'active' : '') +
        '">' +
        label +
        '</button>',
    )
    .join('');
  elements('chartType').innerHTML =
    icon(s.type === 'candles' ? 'candles' : 'line', 15) +
    '<span>' +
    (s.type === 'candles' ? '蜡烛' : '折线') +
    '</span>';
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
  if (s.cursor >= bars.length - 1) {
    stop();
    return;
  }
  const previous = s.account.fills.length;
  const bar = bars[s.cursor + 1];
  advanceBar(s.account, bar);
  s.cursor++;
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
  if (s.cursor === bars.length - 1) return;
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
      bar: bars[s.cursor],
      onSave: async () => {
        if (!(await save())) throw Error('笔记尚未写入浏览器存储');
      },
      onRetry: () => {
        const cfg = {
          marketId: s.marketId,
          base: s.base,
          seed: s.seed,
          startIndex: s.start,
          customBars: s.customBars,
          customName: s.customName,
          initialCash: s.account.initialCash,
          feeBps: s.account.feeBps,
          slippageBps: s.account.slippageBps,
          allowShort: s.account.allowShort,
        };
        activate(makeSession(cfg));
        notify('已从相同起点开始新训练，原记录已存档');
      },
      onBack: () => setView('terminal'),
      onRestore: (id) => {
        if (sessions.has(id)) activate(sessions.get(id));
      },
      archives,
    });
  }
}
const dialog = elements('dialog');
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
    onNew: (config) => activate(makeSession(config)),
    onSwitch: switchMarket,
    onIndicators: (values) => {
      s.indicators = values;
      renderChart();
      save();
    },
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
  const result = placeOrder(s.account, order, bars[s.cursor]);
  tab = type === 'market' ? 'position' : 'orders';
  render();
  save();
  notify(
    result.status === 'filled'
      ? '已模拟成交 ' + result.filledQty + ' 单位，成交价 ' + number(result.fillPrice)
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
        bars[s.cursor],
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
    case 'indicators':
      openIndicators(dial, context());
      break;
    case 'dismiss':
      dialog.close();
      break;
    case 'terminal':
    case 'journal':
      setView(key);
      break;
    case 'type':
      s.type = s.type === 'candles' ? 'line' : 'candles';
      render();
      save();
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
      closePosition(s.account, bars[s.cursor]);
      render();
      save();
      notify('已平仓');
      break;
    case 'protect':
      editProtection();
      break;
  }
}
document.addEventListener('click', (event) => {
  const btn = event.target.closest('button,a.brand');
  if (!btn || !s) return;
  try {
    if (btn.matches('a.brand')) {
      event.preventDefault();
      setView('terminal');
      return;
    }
    const d = btn.dataset;
    if (d.action) action(d.action);
    else if (d.market) switchMarket(d.market);
    else if (d.period) {
      s.period = d.period;
      chart.setTool('crosshair');
      render();
      save();
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
  elements('orderPrice').value = bars[s.cursor].close;
  elements('limitPrice').value = bars[s.cursor].close;
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
});
function initChart() {
  chart = createTradingChart(elements('plot'), {
    onHover: (b) => writeOhlc(b || aggregated.at(-1)),
    onDrawingChange: (drawings) => {
      if (s) {
        s.drawings[s.period] = drawings;
        save();
      }
    },
    onToolChange: (tool) =>
      all('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool)),
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
  await activate(applyRecovery(active) || makeSession({ seed: defaultSeed }));
  if (location.hash === '#journal') setView('journal');
} catch (err) {
  elements('saved').textContent = '加载失败';
  notify('训练终端未能启动：' + err.message);
  console.error(err);
}
