import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  TickMarkType,
  createChart,
} from './vendor/lightweight-charts-5.3.0.mjs';

const hour = 3_600_000;
const quarterHour = hour / 4;
const beijingOffsetSeconds = 8 * 3600;
const colors = {
  up: '#0ecb81',
  down: '#f6465d',
  upVolume: 'rgba(14, 203, 129, .38)',
  downVolume: 'rgba(246, 70, 93, .40)',
  grid: '#2b3038',
  axis: '#84919e',
};
const decimals = { BTCUSDT: 2, BNBUSDT: 2, HYPEUSDT: 4, SOLUSDT: 3, ZECUSDT: 2 };

function numberFormat(symbol) {
  const digits = decimals[symbol] ?? 2;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Shift the chart's internal UTC grid so its day separators fall at Beijing midnight.
// All data sent back to the page keeps its original epoch timestamp.
function plotTime(ms) {
  return Math.floor(ms / 1000) + beijingOffsetSeconds;
}

function timeParts(time) {
  return new Date(time * 1000).toISOString();
}

function isSameCandle(a, b) {
  return a.time === b.time && a.open === b.open && a.high === b.high &&
    a.low === b.low && a.close === b.close && a.volume === b.volume;
}

function volumeBar(row) {
  return {
    time: row.time,
    value: row.volume,
    color: row.close >= row.open ? colors.upVolume : colors.downVolume,
  };
}

export function createChartView(container, onHover = () => {}, options = {}) {
  let symbol = options.symbol ?? 'BTCUSDT';
  let priceText = numberFormat(symbol);
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: '#181a20' },
      textColor: colors.axis,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      attributionLogo: true,
    },
    localization: {
      locale: 'zh-CN',
      priceFormatter: value => priceText.format(value),
      timeFormatter: time => timeParts(time).slice(5, 16).replace('T', ' '),
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: colors.grid, style: LineStyle.Dashed },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#6f7b8a', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#474e59' },
      horzLine: { color: '#6f7b8a', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#474e59' },
    },
    rightPriceScale: {
      visible: true,
      borderVisible: false,
      entireTextOnly: true,
      scaleMargins: { top: 0.11, bottom: 0.27 },
    },
    timeScale: {
      borderColor: colors.grid,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 3,
      minBarSpacing: 0.3,
      lockVisibleTimeRangeOnResize: true,
      tickMarkFormatter: (time, type) => {
        const iso = timeParts(time);
        return type <= TickMarkType.DayOfMonth ? iso.slice(5, 10) : iso.slice(11, 16);
      },
    },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
  });
  const volume = chart.addSeries(HistogramSeries, {
    priceScaleId: 'volume',
    priceFormat: { type: 'volume' },
    lastValueVisible: false,
    priceLineVisible: false,
  });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });
  const candles = chart.addSeries(CandlestickSeries, {
    upColor: colors.up, downColor: colors.down,
    wickUpColor: colors.up, wickDownColor: colors.down,
    borderVisible: false,
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: { type: 'price', precision: decimals[symbol] ?? 2, minMove: 10 ** -(decimals[symbol] ?? 2) },
  });

  let sourceByTime = new Map();
  let rows = [];
  let selectedHours = 24;
  let priceLine;
  let hoveredTime = null;
  let disposed = false;

  function reset() {
    if (!rows.length || disposed) return;
    const lastIndex = rows.length - 1;
    const start = rows[lastIndex].time - (selectedHours * hour - quarterHour) / 1000;
    const firstIndex = rows.findIndex(row => row.time >= start);
    candles.priceScale().setAutoScale(true);
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, firstIndex) - 0.5, to: lastIndex + 2.5 });
  }

  function hover(event) {
    hoveredTime = event.point && event.point.x >= 0 && event.point.y >= 0 &&
      event.point.x < container.clientWidth && event.point.y < container.clientHeight
      ? event.time : null;
    onHover(sourceByTime.get(hoveredTime) ?? null);
  }
  chart.subscribeCrosshairMove(hover);

  function update(items, windowHours = 24, latestPrice = null, nextSymbol = symbol) {
    if (disposed) return;
    if (symbol !== nextSymbol) {
      symbol = nextSymbol;
      priceText = numberFormat(symbol);
      const precision = decimals[symbol] ?? 2;
      chart.applyOptions({ localization: { priceFormatter: value => priceText.format(value) } });
      candles.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
      rows = [];
      hoveredTime = null;
      onHover(null);
    }
    const oldHours = selectedHours;
    selectedHours = Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24;
    const sources = new Map();
    const next = items.map((item, index) => {
      const time = plotTime(item.time);
      let bar = item;
      if (index === items.length - 1 && Number.isFinite(latestPrice) && latestPrice > 0) {
        bar = { ...item, close: latestPrice, high: Math.max(latestPrice, item.high), low: Math.min(latestPrice, item.low) };
      }
      sources.set(time, bar);
      return { time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
    });

    const previous = rows;
    rows = next;
    sourceByTime = sources;
    if (!rows.length) {
      candles.setData([]);
      volume.setData([]);
      if (priceLine) candles.removePriceLine(priceLine);
      priceLine = undefined;
      onHover(null);
      return;
    }

    // Updating only the open and newly appended bars keeps a visitor's zoom and pan intact.
    const canAppend = previous.length > 0 && previous.length <= rows.length &&
      previous[previous.length - 1].time === rows[previous.length - 1].time &&
      previous.slice(0, -1).every((bar, i) => isSameCandle(bar, rows[i]));
    if (canAppend) {
      for (let i = previous.length - 1; i < rows.length; i += 1) {
        if (previous[i] && isSameCandle(previous[i], rows[i])) continue;
        candles.update(rows[i]);
        volume.update(volumeBar(rows[i]));
      }
    } else {
      // A provider refresh can roll the lookback one candle forward, or correct past candles.
      const visible = chart.timeScale().getVisibleLogicalRange();
      const followsLatest = visible && visible.to >= previous.length - 1;
      const oldAnchorIndex = visible ? Math.max(0, Math.min(previous.length - 1, Math.round(visible.from))) : 0;
      const oldAnchorTime = previous[oldAnchorIndex]?.time;
      candles.setData(rows);
      volume.setData(rows.map(volumeBar));
      if (previous.length && visible && oldHours === selectedHours) {
        const newAnchorIndex = rows.findIndex(row => row.time === oldAnchorTime);
        const offset = followsLatest ? rows.length - previous.length : newAnchorIndex - oldAnchorIndex;
        if (newAnchorIndex >= 0 || followsLatest) {
          chart.timeScale().setVisibleLogicalRange({ from: visible.from + offset, to: visible.to + offset });
        }
      }
    }

    const last = rows[rows.length - 1];
    const lineColor = last.close >= last.open ? colors.up : colors.down;
    const options = { price: last.close, color: lineColor, axisLabelColor: lineColor };
    if (priceLine) {
      priceLine.applyOptions(options);
    } else {
      priceLine = candles.createPriceLine({
        ...options, lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, axisLabelTextColor: '#10151b', title: '',
      });
    }
    if (!previous.length || oldHours !== selectedHours) reset();
    if (hoveredTime != null) onHover(sources.get(hoveredTime) ?? null);
  }

  return {
    update, reset,
    destroy() {
      if (disposed) return;
      disposed = true;
      chart.unsubscribeCrosshairMove(hover);
      chart.remove();
      sourceByTime.clear();
      rows = [];
    },
  };
}
