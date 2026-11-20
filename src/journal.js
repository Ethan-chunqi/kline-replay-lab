import { getSnapshot } from './engine.js';

const svgNS = 'http://www.w3.org/2000/svg';
const paths = {
  back: 'M19 12H5m6-6-6 6 6 6',
  retry: 'M4 10a8 8 0 1 1 1 7m-1-6V5m0 6h6',
  export: 'M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5',
  notebook: 'M5 4h13a1 1 0 0 1 1 1v15H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Zm-1 13h15M8 8h7m-7 3h5',
  switch: 'M5 12h14m-6-6 6 6-6 6',
};

function svgElement(name, attrs = {}) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function icon(name) {
  const svg = svgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.65,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': true,
  });
  svg.append(svgElement('path', { d: paths[name] }));
  return svg;
}

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = String(content);
  return node;
}

function btn(text, kind, handler, glyph) {
  const node = el('button', 'jr-btn ' + kind);
  node.type = 'button';
  if (glyph) node.append(icon(glyph));
  node.append(document.createTextNode(text));
  if (handler) node.addEventListener('click', handler);
  return node;
}

function loadStyles() {
  const href = new URL('../journal.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => link.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

const timeFormatters = new Map();
function dateLabel(value, zone = 'UTC') {
  if (value == null || value === '') return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(typeof value === 'number' && Math.abs(value) < 1e11 ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return String(value);
  if (!timeFormatters.has(zone)) {
    timeFormatters.set(
      zone,
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return timeFormatters.get(zone).format(date);
}

function number(value, decimals = 2) {
  return Number.isFinite(value)
    ? value.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : '—';
}
const signed = (value, decimals = 2) => (value > 0 ? '+' : '') + number(value, decimals);
const mood = (value) => (value > 0 ? 'jr-up' : value < 0 ? 'jr-down' : '');
const currency = (value) =>
  ({ USD: '$', HKD: 'HK$', CNY: '¥', EUR: '€', JPY: 'JP¥' })[value] ?? (value ? value + ' ' : '');
const pct = (value) => number(value, 1) + '%';
const reasonNames = {
  market: '市价',
  limit: '限价',
  stop: '停止触发',
  stopLimit: '停止限价',
  stopLoss: '保护止损',
  takeProfit: '保护止盈',
  marginCall: '强制平仓',
};

function fillDirection(fill) {
  const buy = fill.side === 'buy';
  if (!fill.closedQty) return buy ? '买入开多' : '卖出开空';
  if (fill.closedQty + 1e-9 < fill.qty) return buy ? '平空转多' : '平多转空';
  return buy ? '买入平空' : '卖出平多';
}

function section(title, meta) {
  const node = el('section', 'jr-panel');
  const head = el('div', 'jr-section-head');
  head.append(el('h2', '', title));
  if (meta) head.append(el('span', 'jr-muted', meta));
  node.append(head);
  return { node, head };
}

function metric(label, value, footer, color) {
  const item = el('div', 'jr-metric');
  item.append(
    el('div', 'jr-muted', label),
    el('strong', 'jr-number ' + (color || ''), value),
    el('small', '', footer),
  );
  return item;
}

function benchmarkFor(session, bars, mark, strategyReturn) {
  const start = session.start;
  if (!Number.isInteger(start) || start < 0 || !bars[start]) return null;
  const end = mark ? bars.findIndex((b) => b.time === mark.time) : bars.length - 1;
  if (end < start) return null;
  const entry = bars[start].close;
  const exit = bars[end].close;
  if (![entry, exit].every((v) => Number.isFinite(v) && v > 0)) return null;
  const returnPct = (exit / entry - 1) * 100;
  const values = new Map();
  for (let i = start; i <= end; i++) {
    const price = bars[i].close;
    if (Number.isFinite(price) && price > 0)
      values.set(bars[i].time, (session.account.initialCash * price) / entry);
  }
  return { returnPct, excess: strategyReturn - returnPct, values };
}

function equityChart(account, mark, unit, displayTime, benchmark) {
  const { node, head } = section('账户净值');
  const group = el('div', 'jr-segment');
  head.append(group);
  const readout = el('div', 'jr-readout');
  const readValue = el('strong', 'jr-number');
  const readTime = el('span', 'jr-muted');
  readout.append(readValue, readTime);
  const chart = el('div', 'jr-chart');
  const plot = svgElement('svg', {
    preserveAspectRatio: 'none',
    viewBox: '0 0 900 135',
    tabindex: 0,
    role: 'img',
    'aria-label': '账户净值曲线，使用左右方向键查看各收盘点。',
  });
  const axis = el('div', 'jr-axis');
  chart.append(plot, axis);
  const dates = el('div', 'jr-dates');
  node.append(readout, chart, dates);
  const comparisons = el('div', 'jr-comparison');
  for (const [label, value, suffix] of [
    ['同期标的涨跌', benchmark?.returnPct, '%'],
    ['超额收益（百分点）', benchmark?.excess, ''],
  ]) {
    const item = el('div');
    item.append(
      el('small', '', label),
      el('b', 'jr-number ' + mood(value), Number.isFinite(value) ? signed(value) + suffix : '—'),
    );
    comparisons.append(item);
  }
  const benchmarkInfo = el('div', 'jr-benchmark-info');
  benchmarkInfo.append(
    el(
      'small',
      '',
      benchmark ? '基准按起点收盘价等额买入并持有，手续费和滑点均为零。' : '缺少起点行情，暂无同期对照。',
    ),
  );
  let showBenchmark = true;
  if (benchmark) {
    const toggle = btn('基准线', 'jr-small jr-benchmark-toggle', () => {
      showBenchmark = !showBenchmark;
      toggle.setAttribute('aria-pressed', String(showBenchmark));
      draw();
    });
    toggle.setAttribute('aria-pressed', 'true');
    benchmarkInfo.append(toggle);
  }
  node.append(comparisons, benchmarkInfo);
  let range = 0;
  let choose = () => {};
  let count = 0;
  let selected = 0;
  const all = account.equityCurve.length
    ? account.equityCurve
    : [{ time: account.lastTime ?? mark?.time, equity: account.initialCash }];
  const controls = [
    [0, '全部'],
    [30, '近30根'],
  ].map(([size, label]) => {
    const button = btn(label, 'jr-seg-btn', () => {
      range = size;
      draw();
    });
    group.append(button);
    return [size, button];
  });
  function draw() {
    for (const [size, b] of controls) b.setAttribute('aria-pressed', String(range === size));
    const data = range ? all.slice(-range) : all;
    count = data.length;
    let min = data[0].equity,
      max = min;
    for (const p of data) {
      const ref = showBenchmark ? benchmark?.values.get(p.time) : undefined;
      min = Math.min(min, p.equity, ref ?? p.equity);
      max = Math.max(max, p.equity, ref ?? p.equity);
    }
    const pad = Math.max((max - min) * 0.12, account.initialCash * 0.0005, 0.01);
    min = Math.max(0, min - pad);
    max += pad;
    const x = (i) => (count === 1 ? 450 : (i / (count - 1)) * 898 + 1);
    const valueY = (value) => 132 - ((value - min) / (max - min)) * 130;
    const y = (i) => valueY(data[i].equity);
    plot.replaceChildren();
    axis.replaceChildren();
    dates.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const py = 2 + i * 65;
      plot.append(svgElement('line', { x1: 0, y1: py, x2: 900, y2: py, class: 'jr-gridline' }));
      axis.append(el('span', '', number(max - (i * (max - min)) / 2, max - min < 2 ? 2 : 0)));
    }
    const points = data.map((p, i) => x(i).toFixed(2) + ',' + y(i).toFixed(2)).join(' ');
    if (count > 1)
      plot.append(
        svgElement('polygon', {
          points: x(0) + ',134 ' + points + ' ' + x(count - 1) + ',134',
          class: 'jr-area',
        }),
      );
    if (showBenchmark && benchmark) {
      let move = true;
      const path = data
        .map((p, i) => {
          const value = benchmark.values.get(p.time);
          if (value === undefined) {
            move = true;
            return '';
          }
          const segment = (move ? 'M' : 'L') + x(i).toFixed(2) + ',' + valueY(value).toFixed(2);
          move = false;
          return segment;
        })
        .join(' ');
      plot.append(svgElement('path', { d: path, class: 'jr-benchmark-line' }));
    }
    plot.append(svgElement('polyline', { points, class: 'jr-line' }));
    const guide = svgElement('line', { y1: 0, y2: 135, class: 'jr-guide' });
    const dot = svgElement('ellipse', { ry: 3.5, class: 'jr-dot' });
    plot.append(guide, dot);
    dates.append(
      el('span', '', displayTime(data[0].time)),
      el('span', '', count > 1 ? displayTime(data.at(-1).time) : ''),
    );
    choose = (i) => {
      selected = Math.max(0, Math.min(count - 1, i));
      guide.setAttribute('x1', x(selected));
      guide.setAttribute('x2', x(selected));
      dot.setAttribute('cx', x(selected));
      dot.setAttribute('cy', y(selected));
      dot.setAttribute('rx', (3.5 * 900) / (plot.getBoundingClientRect().width || 900));
      readValue.textContent = unit + number(data[selected].equity);
      readTime.textContent = displayTime(data[selected].time);
    };
    choose(count - 1);
  }
  plot.addEventListener('pointermove', (event) => {
    const bounds = plot.getBoundingClientRect();
    if (bounds.width) choose(Math.round(((event.clientX - bounds.left) / bounds.width) * (count - 1)));
  });
  plot.addEventListener('pointerleave', () => choose(count - 1));
  plot.addEventListener('keydown', (event) => {
    const next = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: count - 1 }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      choose(next);
    }
  });
  draw();
  return node;
}

function directions(fills, unit) {
  const { node } = section('多空表现');
  const closed = fills.filter((f) => f.closedQty > 0);
  for (const [exitSide, label] of [
    ['sell', '多头'],
    ['buy', '空头'],
  ]) {
    const trades = closed.filter((f) => f.side === exitSide);
    const net = trades.reduce((acc, f) => acc + f.realizedPnl, 0);
    const row = el('div', 'jr-performance');
    const first = el('div', 'jr-spread');
    first.append(el('b', '', label), el('strong', 'jr-number ' + mood(net), unit + signed(net)));
    const rate = trades.length
      ? (trades.filter((f) => f.realizedPnl > 1e-9).length / trades.length) * 100
      : 0;
    const track = el('div', 'jr-track');
    const bar = el('i');
    bar.style.width = rate + '%';
    track.append(bar);
    const last = el('small', 'jr-spread');
    last.append(
      el('span', '', trades.length + ' 笔已平仓'),
      el('span', '', '胜率 ' + (trades.length ? pct(rate) : '—')),
    );
    row.append(first, track, last);
    node.append(row);
  }
  return node;
}

function csvCell(value) {
  let str = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(str)) str = "'" + str;
  return '"' + str.replaceAll('"', '""') + '"';
}

function downloadCSV(account, market, displayTime) {
  const rows = [
    [
      '市场',
      '代码',
      '市场币种',
      '成交时间（' + (market.timeZone || 'UTC') + '）',
      '委托编号',
      '方向',
      '成交数量',
      '成交价',
      '费用',
      '平仓数量',
      '已实现盈亏',
      '成交类型',
    ],
  ];
  for (const f of account.fills) {
    rows.push([
      market.name,
      market.symbol,
      market.currency,
      displayTime(f.time),
      f.orderId,
      fillDirection(f),
      f.qty,
      Number(f.price.toFixed(8)),
      Number(f.fee.toFixed(8)),
      f.closedQty,
      f.closedQty ? Number(f.realizedPnl.toFixed(8)) : '',
      reasonNames[f.reason] || f.reason,
    ]);
  }
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download =
    '交易复盘-' +
    String(market.symbol || '训练').replace(/[^\w.\u4e00-\u9fff-]/g, '_') +
    '-' +
    displayTime(account.lastTime).slice(0, 10) +
    '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fillsPanel(fills, precision, displayTime) {
  const { node, head } = section('成交明细');
  const filter = el('select', 'jr-select');
  filter.setAttribute('aria-label', '筛选成交方向');
  for (const [value, label] of [
    ['all', '所有成交'],
    ['buy', '买入成交'],
    ['sell', '卖出成交'],
    ['close', '含平仓成交'],
  ]) {
    const option = el('option', '', label);
    option.value = value;
    filter.append(option);
  }
  head.append(filter);
  const contents = el('div');
  node.append(contents);
  let page = 1;
  function draw() {
    const filtered = fills
      .filter(
        (f) =>
          filter.value === 'all' || f.side === filter.value || (filter.value === 'close' && f.closedQty > 0),
      )
      .slice()
      .reverse();
    contents.replaceChildren();
    if (!filtered.length) {
      contents.append(
        el(
          'p',
          'jr-empty',
          fills.length
            ? '当前筛选下没有成交。'
            : '完成第一笔模拟交易后，成交价格、手续费和平仓盈亏会显示在这里。',
        ),
      );
      return;
    }
    const scroll = el('div', 'jr-scroll');
    const table = el('table', 'jr-table');
    const thead = el('thead'),
      header = el('tr');
    for (const label of ['成交时间', '方向', '数量', '成交价', '费用', '已实现盈亏'])
      header.append(el('th', '', label));
    thead.append(header);
    table.append(thead);
    const body = el('tbody');
    for (const f of filtered.slice((page - 1) * 8, page * 8)) {
      const tr = el('tr');
      const side = el('td');
      side.append(
        el('span', 'jr-tag ' + (f.side === 'buy' ? 'jr-tag-buy' : 'jr-tag-sell'), fillDirection(f)),
      );
      tr.append(
        el('td', '', displayTime(f.time)),
        side,
        el('td', '', f.qty.toLocaleString('zh-CN', { maximumFractionDigits: 8 })),
        el('td', '', number(f.price, precision)),
        el('td', '', number(f.fee)),
        el('td', f.closedQty ? mood(f.realizedPnl) : 'jr-muted', f.closedQty ? signed(f.realizedPnl) : '—'),
      );
      body.append(tr);
    }
    table.append(body);
    scroll.append(table);
    contents.append(scroll);
    const total = Math.ceil(filtered.length / 8);
    const foot = el('div', 'jr-pager');
    foot.append(el('small', '', filtered.length + ' 笔成交'));
    if (total > 1) {
      const previous = btn('上一页', 'jr-small', () => {
        page--;
        draw();
      });
      const next = btn('下一页', 'jr-small', () => {
        page++;
        draw();
      });
      previous.disabled = page === 1;
      next.disabled = page === total;
      foot.append(previous, el('small', '', page + ' / ' + total), next);
    }
    contents.append(foot);
  }
  filter.addEventListener('change', () => {
    page = 1;
    draw();
  });
  draw();
  return node;
}

function notesPanel(session, bar, onSave, displayTime) {
  const { node, head } = section('复盘笔记');
  const total = el('span', 'jr-muted');
  head.append(total);
  const form = el('form', 'jr-note-form');
  const input = el('textarea', 'jr-textarea');
  input.setAttribute('aria-label', '复盘笔记内容');
  input.placeholder = '写下这根 K 线上的判断或交易理由…';
  input.maxLength = 400;
  input.rows = 3;
  const controls = el('div', 'jr-note-controls');
  const stamp = el('small', '', displayTime(bar?.time ?? session.account.lastTime));
  const submit = el('button', 'jr-btn jr-primary', '记录笔记');
  submit.type = 'submit';
  submit.disabled = true;
  const message = el('small', 'jr-note-msg');
  message.setAttribute('role', 'status');
  controls.append(stamp, submit);
  form.append(input, controls, message);
  const list = el('div', 'jr-note-list');
  let shown = 4;
  function draw() {
    const notes = Array.isArray(session.notes) ? session.notes : [];
    total.textContent = notes.length + ' 条';
    list.replaceChildren();
    for (const note of notes.slice(-shown).reverse()) {
      const item = el('article', 'jr-note');
      item.append(el('time', '', displayTime(note.time)), el('p', '', String(note.text ?? note)));
      list.append(item);
    }
    if (notes.length > shown)
      list.append(
        btn('查看更多笔记', 'jr-small', () => {
          shown += 6;
          draw();
        }),
      );
  }
  input.addEventListener('input', () => {
    submit.disabled = !input.value.trim();
    message.textContent = '';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || submit.disabled) return;
    const note = { time: bar?.time ?? session.account.lastTime, text };
    if (!Array.isArray(session.notes)) session.notes = [];
    session.notes.push(note);
    submit.disabled = true;
    input.disabled = true;
    try {
      await onSave?.();
      input.value = '';
      message.textContent = '已保存';
      draw();
    } catch {
      const idx = session.notes.indexOf(note);
      if (idx >= 0) session.notes.splice(idx, 1);
      message.textContent = '保存失败，请重试。';
    } finally {
      input.disabled = false;
      submit.disabled = !input.value.trim();
    }
  });
  node.append(form, list);
  draw();
  return node;
}

function archivePanel(archives, onRestore) {
  const { node } = section('训练存档', archives.length + ' 组');
  if (!archives.length) {
    node.append(el('p', 'jr-empty jr-empty-thin', '暂无其他训练存档。'));
    return node;
  }
  const holder = el('div', 'jr-archives');
  const list = el('div', 'jr-archive-list');
  let size = 5;
  function draw() {
    list.replaceChildren();
    for (const item of archives.slice(0, size)) {
      const row = btn('', 'jr-archive', () => onRestore?.(item.id));
      const details = el('span', 'jr-archive-detail');
      details.append(
        el('b', '', item.label || item.marketName || '训练存档'),
        el('small', '', [item.marketName, dateLabel(item.date)].filter(Boolean).join(' · ')),
      );
      const ret = el(
        'span',
        'jr-number ' + mood(item.returnPct),
        Number.isFinite(item.returnPct) ? signed(item.returnPct) + '%' : '—',
      );
      row.append(details, ret, icon('switch'));
      list.append(row);
    }
    if (size < archives.length)
      list.append(
        btn('查看更多存档', 'jr-small', () => {
          size += 10;
          draw();
        }),
      );
  }
  draw();
  holder.append(list);
  node.append(holder);
  return node;
}

export function renderJournal(
  container,
  { session, market, bars = [], bar, onBack, onSave, onRestore, onRetry, archives = [] },
) {
  loadStyles();
  const account = session.account;
  const snapshot = getSnapshot(account, bar?.close ?? account.lastPrice);
  const unit = currency(market.currency);
  const displayTime = (value) => dateLabel(value, market.timeZone || 'UTC');
  const root = el('div', 'jr-view');
  const header = el('header', 'jr-header');
  const title = el('div');
  const marketInfo = [market.name, market.symbol].filter(Boolean).join(' · ');
  title.append(
    el('h1', '', '交易复盘'),
    el('p', 'jr-muted', marketInfo + '　/　' + displayTime(bar?.time ?? account.lastTime)),
  );
  const actions = el('div', 'jr-actions');
  const exportButton = btn(
    '导出成交 CSV',
    'jr-secondary',
    () => downloadCSV(account, market, displayTime),
    'export',
  );
  exportButton.disabled = !account.fills.length;
  actions.append(btn('返回训练', 'jr-secondary', onBack, 'back'));
  if (typeof onRetry === 'function') actions.append(btn('重练本段', 'jr-secondary', onRetry, 'retry'));
  actions.append(exportButton);
  header.append(title, actions);
  const metrics = el('div', 'jr-metrics');
  const closed = account.trades;
  metrics.append(
    metric('账户净值', unit + number(snapshot.equity), '初始资金 ' + unit + number(account.initialCash, 0)),
    metric(
      '累计盈亏',
      unit + signed(snapshot.pnl),
      '收益率 ' + signed(snapshot.returnPct) + '%',
      mood(snapshot.pnl),
    ),
    metric('平仓胜率', closed ? pct(snapshot.winRate) : '—', closed + ' 笔平仓成交'),
    metric('最大回撤', number(snapshot.maxDrawdownPct) + '%', '累计手续费 ' + unit + number(snapshot.fees)),
  );
  const layout = el('div', 'jr-layout');
  const benchmark = benchmarkFor(session, bars, bar, snapshot.returnPct);
  layout.append(
    equityChart(account, bar, unit, displayTime, benchmark),
    directions(account.fills, unit),
    fillsPanel(account.fills, market.precision ?? 2, displayTime),
    notesPanel(session, bar, onSave, displayTime),
  );
  root.append(header, metrics, layout, archivePanel(archives, onRestore));
  container.replaceChildren(root);
  return () => root.remove();
}
