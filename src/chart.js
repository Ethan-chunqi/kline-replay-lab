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

const COLORS = {
  background: '#ffffff',
  grid: '#e5ebee',
  axis: '#536477',
  border: '#d7e1e4',
  up: '#c53342',
  down: '#128061',
  drawing: '#17787f',
};
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
  root.setAttribute('aria-label', '蜡烛图，红色空心为上涨，绿色实心为下跌，可缩放查看行情');
  container.append(root);
  const chart = createChart(root, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: COLORS.background },
      textColor: COLORS.axis,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", sans-serif',
      fontSize: 10,
      attributionLogo: true,
    },
    grid: { vertLines: { visible: false }, horzLines: { color: COLORS.grid, style: LineStyle.Dashed } },
    rightPriceScale: { borderVisible: false, minimumWidth: 65 },
    leftPriceScale: { visible: false },
    timeScale: {
      borderVisible: true,
      borderColor: COLORS.border,
      secondsVisible: false,
      rightOffset: 3,
      barSpacing: 5.5,
      minBarSpacing: 1.5,
      fixLeftEdge: true,
      tickMarkMaxCharacterLength: 7,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#708597', style: LineStyle.Dashed, labelBackgroundColor: '#536477' },
      horzLine: { color: '#708597', style: LineStyle.Dashed, labelBackgroundColor: '#536477' },
    },
    localization: { locale: 'zh-CN' },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  });

  const priceSeries = chart.addSeries(CandlestickSeries, {
    upColor: COLORS.background,
    downColor: COLORS.down,
    borderVisible: true,
    borderUpColor: COLORS.up,
    borderDownColor: COLORS.down,
    wickUpColor: COLORS.up,
    wickDownColor: COLORS.down,
    priceLineVisible: true,
    priceLineWidth: 1,
    priceLineStyle: LineStyle.Dotted,
    priceLineColor: COLORS.up,
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
            color: COLORS.drawing,
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
          color: COLORS.drawing,
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
          color: COLORS.drawing,
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
          color: level.color || '#456b99',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
        }),
      );
  }
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
    const priceColor = latest && latest.close < latest.open ? COLORS.down : COLORS.up;
    if (lastPriceColor !== priceColor) {
      // Hollow up candles have a white body. Explicitly color the last-price line and axis label.
      priceSeries.applyOptions({ priceLineColor: priceColor });
      lastPriceColor = priceColor;
    }
    priceSeries.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const markers = (options.markers || [])
      .filter((m) => rowIndex.has(isoKey(m.time)))
      .map((m) => {
        const isBuy = String(m.side).toLowerCase() === 'buy';
        return {
          time: m.time,
          position: isBuy ? 'belowBar' : 'aboveBar',
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          color: isBuy ? '#b32c3a' : '#096b53',
          text: isBuy ? '买' : '卖',
          size: 1,
        };
      });
    markers.sort((a, b) => rowIndex.get(isoKey(a.time)) - rowIndex.get(isoKey(b.time)));
    markerPlugin.setMarkers(markers);
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
    observer.disconnect();
    chart.remove();
    root.remove();
  }
  return { update, resetView, zoom, setTool, clearDrawings, getDrawings, destroy };
}
