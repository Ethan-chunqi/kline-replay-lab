import { attachDrawings } from './drawing-layer.js?v=20261124trend3';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineStyle,
  TickMarkType,
} from '../vendor/lightweight-charts/lightweight-charts.min.js';

const PALETTES = {
  light: {
    background: '#ffffff',
    grid: '#e5ebee',
    axis: '#536477',
    border: '#d7e1e4',
    up: '#c53342',
    upBody: '#ffffff',
    down: '#128061',
    drawing: '#17787f',
    crosshair: '#708597',
    crosshairLabel: '#536477',
    buy: '#b32c3a',
    sell: '#096b53',
    level: '#456b99',
    levelColors: {},
    description: '蜡烛图，红色空心为上涨，绿色实心为下跌，可缩放查看行情',
  },
  dark: {
    background: '#191919',
    grid: '#333333',
    axis: '#999999',
    border: '#333333',
    up: '#ff3d3b',
    upBody: '#ff3d3b',
    down: '#43bc7c',
    drawing: '#e5443c',
    crosshair: '#888888',
    crosshairLabel: '#4d4d4d',
    buy: '#ff6461',
    sell: '#60d294',
    level: '#9caec7',
    levelColors: {
      '#a96813': '#e4b85f',
      '#00876c': '#43bc7c',
      '#c44360': '#ff6461',
      '#5d6b9b': '#aaa1d7',
      '#526f89': '#91a9c3',
    },
    description: '蜡烛图，红色实心为上涨，绿色实心为下跌，可缩放查看行情',
  },
};
function activePalette() {
  return document.documentElement.dataset.theme === 'light' ? PALETTES.light : PALETTES.dark;
}
function chartColors(colors) {
  const crosshairLine = {
    color: colors.crosshair,
    style: LineStyle.Dashed,
    labelBackgroundColor: colors.crosshairLabel,
  };
  return {
    layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.axis },
    grid: { vertLines: { visible: false }, horzLines: { color: colors.grid, style: LineStyle.Dotted } },
    timeScale: { borderColor: colors.border },
    crosshair: { mode: CrosshairMode.Normal, vertLine: { ...crosshairLine }, horzLine: { ...crosshairLine } },
  };
}
function candleColors(colors) {
  return {
    upColor: colors.upBody,
    downColor: colors.down,
    borderUpColor: colors.up,
    borderDownColor: colors.down,
    wickUpColor: colors.up,
    wickDownColor: colors.down,
  };
}
const isoKey = (time) =>
  typeof time === 'object' && time !== null
    ? [time.year, String(time.month).padStart(2, '0'), String(time.day).padStart(2, '0')].join('-')
    : String(time);
function timeFormatters(zone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return timeFormatters('UTC');
  }
  function components(time) {
    if (typeof time === 'number') {
      return Object.fromEntries(
        formatter.formatToParts(new Date(time * 1000)).map((part) => [part.type, part.value]),
      );
    }
    const [year, month, day] = isoKey(time).split('-');
    return { year, month, day };
  }
  return {
    timeFormatter(time) {
      const { year, month, day, hour, minute } = components(time);
      return year + '-' + month + '-' + day + (hour ? ' ' + hour + ':' + minute : '');
    },
    tickMarkFormatter(time, tick) {
      const { year, month, day, hour, minute } = components(time);
      if (tick === TickMarkType.Year) return year;
      if (tick === TickMarkType.Month) return Number(month) + '月';
      if (tick === TickMarkType.Time || tick === TickMarkType.TimeWithSeconds) return hour + ':' + minute;
      return month + '/' + day;
    },
  };
}

export function createTradingChart(container, callbacks = {}) {
  const root = document.createElement('div');
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' });
  root.setAttribute('role', 'img');
  root.tabIndex = 0;
  root.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Delete Backspace');
  let colors = activePalette();
  const initial = chartColors(colors);
  root.setAttribute('aria-label', colors.description);
  container.append(root);
  const chart = createChart(root, {
    ...initial,
    autoSize: true,
    layout: {
      ...initial.layout,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", sans-serif',
      fontSize: 10,
      attributionLogo: true,
    },
    rightPriceScale: { borderVisible: false, minimumWidth: 65 },
    leftPriceScale: { visible: false },
    timeScale: {
      borderVisible: true,
      ...initial.timeScale,
      secondsVisible: false,
      rightOffset: 3,
      barSpacing: 5.5,
      minBarSpacing: 1.5,
      fixLeftEdge: true,
      rightBarStaysOnScroll: false,
      tickMarkMaxCharacterLength: 7,
    },
    localization: { locale: 'zh-CN' },
    handleScale: { mouseWheel: true },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  });

  const priceSeries = chart.addSeries(CandlestickSeries, {
    ...candleColors(colors),
    borderVisible: true,
    priceLineVisible: true,
    priceLineWidth: 1,
    priceLineStyle: LineStyle.Dotted,
    priceLineColor: colors.up,
    lastValueVisible: true,
  });
  chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.09, bottom: 0.08 } });
  const markerPlugin = createSeriesMarkers(priceSeries, [], { autoScale: false });
  let bars = [],
    rowIndex = new Map(),
    options = {};
  let activeMarket, displayKey, levelsKey, lastPriceColor;
  let ready = false,
    destroyed = false,
    lastWidth = root.clientWidth;
  let priceLevels = [];
  const timeAxis = chart.timeScale();
  const priceAxis = priceSeries.priceScale();
  let pan = null;

  function inPane(event) {
    const bounds = root.getBoundingClientRect();
    const { width, height } = chart.paneSize(0);
    const x = event.clientX - bounds.left,
      y = event.clientY - bounds.top;
    return x >= 0 && x < width && y >= 0 && y < height && !event.target.closest('a');
  }
  const drawing = attachDrawings({
    root, chart, priceSeries, callbacks, inPane,
    data: () => bars, row: (time) => rowIndex.get(isoKey(time)),
    precision: () => options.precision ?? 2, palette: () => colors, ready: () => ready,
  });
  function finishPan() {
    if (!pan) return;
    const { id } = pan;
    pan = null;
    root.removeAttribute('data-panning');
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
  }
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 2 || event.pointerType !== 'mouse' || !ready || !inPane(event)) return;
      const range = priceAxis.getVisibleRange();
      const top = priceSeries.coordinateToPrice(0),
        next = priceSeries.coordinateToPrice(1);
      if (!range || top == null || next == null) return;
      event.preventDefault();
      pan = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offset: timeAxis.scrollPosition(),
        spacing: timeAxis.options().barSpacing,
        range,
        pricePerPixel: top - next,
        movedY: false,
      };
      root.setPointerCapture(event.pointerId);
      root.setAttribute('data-panning', '');
      root.focus({ preventScroll: true });
    },
    true,
  );
  root.addEventListener('pointermove', (event) => {
    if (!pan || event.pointerId !== pan.id) return;
    if (!(event.buttons & 2)) return finishPan();
    const dx = event.clientX - pan.x,
      dy = event.clientY - pan.y;
    if (!pan.dragged && Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
    pan.dragged = true;
    timeAxis.scrollToPosition(pan.offset - dx / pan.spacing, false);
    if (Math.abs(dy) >= 3 || pan.movedY) {
      pan.movedY = true;
      const shift = dy * pan.pricePerPixel;
      priceAxis.setVisibleRange({ from: pan.range.from + shift, to: pan.range.to + shift });
    }
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(eventName, (event) => {
      if (pan?.id !== event.pointerId) return;
      const singleClick = eventName === 'pointerup' && !pan.dragged && drawing.selecting() &&
        Math.max(Math.abs(event.clientX - pan.x), Math.abs(event.clientY - pan.y)) < 3;
      finishPan();
      if (singleClick) {
        const bounds = root.getBoundingClientRect();
        drawing.selectAt(event.clientX - bounds.left, event.clientY - bounds.top);
      }
    });
  }
  root.addEventListener('contextmenu', (event) => {
    if (pan || (event.button === 2 && inPane(event))) event.preventDefault();
  });
  window.addEventListener('blur', finishPan);
  root.addEventListener('keydown', (event) => {
    if (event.target !== root || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (drawing.deleteSelectedTrend()) event.preventDefault();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    zoom(event.key === 'ArrowUp' ? 1.2 : 1 / 1.2);
  });

  function displayLevels(levels) {
    const key = JSON.stringify(levels);
    if (key === levelsKey) return;
    levelsKey = key;
    for (const level of priceLevels) priceSeries.removePriceLine(level);
    priceLevels = (levels || [])
      .filter((level) => Number.isFinite(level.price))
      .map((level) =>
        priceSeries.createPriceLine({
          price: level.price,
          title: level.title || '',
          color: colors.levelColors[level.color] || level.color || colors.level,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
        }),
      );
  }
  function renderMarkers() {
    const markers = (options.markers || [])
      .filter((m) => rowIndex.has(isoKey(m.time)))
      .map((m) => {
        const isBuy = String(m.side).toLowerCase() === 'buy';
        return {
          time: m.time,
          position: isBuy ? 'belowBar' : 'aboveBar',
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          color: isBuy ? colors.buy : colors.sell,
          text: isBuy ? '买' : '卖',
          size: 1,
        };
      });
    markers.sort((a, b) => rowIndex.get(isoKey(a.time)) - rowIndex.get(isoKey(b.time)));
    markerPlugin.setMarkers(markers);
  }
  function applyTheme() {
    const next = activePalette();
    if (next === colors) return;
    colors = next;
    root.setAttribute('aria-label', colors.description);
    chart.applyOptions(chartColors(colors));
    const last = bars.at(-1);
    lastPriceColor = last && last.close < last.open ? colors.down : colors.up;
    priceSeries.applyOptions({ ...candleColors(colors), priceLineColor: lastPriceColor });
    drawing.themeChanged();
    levelsKey = undefined;
    displayLevels(options.levels);
    renderMarkers();
  }
  document.addEventListener('wavelab-theme', applyTheme);

  function resetView() {
    finishPan();
    if (!bars.length) return;
    const mobile = root.clientWidth < 550;
    const count = Math.max(
      25,
      Math.min(230, Math.floor((root.clientWidth - (mobile ? 55 : 74)) / (mobile ? 4.4 : 5.5))),
    );
    const offset = mobile ? 2 : 3;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-0.7, bars.length - count),
      to: bars.length - 1 + offset,
    });
    chart.priceScale('right', 0).setAutoScale(true);
  }
  function update(visibleBars, next = {}) {
    if (destroyed) return;
    options = { precision: 2, ...options, ...next };
    options.precision = Math.max(0, Math.min(8, Math.trunc(options.precision) || 0));
    const marketKey = [options.marketId, options.timeframe].join('|');
    const oldLast = bars.at(-1);
    const prevRange = chart.timeScale().getVisibleLogicalRange();
    const distanceFromEdge = prevRange ? bars.length - 1 - prevRange.to : 0;
    const changedMarket = activeMarket !== marketKey;
    if (changedMarket) {
      levelsKey = undefined;
      activeMarket = marketKey;
    }
    ready = false;
    bars = visibleBars;
    rowIndex = new Map(bars.map((bar, i) => [isoKey(bar.time), i]));
    const key = [options.precision, options.timeZone, typeof bars[0]?.time].join('|');
    if (displayKey !== key) {
      displayKey = key;
      const { timeFormatter, tickMarkFormatter } = timeFormatters(options.timeZone || 'UTC');
      chart.applyOptions({
        timeScale: { timeVisible: typeof bars[0]?.time === 'number', tickMarkFormatter },
        localization: { timeFormatter },
      });
      priceSeries.applyOptions({
        priceFormat: { type: 'price', precision: options.precision, minMove: 10 ** -options.precision },
      });
    }
    const latest = bars.at(-1);
    const priceColor = latest && latest.close < latest.open ? colors.down : colors.up;
    if (lastPriceColor !== priceColor) {
      // Set explicitly so a hollow candle never gives the last-price label a white fill.
      priceSeries.applyOptions({ priceLineColor: priceColor });
      lastPriceColor = priceColor;
    }
    priceSeries.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    renderMarkers();
    displayLevels(options.levels);
    drawing.update(next.drawings, changedMarket);
    if (changedMarket || !prevRange || !oldLast) resetView();
    else if (prevRange && bars.length) {
      const lastIndex = rowIndex.get(isoKey(oldLast.time));
      const advanced = lastIndex === undefined ? 0 : bars.length - 1 - lastIndex;
      const shift = advanced > 0 && distanceFromEdge < 2 ? advanced : 0;
      chart.timeScale().setVisibleLogicalRange({ from: prevRange.from + shift, to: prevRange.to + shift });
    }
    ready = true;
  }

  chart.subscribeCrosshairMove((event) => {
    if (!ready) return;
    const idx = event.point ? rowIndex.get(isoKey(event.time)) : undefined;
    callbacks.onHover?.(idx === undefined ? null : bars[idx], idx > 0 ? bars[idx - 1] : null);
  });
  const observer = new ResizeObserver(() => {
    const width = root.clientWidth;
    if (width && Math.abs(width - lastWidth) > 120) resetView();
    lastWidth = width;
  });
  observer.observe(root);

  function zoom(factor) {
    const current = chart.timeScale().getVisibleLogicalRange();
    if (!current || !Number.isFinite(factor) || factor <= 0) return;
    const width = Math.max(9, Math.min(bars.length + 10, (current.to - current.from) / factor));
    const center = (current.from + current.to) / 2;
    chart.timeScale().setVisibleLogicalRange({ from: center - width / 2, to: center + width / 2 });
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    ready = false;
    finishPan();
    drawing.destroy();
    window.removeEventListener('blur', finishPan);
    document.removeEventListener('wavelab-theme', applyTheme);
    observer.disconnect();
    chart.remove();
    root.remove();
  }
  return {
    update,
    resetView,
    zoom,
    setTool: drawing.setTool,
    cancelDrawing: drawing.cancelDrawing,
    setDrawingOptions: drawing.setDrawingOptions,
    clearDrawings: drawing.clearDrawings,
    getDrawings: drawing.getDrawings,
    setTrendStyle: drawing.setTrendStyle,
    deleteSelectedTrend: drawing.deleteSelectedTrend,
    destroy,
  };
}
