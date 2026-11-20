import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineSeries,
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
      tickMarkMaxCharacterLength: 7,
    },
    localization: { locale: 'zh-CN' },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
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
  let activeMarket, displayKey, levelsKey, drawingKey, lastPriceColor;
  let ready = false,
    destroyed = false,
    lastWidth = root.clientWidth;
  let drawings = [],
    trendStart = null,
    tool = 'crosshair';
  let priceLevels = [],
    drawLines = [],
    drawSeries = [];

  function clearRenderedDrawings() {
    for (const line of drawLines) priceSeries.removePriceLine(line);
    for (const item of drawSeries) chart.removeSeries(item);
    drawLines = [];
    drawSeries = [];
  }
  function displayDrawings(force = false) {
    const valid = drawings.filter((d) => {
      if (d.type === 'horizontal')
        return Number.isFinite(d.price) && (!d.time || rowIndex.has(isoKey(d.time)));
      return (
        d.type === 'trend' &&
        d.points?.length === 2 &&
        d.points.every((p) => Number.isFinite(p.price) && rowIndex.has(isoKey(p.time)))
      );
    });
    const key = JSON.stringify([valid, trendStart]);
    if (!force && key === drawingKey) return;
    drawingKey = key;
    clearRenderedDrawings();
    for (const d of valid) {
      if (d.type === 'horizontal') {
        drawLines.push(
          priceSeries.createPriceLine({
            price: d.price,
            color: colors.drawing,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            title: '水平线',
          }),
        );
      } else {
        const points = [...d.points].sort(
          (a, b) => rowIndex.get(isoKey(a.time)) - rowIndex.get(isoKey(b.time)),
        );
        if (isoKey(points[0].time) === isoKey(points[1].time)) continue;
        const line = chart.addSeries(LineSeries, {
          color: colors.drawing,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          pointMarkersVisible: true,
          pointMarkersRadius: 2,
          autoscaleInfoProvider: () => null,
        });
        line.setData(points.map((p) => ({ time: p.time, value: p.price })));
        drawSeries.push(line);
      }
    }
    if (trendStart && rowIndex.has(isoKey(trendStart.time))) {
      drawLines.push(
        priceSeries.createPriceLine({
          price: trendStart.price,
          color: colors.drawing,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          title: '起点',
          axisLabelVisible: false,
        }),
      );
    }
  }
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
    for (const line of drawLines) line.applyOptions({ color: colors.drawing });
    for (const line of drawSeries) line.applyOptions({ color: colors.drawing });
    levelsKey = undefined;
    displayLevels(options.levels);
    renderMarkers();
  }
  document.addEventListener('wavelab-theme', applyTheme);

  function resetView() {
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
      drawings = [];
      trendStart = null;
      drawingKey = levelsKey = undefined;
      activeMarket = marketKey;
    }
    if (Array.isArray(next.drawings)) drawings = next.drawings.map((d) => structuredClone(d));
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
    displayDrawings();
    if (changedMarket || !prevRange || !oldLast) resetView();
    else if (prevRange && bars.length) {
      const lastIndex = rowIndex.get(isoKey(oldLast.time));
      const advanced = lastIndex === undefined ? 0 : bars.length - 1 - lastIndex;
      const shift = advanced > 0 && distanceFromEdge < 2 ? advanced : 0;
      chart.timeScale().setVisibleLogicalRange({ from: prevRange.from + shift, to: prevRange.to + shift });
    }
    ready = true;
  }

  function setTool(next) {
    tool = ['trend', 'horizontal'].includes(next) ? next : 'crosshair';
    trendStart = null;
    chart.applyOptions({ handleScroll: { pressedMouseMove: tool === 'crosshair' } });
    if (priceSeries) displayDrawings();
    callbacks.onToolChange?.(tool);
  }
  function getDrawings() {
    return structuredClone(drawings);
  }
  function clearDrawings() {
    drawings = [];
    setTool('crosshair');
    callbacks.onDrawingChange?.(getDrawings());
  }
  let pointerStart = null;
  root.addEventListener('pointerdown', (event) => {
    pointerStart =
      event.isPrimary && event.button === 0
        ? { x: event.clientX, y: event.clientY, id: event.pointerId }
        : null;
  });
  root.addEventListener('pointercancel', () => {
    pointerStart = null;
  });
  root.addEventListener('pointerup', (event) => {
    const start = pointerStart;
    pointerStart = null;
    if (tool === 'crosshair' || !start || start.id !== event.pointerId || event.target.closest('a')) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;
    const bounds = root.getBoundingClientRect();
    const x = event.clientX - bounds.left,
      y = event.clientY - bounds.top;
    const paneSize = chart.paneSize(0);
    if (x < 0 || y < 0 || x > paneSize.width || y > paneSize.height) return;
    const hit = rowIndex.get(isoKey(chart.timeScale().coordinateToTime(x)));
    const index = hit ?? (tool === 'horizontal' && bars.length ? bars.length - 1 : undefined);
    if (index === undefined) return;
    const price = priceSeries.coordinateToPrice(y);
    if (!Number.isFinite(price)) return;
    const point = { time: bars[index].time, price: Number(price.toFixed(options.precision)) };
    if (tool === 'horizontal') drawings.push({ type: 'horizontal', ...point });
    else if (!trendStart) {
      trendStart = point;
      displayDrawings();
      return;
    } else {
      if (isoKey(point.time) === isoKey(trendStart.time)) return;
      drawings.push({ type: 'trend', points: [trendStart, point] });
    }
    setTool('crosshair');
    callbacks.onDrawingChange?.(getDrawings());
  });
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
    chart.timeScale().setVisibleLogicalRange({ from: current.to - width, to: current.to });
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    ready = false;
    document.removeEventListener('wavelab-theme', applyTheme);
    observer.disconnect();
    chart.remove();
    root.remove();
  }
  return { update, resetView, zoom, setTool, clearDrawings, getDrawings, destroy };
}
