// Construct visible geometry in chart CSS pixels. Rendering and picking use the same paths.
export const anchorCounts = {
  trend: 2, extended: 2, horizontal: 1, horizontalSegment: 2, vertical: 1, crossLine: 1,
  parallel: 3, ray: 2, priceLine: 1, arrowLine: 2, infoLine: 2, arrowUp: 1, arrowDown: 1,
  arrowLeft: 1, arrowRight: 1, fib: 2, rectangle: 2, measure: 2, text: 1,
};

const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const directions = { arrowUp: [0, -1], arrowDown: [0, 1], arrowLeft: [-1, 0], arrowRight: [1, 0] };
const interpolate = (a, b, t) => ({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });

function clipped(a, b, pane, from = 0, to = 1) {
  if (a.x === b.x && a.y === b.y) return null;
  for (const [key, max] of [['x', pane.width], ['y', pane.height]]) {
    const delta = b[key] - a[key];
    if (!delta) {
      if (a[key] < 0 || a[key] > max) return null;
    } else {
      const first = -a[key] / delta, last = (max - a[key]) / delta;
      from = Math.max(from, Math.min(first, last));
      to = Math.min(to, Math.max(first, last));
      if (from > to) return null;
    }
  }
  return [interpolate(a, b, from), interpolate(a, b, to)];
}

export function nearestOnSegment(x, y, [a, b]) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  const point = interpolate(a, b, t);
  return { distance: Math.hypot(x - point.x, y - point.y), t, point };
}

export function drawingShape(line, points, pane, precision) {
  const paths = [], labels = [], fills = [];
  const handles = points.map((p, i) => ({ ...p, timeIndex: i, priceIndex: i }));
  const [a, b, c] = points;
  const { type } = line;
  function path(start, end, from, to) {
    const segment = clipped(start, end, pane, from, to);
    if (segment) paths.push(segment);
  }
  function polygon(vertices, solid = false) {
    fills.push({ vertices, solid });
    vertices.forEach((v, i) => path(v, vertices[(i + 1) % vertices.length]));
  }
  function label(pos, text, dx = 0, dy = -5) {
    labels.push({ x: pos.x + dx, y: pos.y + dy, text });
  }
  const edgeX = { x: pane.width, y: a.y };
  const horizontal = () => path({ x: 0, y: a.y }, edgeX);
  const vertical = () => path({ x: a.x, y: 0 }, { x: a.x, y: pane.height });
  if (type in directions) {
    const [dx, dy] = directions[type];
    const vertex = (along, across) => ({ x: a.x + dx * along - dy * across, y: a.y + dy * along + dx * across });
    polygon([a, vertex(-10, 7), vertex(-10, 3), vertex(-21, 3),
      vertex(-21, -3), vertex(-10, -3), vertex(-10, -7)], true);
  } else if (type === 'horizontal') horizontal();
  else if (type === 'vertical') vertical();
  else if (type === 'crossLine') { horizontal(); vertical(); }
  else if (type === 'priceLine') {
    path(a, { x: a.x + 1, y: a.y }, 0, Infinity);
    label(a, a.price.toFixed(precision), 5);
  } else if (type === 'text') {
    label(a, line.text || '文本', 2, 0);
  } else if (b) {
    switch (type) {
      case 'extended': path(a, b, -Infinity, Infinity); break;
      case 'ray': path(a, b, 0, Infinity); break;
      case 'horizontalSegment':
        path(a, { x: b.x, y: a.y });
        handles[1].y = a.y;
        handles[1].priceIndex = 0;
        break;
      case 'rectangle':
      case 'measure': {
        const topRight = { x: b.x, y: a.y }, bottomLeft = { x: a.x, y: b.y };
        polygon([a, topRight, b, bottomLeft]);
        handles.push({ ...topRight, timeIndex: 1, priceIndex: 0 }, { ...bottomLeft, timeIndex: 0, priceIndex: 1 });
        if (type === 'measure') label(interpolate(a, b, 0.5), measurement(a, b, precision), 3);
        break;
      }
      case 'fib':
        fibLevels.forEach((ratio) => {
          const y = b.y + (a.y - b.y) * ratio;
          path({ x: a.x, y }, { x: b.x, y });
          label({ x: Math.min(a.x, b.x), y }, ratio + '  ' + (b.price + (a.price - b.price) * ratio).toFixed(precision), 3, -3);
        });
        path(a, b);
        break;
      case 'parallel':
        path(a, b);
        if (c) {
          // The third click sets channel width. Both boundaries span the original time interval.
          const dx = b.x - a.x;
          const shiftX = dx ? 0 : c.x - a.x;
          const shiftY = dx ? c.y - (a.y + (c.x - a.x) * (b.y - a.y) / dx) : 0;
          const start = { x: a.x + shiftX, y: a.y + shiftY };
          const end = { x: b.x + shiftX, y: b.y + shiftY };
          path(start, end);
          fills.push({ vertices: [a, b, end, start] });
        }
        break;
      case 'arrowLine': {
        path(a, b);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        for (const offset of [-0.47, 0.47]) {
          const head = angle + offset;
          path(b, { x: b.x - 12 * Math.cos(head), y: b.y - 12 * Math.sin(head) });
        }
        break;
      }
      default:
        path(a, b);
        if (type === 'infoLine') label(interpolate(a, b, 0.5), measurement(a, b, precision), 3);
    }
  }
  return { paths, handles, labels, fills };
}

function measurement(a, b, precision) {
  const delta = b.price - a.price, sign = delta >= 0 ? '+' : '';
  const percent = a.price ? ' (' + sign + (100 * delta / Math.abs(a.price)).toFixed(2) + '%)' : '';
  return sign + delta.toFixed(precision) + percent + ' · ' + Math.abs(b.index - a.index) + ' 根';
}
