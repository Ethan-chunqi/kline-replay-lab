import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, TickMarkType, createChart,
} from './vendor/lightweight-charts-5.3.0.mjs';
import { intervalMs, rememberCryptoLevel } from './crypto-intervals.js';

const hour = intervalMs['1h'];
const decimals = { BTCUSDT: 2, BNBUSDT: 2, HYPEUSDT: 4, SOLUSDT: 3, ZECUSDT: 2 };
const locales = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', ru: 'ru-RU' };
const palettes = {
  dark: { background: '#181a20', axis: '#84919e', grid: '#2b3038', label: '#474e59', cross: '#6f7b8a', gold: '#f0b90b', up: '#0ecb81', down: '#f6465d', upVolume: '#1c5141', downVolume: '#67333c' },
  light: { background: '#ffffff', axis: '#5c6572', grid: '#e4e8ed', label: '#526176', cross: '#8793a2', gold: '#b77e00', up: '#0d9468', down: '#dc4257', upVolume: '#a5d9c4', downVolume: '#efb3ba' },
};
const nyOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' });
const offsetCache = new Map();

function region(view) {
  if (view.market === 'perpetual' || Object.hasOwn(decimals, view.symbol)) return 'crypto';
  return ['cn', 'a', 'a-share', 'china'].includes(String(view.market).toLowerCase()) ||
    /\.(SS|SH|SZ|BJ)$|^\d{6}$/.test(view.symbol) ? 'cn' : 'us';
}

// The library uses UTC for its tick grid. Shift timestamps for display, retaining the
// actual epoch for all price comparisons, market-session checks and hover callbacks.
function plotTime(ms, market) {
  let offset = 8;
  if (market === 'us') {
    const day = Math.floor(ms / 86_400_000);
    if (!offsetCache.has(day)) {
      const part = nyOffset.formatToParts(ms).find(p => p.type === 'timeZoneName')?.value;
      offsetCache.set(day, Number(part?.replace('GMT', '')) || -5);
    }
    offset = offsetCache.get(day);
  }
  return Math.floor(ms / 1000) + offset * 3600;
}

function samePrice(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function inStockSession(ms, market) {
  const local = new Date(plotTime(ms, market) * 1000);
  const weekday = local.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return market === 'us' ? minutes >= 570 && minutes < 960 :
    (minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900);
}

// Require certified contract/source identity as well as the exact price, time bucket
// and sufficient timestamp precision. A daily stock extreme cannot identify a 15m bar.
export function findLevelIndex(items, view, kind) {
  const levels = view.levels;
  const point = levels?.[kind];
  const width = intervalMs[view.interval];
  if (!point || !width || !view.sourceId || levels.sourceId !== view.sourceId || levels.symbol !== view.symbol ||
      (levels.status && levels.status !== 'ready') || (point.sourceId && point.sourceId !== view.sourceId) ||
      (point.symbol && point.symbol !== view.symbol) || !Number.isSafeInteger(point.time)) return -1;
  const precision = point.precisionMs ?? (point.precision === 'day' ? intervalMs['1d'] : 1);
  if (precision <= 0 || precision > width) return -1;
  const market = region(view);
  if (market !== 'crypto' && width === intervalMs['1d']) {
    const tradeDate = Math.floor(plotTime(point.time, market) / 86_400);
    return items.findIndex(b => Math.floor(plotTime(b.time, market) / 86_400) === tradeDate && samePrice(b[kind], point.price));
  }
  if (market !== 'crypto' && !inStockSession(point.time, market)) return -1;
  return items.findIndex(b => b.time <= point.time && point.time + precision <= b.time + width && samePrice(b[kind], point.price));
}

function timeFormats(locale, interval) {
  const make = options => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
  const day = make({ month: 'numeric', day: 'numeric' });
  const clock = make({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const full = make({ year: 'numeric', month: '2-digit', day: '2-digit',
    ...(interval === '1d' ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) });
  return {
    full: t => full.format(t * 1000),
    tick: (t, type) => {
      if (type === TickMarkType.Year) return String(new Date(t * 1000).getUTCFullYear());
      return (interval === '1d' || type <= TickMarkType.DayOfMonth ? day : clock).format(t * 1000);
    },
  };
}

function sameBar(a, b) {
  return a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low &&
    a.close === b.close && a.volume === b.volume && a.color === b.color && a.volumeColor === b.volumeColor;
}
function volumeBar(b) { return { time: b.time, value: b.volume, color: b.volumeColor }; }

export function createChartView(container, onHover = () => {}, options = {}) {
  const defaults = { symbol: 'BTCUSDT', market: 'perpetual', interval: '15m', sourceId: '', theme: 'dark', locale: 'zh', ...options };
  let view = defaults;
  let styleKey = '';
  let rows = [];
  let byTime = new Map();
  let matches = { high: -1, low: -1 };
  let hovered = null;
  let focused = null;
  let line;
  let selectedHours = 24;
  let disposed = false;
  const chart = createChart(container, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: palettes.dark.background }, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', attributionLogo: true },
    grid: { vertLines: { visible: false }, horzLines: { style: LineStyle.Dashed } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { visible: true, borderVisible: false, entireTextOnly: true, scaleMargins: { top: 0.11, bottom: 0.27 } },
    timeScale: { secondsVisible: false, rightOffset: 3, minBarSpacing: 0.3, lockVisibleTimeRangeOnResize: true },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
  });
  const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });
  const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: false, lastValueVisible: false });

  function configure(lastPrice) {
    const palette = palettes[view.theme] ?? palettes.dark;
    const locale = locales[String(view.locale).split('-')[0]] ?? 'zh-CN';
    const digits = Number.isInteger(view.precision) ? Math.max(0, Math.min(8, view.precision)) : decimals[view.symbol] ?? (lastPrice > 0 && lastPrice < 1 ? 4 : 2);
    const key = [view.theme,locale,digits,view.interval].join('/');
    if (styleKey === key) return palette;
    styleKey = key;
    const numbers = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const dates = timeFormats(locale, view.interval);
    const cross = { color: palette.cross, width: 1, style: LineStyle.Dashed, labelBackgroundColor: palette.label };
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: palette.background }, textColor: palette.axis },
      localization: { locale, priceFormatter: price => numbers.format(price), timeFormatter: dates.full },
      grid: { horzLines: { color: palette.grid } },
      timeScale: { borderColor: palette.grid, timeVisible: view.interval !== '1d', tickMarkFormatter: dates.tick },
      crosshair: { vertLine: { ...cross }, horzLine: { ...cross } },
    });
    candles.applyOptions({ upColor: palette.up, downColor: palette.down, wickUpColor: palette.up, wickDownColor: palette.down,
      priceFormat: { type: 'price', precision: digits, minMove: 10 ** -digits } });
    return palette;
  }

  function reset() {
    if (!rows.length || disposed) return;
    const last = rows.length - 1;
    const width = intervalMs[view.interval];
    const start = rows[last].time - Math.max(0, selectedHours * hour - width) / 1000;
    const byHours = rows.findIndex(b => b.time >= start);
    const minBars = view.interval === '1d' && selectedHours < 24 * 7 ? 90 : 1;
    const first = Math.max(0, Math.min(byHours, rows.length - minBars));
    candles.priceScale().setAutoScale(true);
    chart.timeScale().setVisibleLogicalRange({ from: first - 0.5, to: last + 2.5 });
  }
  function hover(event) {
    // LWC recalculates its crosshair after setVisibleLogicalRange. Its synthetic
    // mouse-leave must not replace the explicitly selected historical candle.
    if (focused != null && !event.sourceEvent) {
      hovered = focused;
      onHover(byTime.get(focused) ?? null);
      return;
    }
    hovered = event.point && event.point.x >= 0 && event.point.y >= 0 && event.point.x < container.clientWidth &&
      event.point.y < container.clientHeight ? event.time : null;
    if (hovered == null && focused != null) hovered = focused;
    onHover(byTime.get(hovered) ?? null);
  }
  chart.subscribeCrosshairMove(hover);

  function update(items, windowHours = 24, latestPrice = null, symbol = view.symbol, context = {}) {
    if (disposed) return;
    const next = { ...defaults, ...context, symbol };
    const switched = next.symbol !== view.symbol || next.sourceId !== view.sourceId || next.interval !== view.interval ||
      Boolean(next.historical) !== Boolean(view.historical) || region(next) !== region(view);
    const oldHours = selectedHours;
    const previous = switched ? [] : rows;
    if (switched) { hovered = null; focused = null; onHover(null); }
    view = next;
    selectedHours = Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24;
    const palette = configure(latestPrice ?? items.at(-1)?.close);
    const exchange = region(view);
    matches = { high: findLevelIndex(items, view, 'high'), low: findLevelIndex(items, view, 'low') };
    if (exchange === 'crypto') {
      for (const kind of ['high','low']) rememberCryptoLevel(view,kind,items,matches[kind]);
    }
    byTime = new Map();
    rows = items.map((item, index) => {
      const time = plotTime(item.time, exchange);
      let b = item;
      if (!view.historical && index === items.length - 1 && Number.isFinite(latestPrice) && latestPrice > 0) {
        b = { ...item, close: latestPrice, high: Math.max(latestPrice,item.high), low: Math.min(latestPrice,item.low) };
      }
      const extremes = [];
      if (index === matches.high) extremes.push('high');
      if (index === matches.low) extremes.push('low');
      byTime.set(time, extremes.length ? { ...b, extremes } : b);
      return {
        time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        volumeColor: b.close >= b.open ? palette.upVolume : palette.downVolume,
        ...(extremes.length ? { color: palette.gold, wickColor: palette.gold, borderColor: palette.gold } : {}),
      };
    });
    const canAppend = previous.length > 0 && previous.length <= rows.length &&
      previous.at(-1).time === rows[previous.length - 1].time &&
      previous.slice(0,-1).every((b,i) => sameBar(b,rows[i]));
    if (canAppend) {
      for (let i = previous.length - 1; i < rows.length; i++) {
        if (previous[i] && sameBar(previous[i],rows[i])) continue;
        candles.update(rows[i]);
        volume.update(volumeBar(rows[i]));
      }
    } else {
      const visible = chart.timeScale().getVisibleLogicalRange();
      const followsLatest = visible && visible.to >= previous.length - 1;
      const anchor = visible ? Math.max(0, Math.min(previous.length - 1, Math.round(visible.from))) : 0;
      candles.setData(rows);
      volume.setData(rows.map(volumeBar));
      if (rows.length && previous.length && visible && oldHours === selectedHours) {
        const index = rows.findIndex(b => b.time === previous[anchor].time);
        if (index >= 0 || followsLatest) {
          const offset = followsLatest ? rows.length - previous.length : index - anchor;
          chart.timeScale().setVisibleLogicalRange({ from: visible.from + offset, to: visible.to + offset });
        }
      }
    }

    const last = rows.at(-1);
    if (!last || view.historical) {
      if (line) candles.removePriceLine(line);
      line = undefined;
    } else {
      const color = last.close >= last.open ? palette.up : palette.down;
      const opts = { price: last.close, color, axisLabelColor: color, axisLabelTextColor: view.theme === 'light' ? '#ffffff' : '#10151b' };
      if (line) line.applyOptions(opts);
      else line = candles.createPriceLine({ ...opts, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
    }
    if (!previous.length || oldHours !== selectedHours) reset();
    if (hovered != null) onHover(byTime.get(hovered) ?? null);
    if (!last) onHover(null);
  }

  function locate(kind) {
    const i = matches[kind];
    if (disposed || !Number.isInteger(i) || i < 0 || !rows[i]) return false;
    const half = Math.min(35, rows.length / 2);
    const from = Math.max(-0.5, Math.min(i - half, rows.length - 2*half - 0.5));
    candles.priceScale().setAutoScale(true);
    chart.timeScale().setVisibleLogicalRange({ from, to: from + 2*half + 0.5 });
    const b = rows[i];
    focused = b.time;
    chart.setCrosshairPosition(b[kind], b.time, candles);
    hovered = b.time;
    onHover(byTime.get(b.time));
    return true;
  }

  configure();
  return {
    update, reset, locate,
    destroy() {
      if (disposed) return;
      disposed = true;
      chart.unsubscribeCrosshairMove(hover);
      chart.remove();
      byTime.clear();
      rows = [];
    },
  };
}
