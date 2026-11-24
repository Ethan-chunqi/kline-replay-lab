import { MARKETS } from './market.js?v=20261124';
import { buildTradeHistory, summarizeTradeHistory } from './trade-history.js?v=20261124modes';

const viewState = new WeakMap();
const pageSize = 20;
const dateFormats = new Map();
const reasons = { market: '市价单', limit: '限价单', stop: '止损单', stopLoss: '止损', takeProfit: '止盈', marginCall: '强制平仓' };
const numberFormats = new Map();

function number(value, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return '—';
  if (!numberFormats.has(maximumFractionDigits)) {
    numberFormats.set(maximumFractionDigits, new Intl.NumberFormat('zh-CN', { maximumFractionDigits }));
  }
  return numberFormats.get(maximumFractionDigits).format(value);
}

function money(value, currency, signed = false) {
  const digits = currency === 'USDT' || (value !== 0 && Math.abs(value) < 0.01) ? 8 : 2;
  return (signed && value > 0 ? '+' : '') + number(value, digits) + ' ' + currency;
}

function timestamp(value, zone) {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';
  if (!dateFormats.has(zone)) {
    dateFormats.set(zone, new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      second: '2-digit', hourCycle: 'h23',
    }));
  }
  return dateFormats.get(zone).format(value);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function valueClass(value) {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
}

function selectField(label, choices, selected, change) {
  const field = el('label', 'th-filter');
  const select = el('select');
  for (const [id, label] of choices) select.add(new Option(label, id));
  select.value = selected;
  select.onchange = () => change(select.value);
  field.append(el('span', '', label), select);
  return field;
}

function totals(rows) {
  const section = el('section', 'th-totals');
  section.setAttribute('aria-label', '按币种汇总');
  for (const summary of summarizeTradeHistory(rows)) {
    const card = el('div', 'th-total');
    card.append(
      el('span', 'th-muted', summary.currency + ' · 已实现净盈亏'),
      el('strong', valueClass(summary.realizedPnl), money(summary.realizedPnl, summary.currency, true)),
      el('small', 'th-muted', summary.closedCount + ' 笔含平仓成交 · 手续费 ' + money(summary.fees, summary.currency)),
    );
    section.append(card);
  }
  return section;
}

const columns = ['品种', '行情时间', '方向', '成交数量', '成交价格', '手续费', '平仓净盈亏', '训练记录'];
const modeNames = { live: '实时交易', replay: '历史训练' };
const zoneNames = { UTC: 'UTC', 'Asia/Shanghai': '北京时间', 'Asia/Hong_Kong': '香港时间', 'America/New_York': '纽约时间' };

function tradeRow(row, currentId) {
  const tr = el('tr');
  function cell(column, text, detail, className = '') {
    const td = el('td');
    td.dataset.label = columns[column];
    td.append(el('span', className, text));
    if (detail) td.append(el('small', 'th-muted', detail));
    tr.append(td);
    return td;
  }
  cell(0, row.marketName, row.symbol, 'th-instrument');
  const numericTime = typeof row.time === 'number';
  cell(1, timestamp(numericTime ? row.time * 1000 : row.time, row.timeZone),
    numericTime ? (zoneNames[row.timeZone] || row.timeZone) : '');
  cell(2, row.direction, reasons[row.reason]);
  const qty = (n) => number(n, row.qtyDecimals || 0) + ' ' + row.qtyUnit;
  cell(3, qty(row.qty), row.status === 'reverse' ? '平 ' + qty(row.closedQty) + ' / 开 ' + qty(row.openedQty) : '');
  cell(4, number(row.price, row.precision) + ' ' + row.currency);
  cell(5, money(row.fee, row.currency));
  cell(6, row.realizedPnl == null ? '开仓时未结算' : money(row.realizedPnl, row.currency, true), '',
    row.realizedPnl == null ? 'th-muted' : 'th-pnl ' + valueClass(row.realizedPnl));
  const shortId = String(row.sessionId).slice(0, 8);
  const ref = modeNames[row.mode] + ' #' + shortId + (row.sessionId === currentId ? ' · 当前' : '');
  const account = cell(7, ref, row.recordedAt ? '记录于 ' + timestamp(row.recordedAt) : '');
  account.title = (row.recordedAt ? '本地记录时间 ' + timestamp(row.recordedAt) + ' · ' : '') + modeNames[row.mode] + ' ' + row.sessionId;
  return tr;
}

function ledger(rows, currentId) {
  const table = el('table', 'th-table');
  table.setAttribute('aria-label', '成交历史明细');
  const head = table.createTHead().insertRow();
  for (const name of columns) {
    const title = el('th', '', name);
    title.scope = 'col';
    head.append(title);
  }
  const body = table.createTBody();
  for (const row of rows) body.append(tradeRow(row, currentId));
  return table;
}

export function renderTradeHistory(root, sessions, currentSession) {
  const rows = buildTradeHistory(sessions, currentSession);
  const state = viewState.get(root) || { scope: 'all', mode: 'all', market: 'all', page: 1 };
  viewState.set(root, state);
  const tradedMarkets = new Set(rows.map((row) => row.marketId));
  const marketNames = new Map(MARKETS.filter((market) => tradedMarkets.has(market.id))
    .map((market) => [market.id, market.name]));
  if (!marketNames.has(state.market)) state.market = 'all';
  const currentId = currentSession?.id;

  function filter(key, value) {
    state[key] = value;
    state.page = 1;
    draw();
  }

  function draw() {
    const filtered = rows.filter((row) => (state.scope !== 'current' || row.sessionId === currentId) &&
      (state.mode === 'all' || row.mode === state.mode) && (state.market === 'all' || row.marketId === state.market));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.page = Math.min(state.page, pages);
    const page = el('div', 'th-view');
    const header = el('div', 'th-header');
    const title = el('div');
    title.append(el('h1', '', '交易历史'), el('p', 'th-muted', '平仓净盈亏已扣除对应的开仓和平仓手续费。'));
    const filters = el('div', 'th-filters');
    filters.append(
      selectField('训练范围', [['all', '全部训练'], ['current', '当前训练']], state.scope, (v) => filter('scope', v)),
      selectField('交易模式', [['all', '全部模式'], ...Object.entries(modeNames)], state.mode, (v) => filter('mode', v)),
      selectField('品种', [['all', '全部品种'], ...marketNames], state.market, (v) => filter('market', v)),
    );
    header.append(title, filters);
    page.append(header);
    if (filtered.length) page.append(totals(filtered));
    const panel = el('section', 'th-panel');
    const heading = el('div', 'th-heading');
    heading.append(el('h2', '', '成交明细'), el('span', 'th-muted', filtered.length + ' 笔成交 · 最近记录在前'));
    panel.append(heading);
    if (!filtered.length) {
      panel.append(el('p', 'th-empty th-muted', rows.length ? '所选范围内没有成交记录。' : '还没有成交记录。模拟订单成交后会显示在这里。'));
    } else {
      const holder = el('div', 'th-scroll');
      const start = (state.page - 1) * pageSize;
      holder.append(ledger(filtered.slice(start, start + pageSize), currentId));
      panel.append(holder);
      if (pages > 1) {
        const pager = el('div', 'th-pager');
        function button(label, next) {
          const node = el('button', '', label);
          node.type = 'button';
          node.disabled = next < 1 || next > pages;
          node.onclick = () => { state.page = next; draw(); };
          return node;
        }
        pager.append(button('上一页', state.page - 1), el('span', 'th-muted', state.page + ' / ' + pages),
          button('下一页', state.page + 1));
        panel.append(pager);
      }
    }
    page.append(panel);
    root.replaceChildren(page);
  }
  draw();
}
