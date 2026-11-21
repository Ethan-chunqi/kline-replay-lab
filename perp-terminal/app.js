import { startFeed } from './feed.js';
import { createChartView } from './chart.js';
import { createCycleTracker } from './cycle.js';
import { percent, pnl, parseAmount } from './metrics.js';

const byId = id => document.getElementById(id);
const number = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const amountFormat = new Intl.NumberFormat('en-US', {maximumFractionDigits: 8});
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function beijingBarTime(ms) {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(5,16).replace('T',' ');
}
const fullClock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const modeLabels = { loading: '连接中', live: '实时行情', stale: '历史快照', offline: '等待重连' };
const buttons = [...document.querySelectorAll('[data-hours]')];
const contracts = [...document.querySelectorAll('[data-symbol]')];
const decimals = { BTCUSDT: 2, BNBUSDT: 2, HYPEUSDT: 4, SOLUSDT: 3, ZECUSDT: 2 };
let symbol = 'BTCUSDT';
let priceFormat = number;
let stopFeed;
const cacheKey = 'tide-linear-perp-settings-v2';
let hours = 24;
let data = { candles: [], price: null, asOf: null, source: '', status: 'loading' };
let levels = null;
let hover = null;
let sparkFrame = 0;

function write(id, value) {
  const el = byId(id);
  if (el.textContent !== value) el.textContent = value;
}
function signed(n) {
  const sign = Math.abs(n) < .005 ? '' : n > 0 ? '+' : '−';
  return sign + number.format(Math.abs(n));
}
function tone(n) {
  return Math.abs(n) < .005 ? 'neutral' : n > 0 ? 'positive' : 'negative';
}
function age(when, asOf) {
  const minutes = Math.floor(Math.max(0, asOf - when) / 60_000);
  if (minutes === 0) return '不到 1 分钟前';
  const h = Math.floor(minutes / 60);
  if (h >= 24) return '约 ' + h.toLocaleString('en-US') + ' 小时前';
  const m = minutes % 60;
  return '约 ' + (h ? h + ' 小时' : '') + (m ? (h ? ' ' : '') + m + ' 分钟' : '') + '前';
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey));
    if (!saved || typeof saved !== 'object') return;
    if (parseAmount(String(saved.capital))) byId('capital').value = amountFormat.format(saved.capital);
    if ([...byId('leverage').options].some(o => o.value === String(saved.leverage))) byId('leverage').value = saved.leverage;
    if (contracts.some(b => b.dataset.symbol === saved.symbol)) symbol = saved.symbol;
    if (buttons.some(b => Number(b.dataset.hours) === saved.hours)) hours = saved.hours;
  } catch { /* Storage can be disabled. */ }
}
function restoreBasis(selected) {
  let entry = '';
  let custom = false;
  try {
    const stored = JSON.parse(localStorage.getItem(cacheKey + '/' + selected));
    if (parseAmount(String(stored?.entry))) entry = amountFormat.format(stored.entry);
    custom = Boolean(entry && stored?.basis === 'custom');
  } catch { /* Fresh instrument or disabled storage. */ }
  byId('basis').value = custom ? 'custom' : 'extremes';
  byId('entry').value = entry;
}
function save() {
  const capital = parseAmount(byId('capital').value);
  const entry = parseAmount(byId('entry').value);
  if (!capital || (byId('basis').value === 'custom' && !entry)) return;
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ capital, leverage: byId('leverage').value, symbol, hours }));
    localStorage.setItem(cacheKey + '/' + symbol, JSON.stringify({entry, basis: byId('basis').value}));
  } catch { /* Inputs still work without local storage. */ }
}
function renderOHLC() {
  const candle = hover ?? data.candles.at(-1);
  for (const id of ['open','high','low','close']) write(id, candle ? priceFormat.format(candle[id]) : '—');
}
function renderCalculator() {
  const capital = parseAmount(byId('capital').value);
  const leverage = Number(byId('leverage').value);
  const custom = byId('basis').value === 'custom';
  byId('entry-label').hidden = !custom;
  const entryValue = parseAmount(byId('entry').value);
  const error = !capital ? '请输入大于 0 的有效本金。' : custom && !entryValue ? '请输入大于 0 的有效开仓价。' : '';
  write('input-error', error);
  byId('input-error').hidden = !error;
  byId('capital').setAttribute('aria-invalid', String(!capital));
  byId('entry').setAttribute('aria-invalid', String(custom && !entryValue));
  for (const side of ['long','short']) {
    const long = side === 'long';
    const entry = custom ? entryValue : long ? levels?.low?.price : levels?.high?.price;
    const result = capital && entry && data.price ? pnl(capital, leverage, entry, data.price, long ? 1 : -1) : null;
    write(side+'-entry', entry ? priceFormat.format(entry) : '—');
    write(side+'-pnl', result ? signed(result.profit) : '—');
    write(side+'-roi', result ? signed(result.roi) + '%' : '—');
    byId(side+'-pnl').dataset.tone = result ? tone(result.profit) : 'neutral';
    byId(side+'-roi').dataset.tone = result ? tone(result.roi) : 'neutral';
  }
}
function plotSpark() {
  sparkFrame = 0;
  const canvas = byId('spark');
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const width = rect.width, height = rect.height;
  ctx.clearRect(0,0,width,height);
  const day = data.candles.slice(-96);
  if (!day.length) return;
  const values = [day[0].open, ...day.map(b => b.close)];
  const min = Math.min(...values), max = Math.max(...values);
  const spread = max - min || 1;
  const point = (v,i) => [3 + (width-10)*i/(values.length-1), max === min ? height/2 : 7 + (height-14)*(max-v)/spread];
  const points = values.map(point);
  ctx.lineWidth = 1;
  ctx.setLineDash([3,4]); ctx.strokeStyle = '#70798744';
  for (const fraction of [.2,.5,.8]) {
    ctx.beginPath();ctx.moveTo(0,height*fraction);ctx.lineTo(width,height*fraction);ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.beginPath();points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  ctx.strokeStyle = '#f5c842';ctx.lineJoin = 'round';ctx.lineWidth = 2;ctx.stroke();
  const last = points.at(-1);
  ctx.lineTo(last[0],height);ctx.lineTo(points[0][0],height);ctx.closePath();
  const gradient = ctx.createLinearGradient(0,3,0,height);
  gradient.addColorStop(0,'#efba294a');gradient.addColorStop(1,'#efba2901');
  ctx.fillStyle=gradient;ctx.fill();
  ctx.beginPath();ctx.arc(...last,5,0,2*Math.PI);ctx.fillStyle='#f4c73742';ctx.fill();
  ctx.beginPath();ctx.arc(...last,2.6,0,2*Math.PI);ctx.fillStyle='#ffe190';ctx.fill();
}
function scheduleSpark() {
  if (!sparkFrame) sparkFrame = requestAnimationFrame(plotSpark);
}
function renderWindowControls() {
  for (const b of buttons) b.setAttribute('aria-pressed', String(Number(b.dataset.hours) === hours));

}
function renderLevels() {
  const certified = levels?.symbol === symbol && levels?.sourceId === data.sourceId && levels?.high && levels?.low;
  write('cycle-status', certified ? '合约全历史' : levels?.status === 'unavailable' ? '历史待核验' : '核对历史中');
  byId('cycle-status').title = '最高价取该交易所永续合约全部成交历史，最低价取该高点之后。';
  for (const side of ['high','low']) {
    const point = certified ? levels[side] : null;
    const el = byId(side+'-at');
    const pctId = side === 'high' ? 'drawdown' : 'rebound';
    if (!point) {
      for (const id of [side+'-price', side+'-at', side+'-ago', pctId]) write(id, '—');
      el.removeAttribute('datetime');
      continue;
    }
    write(side+'-price', priceFormat.format(point.price));
    write(side+'-at', new Date(point.time + 8 * 3_600_000).toISOString().slice(0,16).replace('T',' '));
    el.dateTime = new Date(point.time).toISOString();
    el.title = '北京时间，' + (point.precisionMs === 1 ? '按成交时间显示' : '精确到所在的 ' + Math.round(point.precisionMs / 60_000) + ' 分钟 K 线');
    write(side+'-ago', age(point.time, data.asOf));
    write(pctId, signed(percent(data.price, point.price)) + '%');
  }
}

restore();
renderWindowControls();
const chart = createChartView(byId('chart'), candle => { hover = candle; renderOHLC(); });
const cycle = createCycleTracker(next => {
  if (!data.sourceId || !next || next.sourceId !== data.sourceId || next.symbol !== symbol) return;
  levels = next;
  renderLevels();
  renderCalculator();
});
function render(next) {
  if (next.symbol !== symbol) return;
  if (levels && (levels.sourceId !== next.sourceId || levels.symbol !== symbol)) levels = null;
  data = next;
  if (data.market === 'perpetual' && data.candles.length) cycle.update(data);
  byId('connection').dataset.status = data.status;
  write('status-label', modeLabels[data.status]);
  byId('chart-empty').hidden = data.candles.length > 0;
  write('chart-empty', data.status === 'offline' ? '行情暂不可用，正在重连…' : '正在获取 K 线…');
  const stale = data.status === 'stale';
  byId('feed-notice').hidden = !stale && data.status !== 'offline';
  if (stale) write('feed-notice', '正在重连行情。当前显示 '+data.source+' 在 '+fullClock.format(data.asOf)+' 的快照，高低点、时间差和收益均按该时刻计算。');
  if (data.status === 'offline') write('feed-notice','行情源暂时无法连接，恢复连接后会自动更新。');
  write('price', data.price ? priceFormat.format(data.price) : '—');
  if (data.candles.length) {
    const day = data.candles.slice(-96);
    const change = percent(data.price,day[0].open);
    write('change24', signed(change)+'%');
    byId('change24').dataset.tone = tone(change);
    byId('change24').title = '按最近 96 根 15 分钟 K 线首根开盘价计算';
    const previousDay = beijingBarTime(day[0].time).slice(0,5) !== beijingBarTime(data.asOf).slice(0,5);
    write('trend-start', (previousDay ? '昨日 ' : '今日 ') + clock.format(day[0].time));
    write('trend-end', '今日 ' + clock.format(data.asOf));
    write('day-high', priceFormat.format(Math.max(...day.map(bar => bar.high))));
    write('day-low', priceFormat.format(Math.min(...day.map(bar => bar.low))));
    write('trend-range', symbol.slice(0,-4) + ' / USDT');
  } else {
    for (const id of ['day-high','day-low','change24','trend-start','trend-end']) write(id, '—');
    byId('change24').dataset.tone = 'neutral';
    write('trend-range', symbol.slice(0,-4) + ' / USDT');
  }
  write('foot-source', data.source ? data.source+' · USDT 永续合约' : '等待行情源');
  write('updated', data.asOf ? '报价更新于 '+fullClock.format(data.asOf) : '等待报价');
  chart.update(data.candles,hours,data.price,symbol);
  renderOHLC(); renderLevels(); renderCalculator(); scheduleSpark();
}

for (const btn of buttons) btn.addEventListener('click', () => {
  hours = Number(btn.dataset.hours);
  hover = null;
  renderWindowControls();chart.update(data.candles,hours,data.price,symbol);renderOHLC();save();
});
byId('reset').addEventListener('click', () => { chart.reset();hover = null;renderOHLC(); });
for (const id of ['capital','entry']) {
  const field = byId(id);
  field.addEventListener('input', () => { renderCalculator();save(); });
  field.addEventListener('blur', () => {
    const amount = parseAmount(field.value);
    if (amount && amount >= .00000001) field.value = amountFormat.format(amount);
    renderCalculator();save();
  });
}
for (const id of ['basis','leverage']) byId(id).addEventListener('change', () => {
  if (id === 'basis' && byId('basis').value === 'custom' && !byId('entry').value && data.price) byId('entry').value = priceFormat.format(data.price);
  renderCalculator();save();
});
function showSection(id) {
  byId('nav-calc').classList.toggle('active', id === 'calculator');
  byId('nav-market').classList.toggle('active', id !== 'calculator');
}
for (const link of document.querySelectorAll('nav a,.brand')) link.addEventListener('click', () => showSection(link.hash.slice(1)));
window.addEventListener('hashchange', () => showSection(location.hash.slice(1)));
showSection(location.hash.slice(1));
new ResizeObserver(scheduleSpark).observe(byId('spark'));
function openContract(selected, changeUrl = true) {
  if (!contracts.some(b => b.dataset.symbol === selected)) return;
  if (stopFeed) stopFeed();
  hover = null;
  levels = null;
  symbol = selected;
  const code = symbol.slice(0,-4);
  const digits = decimals[symbol];
  priceFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  byId('asset-name').replaceChildren(document.createTextNode(code), Object.assign(document.createElement('span'), {textContent:'USDT'}));
  byId('hero-coin').src = './coins/' + code + '.png';
  byId('volume-unit').textContent = code;
  document.title = code + 'USDT 永续 · 潮汐行情';
  for (const b of contracts) b.setAttribute('aria-pressed', String(b.dataset.symbol === selected));
  restoreBasis(symbol);
  if (changeUrl) {
    const url = new URL(location.href);
    url.searchParams.set('symbol', symbol);
    history.replaceState(null,'',url);
  }
  stopFeed = startFeed(render, symbol);
  save();
}

for (const [i, button] of contracts.entries()) {
  button.addEventListener('click', () => {
    if (button.dataset.symbol !== symbol) openContract(button.dataset.symbol);
  });
  button.addEventListener('keydown', event => {
    const offset = {ArrowLeft:-1, ArrowRight:1}[event.key];
    if (!offset) return;
    event.preventDefault();
    const next = contracts[(i + offset + contracts.length) % contracts.length];
    next.focus();
    next.click();
  });
}
const urlSymbol = new URLSearchParams(location.search).get('symbol');
openContract(contracts.some(b => b.dataset.symbol === urlSymbol) ? urlSymbol : symbol, false);
