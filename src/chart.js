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
  root.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
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
  let activeMarket, displayKey, levelsKey, drawingKey, lastPriceColor;
  let ready = false,
    destroyed = false,
    lastWidth = root.clientWidth;
  let drawings = [],
    trendStart = null,
    tool = 'crosshair';
  let priceLevels = [],
    drawLines = [];
  let selectedTrend = -1,
    edit = null,
    pointerStart = null;
  let redrawTrends = () => {};
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
      pointerStart = null;
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
    timeAxis.scrollToPosition(pan.offset - dx / pan.spacing, false);
    if (Math.abs(dy) >= 3 || pan.movedY) {
      pan.movedY = true;
      const shift = dy * pan.pricePerPixel;
      priceAxis.setVisibleRange({ from: pan.range.from + shift, to: pan.range.to + shift });
    }
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(eventName, (event) => {
      if (pan?.id === event.pointerId) finishPan();
    });
  }
  root.addEventListener('contextmenu', (event) => {
    if (pan || (event.button === 2 && inPane(event))) event.preventDefault();
  });
  window.addEventListener('blur', finishPan);
  root.addEventListener('keydown', (event) => {
    if (event.target !== root || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    zoom(event.key === 'ArrowUp' ? 1.2 : 1 / 1.2);
  });

  function trendStyle(line) {
    return {
      color: /^#[0-9a-f]{6}$/i.test(line.color) ? line.color : colors.drawing,
      width: Number.isInteger(line.width) && line.width >= 1 && line.width <= 5 ? line.width : 2,
    };
  }
  function screenPoints(line) {
    if (line?.type !== 'trend' || line.points?.length !== 2) return null;
    const points = [];
    for (const p of line.points) {
      const index = p && rowIndex.get(isoKey(p.time));
      if (index == null || !Number.isFinite(p.price)) return null;
      const x = timeAxis.logicalToCoordinate(index),
        y = priceSeries.priceToCoordinate(p.price);
      if (x == null || y == null) return null;
      points.push({ x, y });
    }
    return points;
  }
  function hitTrend(x, y, radius = 7) {
    let best = null;
    for (let i = drawings.length - 1; i >= 0; i--) {
      const segment = screenPoints(drawings[i]);
      if (!segment) continue;
      const [a, b] = segment;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const endpoint = segment.findIndex((p) => Math.hypot(x - p.x, y - p.y) <= radius + 1);
      const distance = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
      if (distance > radius + trendStyle(drawings[i]).width / 2) continue;
      if (endpoint >= 0 && i === selectedTrend) return { index: i, endpoint, distance };
      if (!best || distance < best.distance) best = { index: i, endpoint, distance };
    }
    return best;
  }
  // The same chart-native coordinates drive both painting and hit testing.
  // Trend annotations never add timestamps or change the data's price range.
  const trendRenderer = {
    draw(target) {
      target.useMediaCoordinateSpace(({ context: ctx }) => {
        drawings.forEach((line, i) => {
          const pts = screenPoints(line);
          if (!pts) return;
          const { color, width } = trendStyle(line);
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.stroke();
          if (selectedTrend !== i) return;
          ctx.fillStyle = colors.background;
          ctx.lineWidth = 2;
          for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4.5 + width / 4, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
          }
        });
      });
    },
  };
  const trendViews = [{ zOrder: () => 'top', renderer: () => trendRenderer }];
  priceSeries.attachPrimitive({
    attached({ requestUpdate }) {
      redrawTrends = requestUpdate;
    },
    paneViews: () => trendViews,
    hitTest(x, y) {
      const hit = tool === 'crosshair' && hitTrend(x, y);
      if (!hit) return null;
      return {
        externalId: 'trend-' + hit.index,
        zOrder: 'top',
        distance: hit.distance,
        cursorStyle: hit.endpoint >= 0 ? 'crosshair' : 'move',
      };
    },
  });
  function selectTrend(index) {
    if (index === selectedTrend) return;
    selectedTrend = index;
    callbacks.onDrawingSelection?.(index >= 0 ? trendStyle(drawings[index]) : null);
    redrawTrends();
  }
  function setTrendStyle(style) {
    const line = drawings[selectedTrend];
    if (!line || !style) return false;
    const { color, width } = style;
    let changed = false;
    if (/^#[0-9a-f]{6}$/i.test(color) && line.color !== color) {
      line.color = color;
      changed = true;
    }
    if (Number.isInteger(width) && width >= 1 && width <= 5 && line.width !== width) {
      line.width = width;
      changed = true;
    }
    if (changed) {
      redrawTrends();
      callbacks.onDrawingSelection?.(trendStyle(line));
      callbacks.onDrawingChange?.(getDrawings());
    }
    return changed;
  }
  function deleteSelectedTrend() {
    if (selectedTrend < 0) return false;
    finishEdit(false);
    drawings.splice(selectedTrend, 1);
    selectTrend(-1);
    callbacks.onDrawingChange?.(getDrawings());
    return true;
  }
  function displayDrawings() {
    redrawTrends();
    const valid = drawings.filter(
      (d) => d.type === 'horizontal' && Number.isFinite(d.price) && (!d.time || rowIndex.has(isoKey(d.time))),
    );
    const key = JSON.stringify([valid, trendStart]);
    if (key === drawingKey) return;
    drawingKey = key;
    for (const line of drawLines) priceSeries.removePriceLine(line);
    drawLines = valid.map((d) =>
      priceSeries.createPriceLine({
        price: d.price,
        color: colors.drawing,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: '水平线',
      }),
    );
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
    redrawTrends();
    if (selectedTrend >= 0) callbacks.onDrawingSelection?.(trendStyle(drawings[selectedTrend]));
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
      finishEdit(false);
      selectTrend(-1);
      drawings = [];
      trendStart = null;
      drawingKey = levelsKey = undefined;
      activeMarket = marketKey;
    }
    if (!edit && Array.isArray(next.drawings)) drawings = structuredClone(next.drawings);
    ready = false;
    bars = visibleBars;
    rowIndex = new Map(bars.map((bar, i) => [isoKey(bar.time), i]));
    if (selectedTrend >= 0 && !drawings[selectedTrend]?.points?.every((p) => rowIndex.has(isoKey(p.time)))) {
      finishEdit(false);
      selectTrend(-1);
    }
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
    finishEdit(false);
    selectTrend(-1);
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
    setTool('crosshair');
    drawings = [];
    displayDrawings();
    callbacks.onDrawingChange?.(getDrawings());
  }
  function finishEdit(commit) {
    if (!edit) return;
    const { id, index, original, moved } = edit;
    edit = null;
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
    if (!moved || !drawings[index]) return;
    if (commit) callbacks.onDrawingChange?.(getDrawings());
    else drawings[index].points = original;
    redrawTrends();
  }
  const cancelEdit = () => finishEdit(false);
  window.addEventListener('blur', cancelEdit);
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isPrimary || event.button !== 0 || !ready || tool !== 'crosshair' || !inPane(event)) return;
      const bounds = root.getBoundingClientRect();
      const x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      const hit = hitTrend(x, y, event.pointerType === 'touch' ? 14 : 7);
      selectTrend(hit ? hit.index : -1);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      pointerStart = null;
      root.focus({ preventScroll: true });
      root.setPointerCapture(event.pointerId);
      edit = {
        id: event.pointerId,
        index: hit.index,
        endpoint: hit.endpoint,
        x,
        y,
        moved: false,
        original: structuredClone(drawings[hit.index].points),
      };
    },
    true,
  );
  for (const eventName of ['touchstart', 'touchmove']) {
    root.addEventListener(
      eventName,
      (event) => {
        if (!edit) return;
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      },
      { capture: true, passive: false },
    );
  }
  root.addEventListener('pointermove', (event) => {
    if (!edit || edit.id !== event.pointerId) return;
    const bounds = root.getBoundingClientRect();
    const x = event.clientX - bounds.left,
      y = event.clientY - bounds.top;
    if (!edit.moved && Math.hypot(x - edit.x, y - edit.y) < 3) return;
    const indices = edit.original.map((p) => rowIndex.get(isoKey(p.time)));
    if (indices.some((i) => i == null)) return finishEdit(false);
    const moving = edit.endpoint < 0 ? [0, 1] : [edit.endpoint];
    const minIndex = Math.min(...moving.map((i) => indices[i]));
    const maxIndex = Math.max(...moving.map((i) => indices[i]));
    let shift = Math.round((x - edit.x) / timeAxis.options().barSpacing);
    shift = Math.max(-minIndex, Math.min(bars.length - 1 - maxIndex, shift));
    // Keep distinct time anchors when one handle is dragged through the other.
    if (edit.endpoint >= 0 && indices[edit.endpoint] + shift === indices[1 - edit.endpoint]) {
      shift -= Math.sign(shift);
    }
    const height = chart.paneSize(0).height;
    const startPrice = priceSeries.coordinateToPrice(edit.y);
    const endPrice = priceSeries.coordinateToPrice(Math.max(0, Math.min(y, height - 1)));
    if (startPrice == null || endPrice == null) return;
    const deltaPrice = endPrice - startPrice;
    const line = drawings[edit.index];
    line.points = edit.original.map((p, i) =>
      moving.includes(i)
        ? {
            time: bars[indices[i] + shift].time,
            price: Number((p.price + deltaPrice).toFixed(options.precision)),
          }
        : p,
    );
    edit.moved = true;
    redrawTrends();
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(eventName, (event) => {
      if (edit?.id === event.pointerId) finishEdit(eventName === 'pointerup');
    });
  }
  root.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button === 0 && inPane(event))
      root.focus({ preventScroll: true });
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
    if (
      tool === 'crosshair' ||
      event.button !== 0 ||
      !start ||
      start.id !== event.pointerId ||
      event.target.closest('a')
    )
      return;
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
    const addedTrend = tool === 'trend';
    setTool('crosshair');
    if (addedTrend) selectTrend(drawings.length - 1);
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
    const center = (current.from + current.to) / 2;
    chart.timeScale().setVisibleLogicalRange({ from: center - width / 2, to: center + width / 2 });
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    ready = false;
    finishPan();
    finishEdit(false);
    window.removeEventListener('blur', cancelEdit);
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
    setTool,
    clearDrawings,
    getDrawings,
    setTrendStyle,
    deleteSelectedTrend,
    destroy,
  };
}
