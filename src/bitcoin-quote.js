// BTC executable marks are product-specific trades, with the exchange's own millisecond timestamp.
const maxAgeMs = 12000;
const clockSkewMs = 2000;

export function isFreshBitcoinQuote(marketId, quote, nowMs = Date.now()) {
  if (!['btc', 'btcPerp'].includes(marketId) || quote?.marketId !== marketId || quote.symbol !== 'BTCUSDT'
    || !Number.isFinite(quote.price) || quote.price <= 0 || !Number.isSafeInteger(quote.sequence)
    || !Number.isSafeInteger(quote.tradeTimeMs) || quote.time !== Math.floor(quote.tradeTimeMs / 1000)) return false;
  const age = nowMs - quote.tradeTimeMs;
  return age >= -clockSkewMs && age <= maxAgeMs;
}
