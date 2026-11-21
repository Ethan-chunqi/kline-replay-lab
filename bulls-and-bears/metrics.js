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
