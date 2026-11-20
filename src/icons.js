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
