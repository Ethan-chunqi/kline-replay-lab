import {koreanHours} from './equities/korea-session.js?v=20261122-market-v3';
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, TickMarkType, createChart,
} from './vendor/lightweight-charts-5.3.0.mjs';
import { intervalMs, rememberCryptoLevel } from './crypto-intervals.js?v=20261122-market-v3';

const hour = intervalMs['1h'];
const decimals = { BTCUSDT: 2, BNBUSDT: 2, HYPEUSDT: 4, SOLUSDT: 3, ZECUSDT: 2, OKBUSDT:2, BGBUSDT:4 };
const locales = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', ru: 'ru-RU' };
const palettes = {
  dark: { background: '#181a20', axis: '#84919e', grid: '#2b3038', label: '#474e59', cross: '#6f7b8a', gold: '#fff28a', goldEdge:'#ffe325', goldHalo:'rgba(255,221,36,.86)', up: '#0ecb81', down: '#f6465d', upVolume: '#1c5141', downVolume: '#67333c' },
  light: { background: '#ffffff', axis: '#5c6572', grid: '#e4e8ed', label: '#526176', cross: '#8793a2', gold: '#ffe32b', goldEdge:'#795100', goldHalo:'rgba(255,192,0,.88)', up: '#0d9468', down: '#dc4257', upVolume: '#a5d9c4', downVolume: '#efb3ba' },
};
const nyOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' });
const offsetCache = new Map();

function region(view) {
  if(view.market==='kr' || view.timeZone==='Asia/Seoul')return 'kr';
  if (view.market === 'perpetual' || Object.hasOwn(decimals, view.symbol)) return 'crypto';
  return ['cn', 'a', 'a-share', 'china'].includes(String(view.market).toLowerCase()) ||
    /\.(SS|SH|SZ|BJ)$|^\d{6}$/.test(view.symbol) ? 'cn' : 'us';
}

// The library uses UTC for its tick grid. Shift timestamps for display, retaining the
// actual epoch for all price comparisons, market-session checks and hover callbacks.
function plotTime(ms, market) {
  let offset = market==='kr'?9:8;
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
  if (market==='kr') {
    const [opening,closing]=koreanHours(local.toISOString().slice(0,10));
    return minutes>=opening && minutes<closing;
  }
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

  // Highlight the verified price bar in place. A separate pane primitive preserves
  // a bright core, contrasting edge and small diamond even when thousands of bars
  // share a screen pixel. The overlay is drawn only at the two exact data points.
  const extremeOverlay = {
    zOrder: () => 'top',
    renderer: () => ({draw(target) {
      const palette=palettes[view.theme] ?? palettes.dark;
      const scale=chart.timeScale();
      target.useMediaCoordinateSpace(({context:ctx,mediaSize:size})=>{
        for (const i of new Set([matches.high,matches.low])) {
          const row=rows[i];
          if (!row) continue;
          const x=scale.timeToCoordinate(row.time);
          if (x==null || x<0 || x>size.width) continue;
          const [top,bottom,o,c]=[row.high,row.low,row.open,row.close].map(value=>candles.priceToCoordinate(value));
          if ([top,bottom,o,c].some(v=>v==null) || top>size.height || bottom<0) continue;
          const width=Math.max(2.5,Math.min(15,scale.options().barSpacing*.72));
          const y=Math.min(o,c), height=Math.max(2,Math.abs(c-o));
          ctx.save();
          ctx.shadowBlur=9;ctx.shadowColor=palette.goldHalo;
          ctx.lineWidth=3;ctx.strokeStyle=palette.goldEdge;
          ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
          ctx.shadowBlur=0;ctx.lineWidth=1;ctx.strokeStyle=palette.gold;
          ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
          ctx.fillStyle=palette.gold;ctx.strokeStyle=palette.goldEdge;ctx.lineWidth=1.2;
          ctx.fillRect(x-width/2,y,width,height);ctx.strokeRect(x-width/2,y,width,height);
          for(const [at,delta] of [[matches.high===i?top:null,-8],[matches.low===i?bottom:null,8]]) {
            if(at==null)continue;
            const marker=Math.max(5,Math.min(size.height-5,at+delta));
            ctx.shadowBlur=5;ctx.shadowColor=palette.goldHalo;
            ctx.beginPath();ctx.moveTo(x,marker-3.7);ctx.lineTo(x+3.7,marker);ctx.lineTo(x,marker+3.7);ctx.lineTo(x-3.7,marker);ctx.closePath();ctx.fill();ctx.stroke();
          }
          ctx.restore();
        }
      });
    }}),
  };
  candles.attachPrimitive({paneViews:()=>[extremeOverlay]});

  function configure(lastPrice) {
    const palette = palettes[view.theme] ?? palettes.dark;
    const locale = locales[String(view.locale).split('-')[0]] ?? 'zh-CN';
    const digits = Number.isInteger(view.precision) ? Math.max(0, Math.min(8, view.precision)) : decimals[view.symbol] ?? (lastPrice > 0 && lastPrice < 1 ? 4 : 2);
    const key = [view.theme,locale,digits,view.interval,Boolean(view.yearRange)].join('/');
    if (styleKey === key) return palette;
    styleKey = key;
    const numbers = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const dates = timeFormats(locale, view.interval);
    const cross = { color: palette.cross, width: 1, style: LineStyle.Dashed, labelBackgroundColor: palette.label };
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: palette.background }, textColor: palette.axis },
      localization: { locale, priceFormatter: price => numbers.format(price), timeFormatter: dates.full },
      grid: { horzLines: { color: palette.grid } },
      timeScale: { minBarSpacing:view.yearRange ? 0.001 : 0.3, borderColor: palette.grid, timeVisible: view.interval !== '1d', tickMarkFormatter: dates.tick },
      crosshair: { vertLine: { ...cross }, horzLine: { ...cross } },
    });
    candles.applyOptions({ upColor: palette.up, downColor: palette.down, wickUpColor: palette.up, wickDownColor: palette.down,
      priceFormat: { type: 'price', precision: digits, minMove: 10 ** -digits } });
    return palette;
  }

  function reset() {
    if (!rows.length || disposed) return;
    focused = null;
    hovered = null;
    chart.clearCrosshairPosition();
    onHover(null);
    const last = rows.length - 1;
    const width = intervalMs[view.interval];
    const start = rows[last].time - Math.max(0, selectedHours * hour - width) / 1000;
    const byHours = rows.findIndex(b => b.time >= start);
    const minBars = view.interval === '1d' && selectedHours < 24 * 7 ? 90 : 1;
    const first = view.yearRange ? 0 : Math.max(0, Math.min(byHours, rows.length - minBars));
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
      Boolean(next.historical) !== Boolean(view.historical) || Boolean(next.yearRange) !== Boolean(view.yearRange) || region(next) !== region(view);
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
      if (!view.historical && index === items.length - 1 && Number.isFinite(latestPrice) && latestPrice > 0 &&
          (view.interval!=='1m' || (view.asOf>=item.time && view.asOf<item.time+intervalMs['1m']))) {
        b = { ...item, close: latestPrice, high: Math.max(latestPrice,item.high), low: Math.min(latestPrice,item.low) };
      }
      const extremes = [];
      if (index === matches.high) extremes.push('high');
      if (index === matches.low) extremes.push('low');
      byTime.set(time, extremes.length ? { ...b, extremes } : b);
      return {
        time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        volumeColor: extremes.length ? palette.gold : b.close >= b.open ? palette.upVolume : palette.downVolume,
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

  function selectBar(bar, price) {
    focused = hovered = bar.time;
    onHover(byTime.get(bar.time));
    // Logical range changes apply on the chart's next draw. Computing the crosshair
    // coordinates sooner would pin it to the screen position from the old range.
    requestAnimationFrame(() => {
      if (!disposed && focused === bar.time && hovered === bar.time)
        chart.setCrosshairPosition(price,bar.time,candles);
    });
  }

  function locate(kind) {
    const i = matches[kind];
    if (disposed || !Number.isInteger(i) || i < 0 || !rows[i]) return false;
    const half = Math.min(35, rows.length / 2);
    const from = Math.max(-0.5, Math.min(i - half, rows.length - 2*half - 0.5));
    candles.priceScale().setAutoScale(true);
    chart.timeScale().setVisibleLogicalRange({ from, to: from + 2*half + 0.5 });
    const b = rows[i];
    selectBar(b,b[kind]);
    return true;
  }

  function focusDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !rows.length) return false;
    const start=Date.parse(date+'T00:00:00Z')/1000;
    const index=rows.findIndex(b=>b.time>=start);
    if(index<0)return false;
    const width=Math.min(96,rows.length);
    const first=Math.max(-.5,Math.min(index-4,rows.length-width-.5));
    candles.priceScale().setAutoScale(true);
    chart.timeScale().setVisibleLogicalRange({from:first,to:first+width});
    const b=rows[index];selectBar(b,b.close);
    return true;
  }
  configure();
  return {
    update, reset, locate, focusDate,
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
