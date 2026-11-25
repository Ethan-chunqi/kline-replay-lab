import { CrosshairMode } from '../vendor/lightweight-charts/lightweight-charts.min.js';
import { anchorCounts, drawingShape, nearestOnSegment } from './drawing-geometry.js';

const patterns = { solid: [], dashed: [7, 5], dotted: [1, 4] };
const textFont = '12px system-ui, sans-serif';
const validColor = (value) => /^#[0-9a-f]{6}$/i.test(value);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function attachDrawings({ root, chart, priceSeries, callbacks, data, row, precision, palette, ready, inPane, startPan }) {
  const timeAxis = chart.timeScale();
  const metrics = document.createElement('canvas').getContext('2d');
  metrics.font = textFont;
  let items = [], tool = 'trend', cursor = 'crosshair', selected = -1, anchorHit = null;
  let draft = [], hover = null, press = null, edit = null, version = 0, lastAnchor = null;
  let requestRedraw = () => {};
  const flags = { magnet: false, locked: false, hidden: false, keepDrawing: false };
  const selecting = () => tool === 'crosshair' || tool === 'pointer';
  let trendColor = '#41bf88', repeatTrends = true;
  const repeats = () => tool === 'trend' ? repeatTrends : flags.keepDrawing;
  const editingTool = () => selecting() || (tool === 'trend' && !draft.length);
  const getDrawings = () => structuredClone(items);
  const save = () => callbacks.onDrawingChange?.(getDrawings());

  function style(line) {
    return {
      color: validColor(line.color) ? line.color : palette().drawing,
      width: Number.isInteger(line.width) && line.width >= 1 && line.width <= 5 ? line.width : 2,
      pattern: Object.hasOwn(patterns, line.pattern) ? line.pattern : (line.type === 'horizontal' ? 'dashed' : 'solid'),
    };
  }
  function pointIndex(point) {
    const index = row(point.time);
    return index == null ? null : index + (Number.isInteger(point.offsetBars) ? point.offsetBars : 0);
  }
  // Space beyond the last visible candle remains drawable without reading future bars.
  function pointAt(index, price) {
    const bars = data();
    if (!bars.length || !Number.isFinite(index) || !Number.isFinite(price)) return null;
    const base = clamp(index, 0, bars.length - 1);
    const p = { time: bars[base].time, price: Number(price.toFixed(precision())) };
    if (base !== index) p.offsetBars = index - base;
    return p;
  }
  function priceAt(index, y, snap) {
    let price = priceSeries.coordinateToPrice(y);
    const bar = data()[index];
    if (price == null || !snap || !flags.magnet || !bar) return price;
    let distance = 16;
    for (const value of [bar.open, bar.high, bar.low, bar.close]) {
      const coord = priceSeries.priceToCoordinate(value);
      const d = coord == null ? Infinity : Math.abs(coord - y);
      if (d < distance) { price = value; distance = d; }
    }
    return price;
  }
  function chartPoint(x, y) {
    const logical = timeAxis.coordinateToLogical(x);
    if (logical == null) return null;
    const index = Math.round(logical);
    return pointAt(index, priceAt(index, y, true));
  }
  function linePoints(line) {
    if (Array.isArray(line.points)) return line.points;
    // Original horizontal drawings stored time and price directly on the drawing.
    if (line.type === 'horizontal' && Number.isFinite(line.price) && data().length)
      return [{ time: line.time ?? data()[0].time, price: line.price }];
    return [];
  }
  function geometry(line, pane) {
    const points = linePoints(line);
    if (!points.length || !Object.hasOwn(anchorCounts, line.type)) return null;
    const projected = [];
    for (const point of points) {
      if (!point || !Number.isFinite(point.price)) return null;
      const index = pointIndex(point);
      if (index == null) return null;
      const x = timeAxis.logicalToCoordinate(index), y = priceSeries.priceToCoordinate(point.price);
      if (x == null || y == null) return null;
      projected.push({ x, y, index, price: point.price });
    }
    return drawingShape(line, projected, pane, precision());
  }
  function publishAnchor(point) {
    if (point?.x === lastAnchor?.x && point?.y === lastAnchor?.y &&
        point?.width === lastAnchor?.width && point?.height === lastAnchor?.height) return;
    lastAnchor = point;
    callbacks.onDrawingAnchor?.(point);
  }
  function select(index, hit = null) {
    const changed = index !== selected;
    selected = index;
    anchorHit = hit ? chartPoint(hit.x, hit.y) : null;
    if (changed) callbacks.onDrawingSelection?.(index >= 0 ? style(items[index]) : null);
    if (index < 0) publishAnchor(null);
    requestRedraw();
  }
  function labelBox(label) {
    return { x: label.x - 2, y: label.y - 12, width: metrics.measureText(label.text).width + 5, height: 16 };
  }
  function hitAt(x, y, radius = 7) {
    if (flags.locked || flags.hidden) return null;
    const pane = chart.paneSize(0);
    let best = null;
    for (let index = items.length - 1; index >= 0; index--) {
      if (tool === 'trend' && items[index].type !== 'trend') continue;
      const shape = geometry(items[index], pane);
      if (!shape) continue;
      const handle = shape.handles.find((h) => Math.hypot(x - h.x, y - h.y) <= radius + 1);
      if (handle) {
        const hit = { index, handle, x, y, distance: 0 };
        if (index === selected) return hit;
        if (!best || best.distance > 0) best = hit;
      }
      for (const label of shape.labels) {
        const box = labelBox(label);
        if (x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height)
          return { index, x, y, distance: 0 };
      }
      for (const path of shape.paths) {
        const { distance } = nearestOnSegment(x, y, path);
        if (distance <= radius + style(items[index]).width / 2 && (!best || distance < best.distance))
          best = { index, x, y, distance };
      }
    }
    return best;
  }
  function editorAnchor(shape, pane) {
    const index = anchorHit && pointIndex(anchorHit);
    const x = index == null ? null : timeAxis.logicalToCoordinate(index);
    const y = anchorHit && priceSeries.priceToCoordinate(anchorHit.price);
    const near = x != null && y != null ? { x, y } : shape.handles[0];
    let nearest = null;
    for (const path of shape.paths) {
      const hit = nearestOnSegment(near.x, near.y, path);
      if (!nearest || hit.distance < nearest.distance) nearest = hit;
    }
    const p = nearest?.point || shape.labels[0] || shape.handles[0];
    if (p.x < 0 || p.y < 0 || p.x > pane.width || p.y > pane.height) return null;
    return { x: Math.round(p.x), y: Math.round(p.y), width: pane.width, height: pane.height };
  }
  function paint(ctx, line, shape, showHandles, preview) {
    const { color, width, pattern } = style(line);
    ctx.save();
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = preview ? 0.75 : 1;
    for (const { vertices, solid } of shape.fills) {
      ctx.save();
      if (!solid) ctx.globalAlpha *= 0.12;
      ctx.beginPath();
      vertices.forEach(({ x, y }, i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.setLineDash(patterns[pattern]);
    ctx.beginPath();
    for (const [a, b] of shape.paths) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = textFont;
    for (const label of shape.labels) {
      const box = labelBox(label);
      ctx.fillStyle = palette().background;
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = color;
      ctx.fillText(label.text, label.x, label.y);
    }
    if (showHandles) {
      ctx.fillStyle = palette().background;
      ctx.lineWidth = 2;
      for (const h of shape.handles) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  const renderer = {
    draw(target) {
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        let anchor = null;
        if (!flags.hidden) {
          items.forEach((line, i) => {
            const shape = geometry(line, mediaSize);
            if (!shape) return;
            paint(context, line, shape, selected === i, false);
            if (i === selected) anchor = editorAnchor(shape, mediaSize);
          });
          const points = hover ? [...draft, hover] : draft;
          if (!selecting() && points.length && (tool !== 'trend' || draft.length)) {
            const preview = { type: tool, points };
            if (tool === 'trend') preview.color = trendColor;
            const shape = geometry(preview, mediaSize);
            if (shape) paint(context, preview, shape, true, true);
          }
        }
        publishAnchor(anchor);
      });
    },
  };
  const paneViews = [{ zOrder: () => 'top', renderer: () => renderer }];
  priceSeries.attachPrimitive({
    attached({ requestUpdate }) { requestRedraw = requestUpdate; },
    paneViews: () => paneViews,
    priceAxisViews() {
      if (flags.hidden) return [];
      return items.filter((line) => ['horizontal', 'priceLine'].includes(line.type)).flatMap((line) => {
        const p = linePoints(line)[0];
        if (!p || pointIndex(p) == null || !Number.isFinite(p.price)) return [];
        return [{ coordinate: () => priceSeries.priceToCoordinate(p.price) ?? -10000,
          text: () => p.price.toFixed(precision()), textColor: () => '#ffffff', backColor: () => style(line).color }];
      });
    },
    hitTest(x, y) {
      const hit = editingTool() && hitAt(x, y);
      return hit ? { externalId: 'drawing-' + hit.index, zOrder: 'top', distance: hit.distance,
        cursorStyle: hit.handle ? 'crosshair' : 'move' } : null;
    },
  });

  function applyCursor() {
    chart.applyOptions({
      crosshair: { mode: tool === 'pointer' ? CrosshairMode.Hidden : CrosshairMode.Normal },
    });
    root.dataset.drawingTool = tool;
  }
  function setTool(next) {
    cancelGesture();
    select(-1);
    draft = []; hover = null; version++;
    tool = next === 'pointer' || Object.hasOwn(anchorCounts, next) ? next : 'crosshair';
    if (!selecting() && (flags.hidden || flags.locked)) tool = cursor;
    if (selecting()) cursor = tool;
    applyCursor();
    callbacks.onToolChange?.(tool, repeats());
    requestRedraw();
  }
  function setDrawingOptions(next = {}) {
    for (const key of Object.keys(flags)) {
      if (typeof next[key] !== 'boolean') continue;
      if (key === 'keepDrawing' && tool === 'trend') repeatTrends = next[key];
      else flags[key] = next[key];
    }
    if (validColor(next.trendColor)) trendColor = next.trendColor;
    if (flags.hidden || flags.locked) setTool(cursor);
    requestRedraw();
  }
  function setTrendStyle(next = {}) {
    if (selected < 0 || flags.locked) return false;
    const line = items[selected], before = style(line);
    if (validColor(next.color)) line.color = next.color;
    if (Number.isInteger(next.width) && next.width >= 1 && next.width <= 5) line.width = next.width;
    if (Object.hasOwn(patterns, next.pattern)) line.pattern = next.pattern;
    const after = style(line);
    if (Object.keys(after).every((k) => before[k] === after[k])) return false;
    callbacks.onDrawingSelection?.(after);
    requestRedraw();
    save();
    return true;
  }
  function deleteSelectedTrend() {
    if (selected < 0 || flags.locked) return false;
    finishEdit(false);
    items.splice(selected, 1);
    select(-1);
    save();
    return true;
  }
  function clearDrawings() {
    if (flags.locked) return;
    setTool(tool === 'trend' ? 'trend' : cursor);
    items = [];
    requestRedraw();
    save();
  }
  function update(next, changedMarket) {
    if (changedMarket) {
      cancelGesture();
      select(-1);
      draft = []; hover = null; version++;
      items = [];
    }
    if (!edit && Array.isArray(next)) items = structuredClone(next);
    const points = selected >= 0 && items[selected] && linePoints(items[selected]);
    if (selected >= 0 && (!points?.length || points.some((p) => !p || pointIndex(p) == null))) select(-1);
    requestRedraw();
  }

  const position = (event) => {
    const rect = root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  function finishPress() {
    if (!press) return;
    const { id } = press;
    press = null;
    root.removeAttribute('data-panning');
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
  }
  function cancelGesture() {
    finishPress();
    finishEdit(false);
  }
  function finishEdit(commit) {
    if (!edit) return;
    const { id, index, original, moved } = edit;
    edit = null;
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
    if (!moved) return;
    if (commit) save();
    else items[index] = original;
    requestRedraw();
  }
  function pointerDown(event) {
    const touch = event.pointerType === 'touch';
    if (touch && !event.isPrimary) { cancelGesture(); return; }
    const right = event.pointerType === 'mouse' && event.button === 2;
    if (!ready() || (!right && event.button !== 0) || !inPane(event) || press || edit) return;
    const pos = position(event), slop = touch ? 9 : 4;
    root.focus({ preventScroll: true });
    const hit = !right && editingTool() && hitAt(pos.x, pos.y, touch ? 14 : 7);
    if (hit) {
      select(hit.index, hit);
      edit = { ...hit, original: structuredClone(items[hit.index]), id: event.pointerId, moved: false, slop };
    } else {
      press = { ...pos, id: event.pointerId, right, touch, slop, moved: false,
        started: event.timeStamp, pan: touch ? null : startPan() };
    }
    // The chart library owns one-finger horizontal scrolling and two-finger pinch.
    // Let the browser handle a vertical swipe anywhere on the empty plot.
    if (!touch) {
      event.preventDefault();
      root.setPointerCapture(event.pointerId);
    }
  }
  function drag(event, pos) {
    if (!edit.moved && Math.hypot(pos.x - edit.x, pos.y - edit.y) < edit.slop) return;
    const source = linePoints(edit.original);
    const startPrice = priceSeries.coordinateToPrice(edit.y);
    const shift = Math.round((pos.x - edit.x) / timeAxis.options().barSpacing);
    const index = edit.handle ? pointIndex(source[edit.handle.timeIndex]) + shift : 0;
    const endPrice = priceAt(index, clamp(pos.y, 0, chart.paneSize(0).height - 1), !!edit.handle);
    if (startPrice == null || endPrice == null || source.some((p) => pointIndex(p) == null)) return;
    const points = source.map((p, i) => {
      const moveTime = !edit.handle || edit.handle.timeIndex === i;
      const movePrice = !edit.handle || edit.handle.priceIndex === i;
      let price = p.price;
      if (movePrice) price = edit.handle && flags.magnet ? endPrice : p.price + endPrice - startPrice;
      return pointAt(pointIndex(p) + (moveTime ? shift : 0), price);
    });
    if (edit.original.type === 'horizontalSegment') points[1].price = points[0].price;
    items[edit.index] = { ...edit.original, points };
    // Keep the original horizontal-line representation in sync for older clients.
    if (edit.original.type === 'horizontal') Object.assign(items[edit.index], points[0]);
    edit.moved = true;
    anchorHit = chartPoint(pos.x, pos.y);
    requestRedraw();
    event.preventDefault();
  }
  function pointerMove(event) {
    const pos = position(event);
    if (edit?.id === event.pointerId) return drag(event, pos);
    if (press?.id === event.pointerId) {
      const dx = pos.x - press.x, dy = pos.y - press.y;
      if (!press.moved && Math.hypot(dx, dy) < press.slop) return;
      press.moved = true;
      if (press.pan) {
        root.setAttribute('data-panning', '');
        press.pan(dx, dy);
      }
      if (hover) { hover = null; requestRedraw(); }
      return;
    }
    if (event.pointerType === 'touch' || !draft.length && tool === 'trend') return;
    if (!ready() || selecting() || flags.hidden || flags.locked) return;
    hover = inPane(event) ? chartPoint(pos.x, pos.y) : null;
    requestRedraw();
  }
  async function askText(initial) {
    const result = callbacks.requestText ? await callbacks.requestText(initial) : window.prompt('请输入文本', initial);
    return typeof result === 'string' ? result.trim().slice(0, 160) : '';
  }
  async function place(pos) {
    const point = chartPoint(pos.x, pos.y);
    if (!point) return;
    const points = [...draft, point];
    if (points.length === 2 && pointIndex(points[0]) === pointIndex(point) &&
        (tool === 'horizontalSegment' || points[0].price === point.price)) return;
    if (points.length < anchorCounts[tool]) {
      draft = points; hover = null;
      requestRedraw();
      return;
    }
    if (tool === 'horizontalSegment') points[1].price = points[0].price;
    const line = { type: tool, points };
    if (tool === 'trend') line.color = trendColor;
    if (tool === 'horizontal') Object.assign(line, point);
    if (tool === 'text') {
      const ticket = ++version;
      const text = await askText('');
      if (ticket !== version) return;
      if (!text) return setTool(cursor);
      line.text = text;
    }
    items.push(line);
    draft = []; hover = null;
    if (!repeats()) {
      setTool(cursor);
      select(items.length - 1, pos);
    }
    requestRedraw();
    save();
  }
  function pointerUp(event) {
    if (edit?.id === event.pointerId) return finishEdit(event.type === 'pointerup');
    if (!press || press.id !== event.pointerId) return;
    const start = press;
    finishPress();
    if (event.type !== 'pointerup' || start.moved || !inPane(event)) return;
    const pos = position(event);
    if (Math.hypot(pos.x - start.x, pos.y - start.y) >= start.slop ||
        (start.touch && event.timeStamp - start.started > 550)) return;
    if (start.right) {
      const hit = editingTool() && hitAt(pos.x, pos.y);
      if (hit) select(hit.index, hit);
      return;
    }
    select(-1);
    if (!selecting() && !flags.hidden && !flags.locked) void place(pos);
  }
  root.addEventListener('pointerdown', pointerDown, true);
  root.addEventListener('pointermove', pointerMove);
  for (const key of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(key, pointerUp);
  root.addEventListener('pointerleave', () => {
    if (hover) { hover = null; requestRedraw(); }
  });
  root.addEventListener('contextmenu', (event) => {
    if (inPane(event)) event.preventDefault();
  });
  root.addEventListener('touchstart', (event) => {
    if (edit && event.touches.length === 1) event.stopPropagation();
  }, { capture: true, passive: true });
  root.addEventListener('touchmove', (event) => {
    if (!edit || event.touches.length !== 1) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }, { capture: true, passive: false });
  root.addEventListener('dblclick', async (event) => {
    if (!selecting() || flags.hidden || flags.locked) return;
    const pos = position(event), hit = hitAt(pos.x, pos.y);
    if (!hit || items[hit.index].type !== 'text') return;
    event.preventDefault();
    const ticket = ++version, before = items[hit.index].text;
    const value = await askText(before);
    if (value && value !== before && ticket === version && items[hit.index]?.text === before) {
      items[hit.index].text = value; requestRedraw(); save();
    }
  });
  window.addEventListener('blur', cancelGesture);
  function destroy() {
    version++;
    cancelGesture();
    window.removeEventListener('blur', cancelGesture);
    publishAnchor(null);
  }
  function themeChanged() {
    applyCursor();
    if (selected >= 0) callbacks.onDrawingSelection?.(style(items[selected]));
    requestRedraw();
  }
  function cancelDrawing() {
    setTool(draft.length ? tool : cursor);
  }
  setTool('trend');
  return { update, setTool, cancelDrawing, setDrawingOptions, getDrawings, clearDrawings, setTrendStyle, deleteSelectedTrend,
    cancelGesture, interacting: () => !!(press || edit || draft.length), themeChanged, destroy };
}
