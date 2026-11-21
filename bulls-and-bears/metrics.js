export function percent(current, reference) {
  return (current - reference) / reference * 100;
}

export function pnl(capital, leverage, entry, market, direction) {
  const roi = percent(market, entry) * leverage * direction;
  return { profit: capital * (roi / 100), roi };
}

export function parseAmount(text) {
  const value = text.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$/.test(value)) return null;
  const amount = Number(value.replaceAll(',', ''));
  return Number.isFinite(amount) && amount > 0 && amount <= Number.MAX_SAFE_INTEGER ? amount : null;
}

export function readPrincipal(text, lang, currency='USDT') {
  let raw=String(text).normalize('NFKC').trim().replace(/[\s\u00a0\u202f]/g,'');
  const suffix=currency==='CNY'?/(?:人民币|RMB|CNY|元)$/i:currency==='KRW'?/(?:KRW|원)$/i:/(?:USDT|USD|U|美元)$/i;
  raw=raw.replace(suffix,'').replace(currency==='CNY'?/^[¥￥]/:currency==='KRW'?/^₩/:/^\$/,'');
  const magnitude=raw.match(/(万|萬|w|亿|億|[km])$/i)?.[0].toLowerCase();
  const factor=({'万':1e4,'萬':1e4,w:1e4,'亿':1e8,'億':1e8,k:1e3,m:1e6})[magnitude] || 1;
  if (magnitude) raw=raw.slice(0,-1);
  raw=lang==='ru' ? raw.replace(',','.') : raw.replace(/,/g,'');
  const parsed=parseAmount(raw);
  return parsed && parsed*factor<=Number.MAX_SAFE_INTEGER ? parsed*factor : null;
}
