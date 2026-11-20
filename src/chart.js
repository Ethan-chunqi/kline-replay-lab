import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
} from '../vendor/lightweight-charts/lightweight-charts.min.js';

const COLORS = {
  background: '#ffffff',
  grid: '#e5ebee',
  axis: '#536477',
  border: '#d7e1e4',
  up: '#00876c',
  down: '#c44360',
  line: '#00876c',
  ma5: '#a96813',
  ma10: '#256f9c',
  ma20: '#7851a7',
  ma60: '#356fa8',
  band: '#5778aa',
  rsi: '#7952a6',
  macd: '#2c66a4',
  signal: '#a96813',
  drawing: '#17787f',
};
const numeral = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const isoKey = (time) =>
  typeof time === 'object' && time !== null
    ? [time.year, String(time.month).padStart(2, '0'), String(time.day).padStart(2, '0')].join('-')
    : String(time);
const volumeString = (value) =>
  value >= 1e8
    ? numeral.format(value / 1e8) + '亿'
    : value >= 1e4
      ? numeral.format(value / 1e4) + '万'
      : numeral.format(value);

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

// All studies consume only the visible prefix. A value is omitted until its warm-up is complete.
function studyValues(bars, flags) {
  const rows = [];
  const windows = [5, 10, 20, 60].filter((n) => flags.has('MA' + n) || (n === 20 && flags.has('BOLL')));
  const sums = Object.fromEntries(windows.map((n) => [n, 0]));
  let sumSquares = 0,
    gain = 0,
    loss = 0,
    fast = 0,
    slow = 0,
    signal = 0;
  for (let i = 0; i < bars.length; i++) {
    const { close } = bars[i];
    const row = { VOL: bars[i].volume };
    for (const n of windows) {
      sums[n] += close - (i >= n ? bars[i - n].close : 0);
      if (i >= n - 1) row['MA' + n] = sums[n] / n;
    }
    if (flags.has('BOLL')) {
      sumSquares += close * close - (i >= 20 ? bars[i - 20].close ** 2 : 0);
      if (i >= 19) {
        const width = 2 * Math.sqrt(Math.max(0, sumSquares / 20 - row.MA20 ** 2));
        row.UPPER = row.MA20 + width;
        row.LOWER = row.MA20 - width;
      }
    }
    if (flags.has('RSI') && i) {
      const delta = close - bars[i - 1].close;
      const g = Math.max(delta, 0),
        l = Math.max(-delta, 0);
      if (i <= 14) {
        gain += g / 14;
        loss += l / 14;
      } else {
        gain = (13 * gain + g) / 14;
        loss = (13 * loss + l) / 14;
      }
      if (i >= 14) row.RSI = gain + loss ? (100 * gain) / (gain + loss) : 50;
    }
    if (flags.has('MACD')) {
      fast = i ? fast + (2 / 13) * (close - fast) : close;
      slow = i ? slow + (2 / 27) * (close - slow) : close;
      const spread = fast - slow;
      if (i >= 25) {
        signal = i === 25 ? spread : signal + (2 / 10) * (spread - signal);
        row.DIF = spread;
        if (i >= 33) {
          row.DEA = signal;
          row.HIST = 2 * (spread - signal);
        }
      }
    }
    rows.push(row);
  }
  return rows;
}

function normalizeIndicators(list) {
  const values = Array.isArray(list) ? list : ['MA', 'VOL'];
  const expanded = values
    .map((value) => String(value).toUpperCase())
    .flatMap((value) => {
      if (value === 'MA') return ['MA5', 'MA20'];
      if (value === 'VOLUME') return ['VOL'];
      if (value === 'RSI14') return ['RSI'];
      return [value];
    });
  return new Set(expanded);
}

const legendStyle = {
  position: 'absolute',
  left: '12px',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  columnGap: '13px',
  rowGap: '1px',
  maxWidth: 'calc(100% - 96px)',
  pointerEvents: 'none',
  font: '10px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, sans-serif',
  letterSpacing: '.02em',
  zIndex: '2',
  color: COLORS.axis,
};

export function createTradingChart(container, callbacks = {}) {
  const root = document.createElement('div');
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'K线练习图，包含价格与已启用的技术指标');
  container.append(root);
  const chart = createChart(root, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: COLORS.background },
      textColor: COLORS.axis,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", sans-serif',
      fontSize: 10,
      attributionLogo: true,
      panes: { separatorColor: COLORS.border, separatorHoverColor: '#a2b6bd', enableResize: false },
    },
    grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
    rightPriceScale: { borderVisible: false, minimumWidth: 65 },
    leftPriceScale: { visible: false },
    timeScale: {
      borderVisible: true,
      borderColor: COLORS.border,
      secondsVisible: false,
      rightOffset: 4,
      barSpacing: 9,
      minBarSpacing: 2,
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

  let bars = [],
    rowIndex = new Map(),
    studies = [],
    options = {};
  let activeMarket,
    layoutKey,
    levelsKey,
    drawingKey,
    ready = false;
  let priceSeries,
    markerPlugin,
    overlays = [],
    priceLevels = [],
    series = [],
    legends = [];
  let drawings = [],
    trendStart = null,
    tool = 'crosshair',
    hoveredTime;
  let drawLines = [],
    drawSeries = [];
  let lastWidth = root.clientWidth;
  let layoutFrame = 0,
    destroyed = false;

  function mainSeries(definition, cfg, pane = 0) {
    const item = chart.addSeries(definition, cfg, pane);
    series.push(item);
    return item;
  }
  function makeLegend(pane) {
    const element = document.createElement('div');
    Object.assign(element.style, legendStyle);
    root.append(element);
    const legend = { element, pane, items: [] };
    legends.push(legend);
    return legend;
  }
  function legendItem(legend, key, label, color, format) {
    const span = document.createElement('span');
    const title = document.createElement('span');
    title.textContent = label + ' ';
    title.style.color = '#536477';
    const val = document.createElement('span');
    val.style.color = color;
    span.append(title, val);
    legend.element.append(span);
    legend.items.push({ key, val, format });
  }
  function layoutLegends() {
    if (destroyed) return;
    const panes = chart.panes();
    let top = 0;
    for (let i = 0; i < panes.length; i++) {
      for (const legend of legends.filter((entry) => entry.pane === i)) {
        legend.element.style.top = top + 5 + 'px';
      }
      top += panes[i].getHeight() + 1;
    }
  }
  function scheduleLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(layoutLegends);
  }
  function renderLegend(index) {
    const values = studies[index] || {};
    for (const legend of legends) {
      for (const item of legend.items) {
        const value = values[item.key];
        item.val.textContent = Number.isFinite(value)
          ? item.format
            ? item.format(value)
            : value.toFixed(options.precision)
          : '—';
      }
    }
  }
  function clearRenderedDrawings() {
    for (const line of drawLines) priceSeries.removePriceLine(line);
    for (const item of drawSeries) chart.removeSeries(item);
    drawLines = [];
    drawSeries = [];
  }
  function removeLayout() {
    clearRenderedDrawings();
    drawLines = [];
    for (const line of priceLevels) priceSeries.removePriceLine(line);
    priceLevels = [];
    markerPlugin?.detach();
    markerPlugin = null;
    for (const item of series.reverse()) chart.removeSeries(item);
    series = [];
    overlays = [];
    for (const legend of legends) legend.element.remove();
    legends = [];
    levelsKey = drawingKey = undefined;
  }

  function buildLayout(flags) {
    const precision = options.precision;
    const priceFormat = { type: 'price', precision, minMove: Math.pow(10, -precision) };
    const isLine = options.type === 'line';
    const priceOptions = {
      priceFormat,
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dotted,
      lastValueVisible: true,
      title: '',
    };
    priceSeries = isLine
      ? mainSeries(LineSeries, { ...priceOptions, color: COLORS.line, lineWidth: 2 })
      : mainSeries(CandlestickSeries, {
          ...priceOptions,
          upColor: COLORS.up,
          downColor: COLORS.down,
          borderVisible: false,
          wickUpColor: COLORS.up,
          wickDownColor: COLORS.down,
        });
    chart.priceScale('right', 0).applyOptions({ scaleMargins: { top: 0.15, bottom: 0.09 } });
    markerPlugin = createSeriesMarkers(priceSeries, [], { autoScale: false });
    const mainLegend = makeLegend(0);
    const addOverlay = (key, color, label, pane, legend, custom = {}) => {
      const isHistogram = ['VOL', 'HIST'].includes(key);
      const cfg = {
        color,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: '',
        lineWidth: 1,
        priceFormat,
        ...custom,
      };
      const item = mainSeries(isHistogram ? HistogramSeries : LineSeries, cfg, pane);
      overlays.push({ key, item });
      if (label) legendItem(legend, key, label, color, key === 'VOL' ? volumeString : null);
      return item;
    };
    for (const n of [5, 10, 20, 60]) {
      if (flags.has('MA' + n)) addOverlay('MA' + n, COLORS['ma' + n], 'MA' + n, 0, mainLegend);
    }
    if (flags.has('BOLL')) {
      if (!flags.has('MA20')) addOverlay('MA20', COLORS.ma20, 'BOLL 中轨', 0, mainLegend);
      addOverlay('UPPER', COLORS.band, '上轨', 0, mainLegend, { lineStyle: LineStyle.Dashed });
      addOverlay('LOWER', COLORS.band, '下轨', 0, mainLegend, { lineStyle: LineStyle.Dashed });
    }
    let pane = 0;
    if (flags.has('VOL')) {
      const legend = makeLegend(++pane);
      addOverlay('VOL', COLORS.up, '成交量', pane, legend, {
        priceFormat: { type: 'custom', minMove: 1, formatter: volumeString },
        base: 0,
      });
      chart.panes()[pane].setStretchFactor(0.23);
      chart.priceScale('right', pane).applyOptions({ scaleMargins: { top: 0.29, bottom: 0.02 } });
    }
    if (flags.has('RSI')) {
      const legend = makeLegend(++pane);
      const item = addOverlay('RSI', COLORS.rsi, 'RSI 14', pane, legend);
      [30, 70].forEach((price) =>
        item.createPriceLine({
          price,
          color: '#becccf',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        }),
      );
      chart.panes()[pane].setStretchFactor(0.32);
      chart.priceScale('right', pane).applyOptions({ scaleMargins: { top: 0.24, bottom: 0.12 } });
    }
    if (flags.has('MACD')) {
      const legend = makeLegend(++pane);
      addOverlay('HIST', COLORS.up, 'MACD', pane, legend, { base: 0 });
      addOverlay('DIF', COLORS.macd, 'DIF', pane, legend);
      addOverlay('DEA', COLORS.signal, 'DEA', pane, legend);
      chart.panes()[pane].setStretchFactor(0.32);
      chart.priceScale('right', pane).applyOptions({ scaleMargins: { top: 0.24, bottom: 0.1 } });
    }
    chart.panes()[0].setStretchFactor(1);
    const time = timeFormatters(options.timeZone || 'UTC');
    chart.applyOptions({
      timeScale: {
        timeVisible: typeof bars[0]?.time === 'number',
        tickMarkFormatter: time.tickMarkFormatter,
      },
      localization: { timeFormatter: time.timeFormatter },
    });
    scheduleLayout();
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
      Math.min(115, Math.floor((root.clientWidth - (mobile ? 55 : 74)) / (mobile ? 6.4 : 8.1))),
    );
    const offset = mobile ? 2.8 : 4.5;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-0.7, bars.length - count),
      to: bars.length - 1 + offset,
    });
    chart.priceScale('right', 0).setAutoScale(true);
  }
  function update(visibleBars, next = {}) {
    if (destroyed) return;
    options = { type: 'candles', indicators: ['MA', 'VOL'], precision: 2, ...options, ...next };
    options.precision = Math.max(0, Math.min(8, Math.trunc(options.precision) || 0));
    const marketKey = [options.marketId, options.timeframe].join('|');
    const oldLast = bars.at(-1);
    const prevRange = chart.timeScale().getVisibleLogicalRange();
    const distanceFromEdge = prevRange ? bars.length - 1 - prevRange.to : 0;
    const changedMarket = activeMarket !== marketKey;
    const flags = normalizeIndicators(options.indicators);
    const key = [
      Array.from(flags).sort().join(','),
      options.type,
      options.precision,
      options.timeZone,
      typeof visibleBars[0]?.time,
    ].join('|');
    const rebuild = layoutKey !== key;
    if (changedMarket) {
      drawings = [];
      trendStart = null;
      hoveredTime = undefined;
      activeMarket = marketKey;
    }
    if (Array.isArray(next.drawings)) drawings = next.drawings.map((d) => structuredClone(d));
    if (changedMarket || rebuild) {
      removeLayout();
      ready = false;
    }
    bars = visibleBars;
    rowIndex = new Map(bars.map((bar, i) => [isoKey(bar.time), i]));
    if (changedMarket || rebuild) {
      layoutKey = key;
      buildLayout(flags);
    }
    studies = studyValues(bars, flags);
    const toPrice = (bar) => (options.type === 'line' ? { time: bar.time, value: bar.close } : { ...bar });
    priceSeries.setData(bars.map(toPrice));
    for (const { key: metric, item } of overlays) {
      const values = [];
      for (let i = 0; i < bars.length; i++) {
        const value = studies[i][metric];
        if (!Number.isFinite(value)) continue;
        const datum = { time: bars[i].time, value };
        if (metric === 'VOL') datum.color = bars[i].close >= bars[i].open ? '#79b7a8' : '#d493a0';
        if (metric === 'HIST') datum.color = value >= 0 ? '#79b7a8' : '#d493a0';
        values.push(datum);
      }
      item.setData(values);
    }
    const markers = (options.markers || [])
      .filter((m) => rowIndex.has(isoKey(m.time)))
      .map((m) => {
        const isBuy = String(m.side).toLowerCase() === 'buy';
        return {
          time: m.time,
          position: isBuy ? 'belowBar' : 'aboveBar',
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          color: isBuy ? '#006c56' : '#b23856',
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
    renderLegend(rowIndex.get(isoKey(hoveredTime)) ?? bars.length - 1);
    scheduleLayout();
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
    const index = rowIndex.get(isoKey(chart.timeScale().coordinateToTime(x)));
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
    hoveredTime = event.point ? event.time : undefined;
    const idx = rowIndex.get(isoKey(hoveredTime));
    renderLegend(idx ?? bars.length - 1);
    callbacks.onHover?.(idx === undefined ? null : bars[idx], idx > 0 ? bars[idx - 1] : null);
  });
  const observer = new ResizeObserver(() => {
    const width = root.clientWidth;
    if (width && Math.abs(width - lastWidth) > 120) resetView();
    lastWidth = width;
    scheduleLayout();
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
    cancelAnimationFrame(layoutFrame);
    chart.remove();
    root.remove();
  }
  return { update, resetView, zoom, setTool, clearDrawings, getDrawings, destroy };
}
