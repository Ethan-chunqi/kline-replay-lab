// Fills from the first published version already carry closedQty and realizedPnl.
// The matching engine allocates entry/exit fees and liquidation gap credits once.
import { MARKETS } from './market.js?v=20261124';

export function buildTradeHistory(sessions, currentSession) {
  const unique = new Map();
  for (const session of sessions instanceof Map ? sessions.values() : sessions || []) {
    if (session?.id) unique.set(session.id, session);
  }
  if (currentSession?.id) unique.set(currentSession.id, currentSession);
  const rows = [];
  for (const session of unique.values()) {
    const account = session.account;
    if (!Array.isArray(account?.fills)) continue;
    const market = MARKETS.find((item) => item.id === session.marketId);
    if (!market) continue;
    const contract = account.contract;
    const symbol = session.feed?.symbol || contract?.symbol || market.symbol;
    const marketName = session.feed?.name || session.customName || market.name;
    for (const [index, fill] of account.fills.entries()) {
      if (!fill || !Number.isFinite(fill.qty) || fill.qty <= 0 || !Number.isFinite(fill.price)) continue;
      const closedQty = fill.closedQty;
      const openedQty = Math.max(0, fill.qty - closedQty);
      const status = closedQty === 0 ? 'open' : openedQty > fill.qty * Number.EPSILON * 4 ? 'reverse' : 'close';
      const buy = fill.side === 'buy';
      const direction = status === 'reverse' ? (buy ? '平空转多' : '平多转空')
        : status === 'close' ? (buy ? '买入平空' : '卖出平多') : (buy ? '买入开多' : '卖出开空');
      rows.push({
        id: session.id + '/' + (fill.id ?? index + 1), sessionId: session.id, marketId: market.id,
        marketName, symbol, currency: market.currency, timeZone: market.timeZone,
        instrumentKind: contract ? 'future' : 'spot',
        time: fill.time, recordedAt: fill.recordedAt ?? null, sequence: index,
        sessionUpdated: session.updated || session.created || 0,
        side: fill.side, direction, qty: fill.qty, qtyUnit: market.quantityUnit || (contract ? '手' : '单位'),
        qtyDecimals: market.quantityDecimals || 0, price: fill.price, precision: market.precision,
        fee: fill.fee, closedQty, openedQty, realizedPnl: closedQty && Number.isFinite(fill.realizedPnl)
          ? fill.realizedPnl : null,
        status, reason: fill.reason, gapCredit: fill.gapCredit || 0,
      });
    }
  }
  return rows.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0)
    || b.sessionUpdated - a.sessionUpdated || b.sequence - a.sequence);
}

export function summarizeTradeHistory(rows) {
  const totals = new Map();
  for (const row of rows) {
    if (!totals.has(row.currency))
      totals.set(row.currency, {currency: row.currency, realizedPnl: 0, fees: 0, closedCount: 0, fillCount: 0});
    const total = totals.get(row.currency);
    total.fillCount++;
    if (Number.isFinite(row.fee)) total.fees += row.fee;
    if (row.realizedPnl != null) {
      total.realizedPnl += row.realizedPnl;
      total.closedCount++;
    }
  }
  return [...totals.values()];
}
