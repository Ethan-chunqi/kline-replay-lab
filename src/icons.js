const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.4 14A8.8 8.8 0 0 1 10 3.6 8.9 8.9 0 1 0 20.4 14z"/>',
  terminal: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 15v-4m5 6V7m5 8V9"/>',
  journal:
    '<path d="M4 5.5c3-1.5 5.5-1 8 1.2 2.5-2.2 5-2.7 8-1.2v13c-3-1.4-5.5-1-8 1-2.5-2-5-2.4-8-1zM12 7v12"/>',
  shuffle:
    '<path d="M3 6h3c4 0 6 12 10 12h5m-4-3 4 3-4 3M3 18h3c1.7 0 3-2 4.3-4.5M14 8c1-1.4 1.8-2 3-2h4m-4-3 4 3-4 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 1 1 4.7 2.6c-1.2.8-2 1.3-2 2.7m0 2.3h.1"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  orders: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2M9 11h6m-6 5h6"/>',
  settings:
    '<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  cross: '<circle cx="12" cy="12" r="5"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  pointer: '<path d="M6 3l13 12-7 .1-3.9 5z"/>',
  extended: '<path d="m2 21 20-18"/><circle cx="7" cy="16.5" r="1.8"/><circle cx="16.7" cy="7.8" r="1.8"/>',
  horizontalSegment: '<path d="M5 12h14"/><circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/>',
  vertical: '<path d="M12 2v20"/><circle cx="12" cy="8" r="1.8"/>',
  crossLine: '<path d="M12 2v20M2 12h20"/>',
  ray: '<path d="m4 18 18-15"/><circle cx="4" cy="18" r="1.8"/><circle cx="14" cy="9.7" r="1.6"/>',
  parallel: '<path d="m3 14 12-10m-7 16L20 10"/><circle cx="3" cy="14" r="1.5"/><circle cx="15" cy="4" r="1.5"/><circle cx="8" cy="20" r="1.5"/>',
  priceLine: '<path d="M3 17h18M6 14V7m4 0h3v3h-3v3h3m3-6h3v6h-3"/>',
  arrowLine: '<path d="m4 19 15-14m-6 0h6v6"/><circle cx="4" cy="19" r="1.5"/>',
  infoLine: '<path d="m3 18 14-13M12 17h9m-9 3h6"/><circle cx="3" cy="18" r="1.4"/>',
  arrowUp: '<path d="M12 21V3m-8 8 8-8 8 8"/>',
  arrowDown: '<path d="M12 3v18m-8-8 8 8 8-8"/>',
  arrowLeft: '<path d="M21 12H3m8-8-8 8 8 8"/>',
  arrowRight: '<path d="M3 12h18m-8-8 8 8-8 8"/>',
  fib: '<path d="M4 4h16M4 9h13M4 13h16M4 19h16"/><circle cx="20" cy="4" r="1.7"/><circle cx="4" cy="19" r="1.7"/>',
  rectangle: '<rect x="4" y="6" width="16" height="12"/><path d="M2 4h4v4H2zM18 16h4v4h-4z"/>',
  measure: '<path d="M3 5h17v15H3zM7 15l9-7m-4 0h4v4m-5 3H7v-4"/>',
  text: '<path d="M3 5h13M9.5 5v15m-4 0h8m6-14v13"/>',
  magnet: '<path d="M4 19V10a8 8 0 0 1 16 0v9h-4v-9a4 4 0 0 0-8 0v9zM4 15h4m8 0h4"/>',
  keepDrawing: '<path d="M4 8V4h6m10 11v5h-6m-9-3 1-4L16 3l4 4L10 17l-5 1z"/>',
  locked: '<path d="M8 10V7a4 4 0 0 1 7.6-2M5 10h14v11H5z"/><circle cx="12" cy="15" r="1.5"/>',
  hidden: '<path d="M1.5 12s4-7 10.5-7 10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
  trend: '<path d="m5 17 13-11"/><circle cx="4" cy="18" r="1.8"/><circle cx="19" cy="5" r="1.8"/>',
  hline: '<path d="M3 12h18"/><circle cx="8" cy="12" r="2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  candles:
    '<path d="M7 3v5m0 8v5m9-18v3m0 7v8"/><rect x="5" y="8" width="4" height="8" rx=".6"/><rect x="14" y="6" width="4" height="7" rx=".6"/>',
  line: '<path d="m2 17 6-7 5 3 8-9"/>',
  indicator: '<path d="M3 17l5-7 4 6 4-10 5 4"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  fit: '<path d="M4 4v16M20 4v16m-5-8H9m1-3-3 3 3 3m4-6 3 3-3 3"/>',
  play: '<path fill="currentColor" stroke="none" d="M7 4.8c0-.8.8-1 1.4-.6l11 7a1 1 0 0 1 0 1.6l-11 7c-.6.4-1.4.2-1.4-.6z"/>',
  pause: '<path stroke-width="3.6" d="M8 5v14M16 5v14"/>',
  step: '<path d="m5 5 9 7-9 7zM18 5v14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l3 2"/>',
  fund: '<path d="M3 8h16a1 1 0 0 1 1 1v10H4a1 1 0 0 1-1-1V7a2 2 0 0 1 2-2h12"/><path d="M20 12h-5v4h5"/>',
  layers: '<path d="m3 8 9-5 9 5-9 5zm0 4 9 5 9-5m-18 4 9 5 9-5"/>',
  book: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8m-8 4h5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  market:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  rewind: '<path d="M3 12a9 9 0 1 1 3 6.5M3 5v7h7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};
export const icon = (name, size = 18) =>
  '<svg width="' +
  size +
  '" height="' +
  size +
  '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  (paths[name] || '') +
  '</svg>';
