// Public spot and USDⓈ-M endpoints have distinct books, sequences and candle streams.
import { apiIntervals, bitcoinTradeQuote, liveBitcoinCandle, loadBitcoinFeed } from './binance-history.js?v=20261124live';
import { isFreshBitcoinQuote } from './bitcoin-quote.js';
export { isFreshBitcoinQuote };

const socketRoots = {
  btc: 'wss://data-stream.binance.vision/stream',
  btcPerp: 'wss://fstream.binance.com/market/stream',
};
const sampleMs = 750;
const pollMs = 3000;
const quietMs = 7500;
const candleUpdates = new WeakMap();
const candleEpoch = (time) => typeof time === 'number' ? time : Date.parse(time) / 1000;

// Merge official volume and extremes, even when several trades fell between price samples.
// Candles are chart data: a high or low must never execute a simulated order.
export function applyBitcoinCandle(session, update) {
  if (!session?.live || update?.marketId !== session.marketId || update.base !== session.base) return false;
  const bars = session.customBars;
  if (!bars?.length) return false;
  const incoming = update.bar, tail = bars.at(-1);
  if (candleEpoch(incoming.time) < candleEpoch(tail.time)) return false;
  if (incoming.time !== tail.time) {
    const next = {...incoming};
    bars.push(next);
    candleUpdates.set(next, update.asOfMs);
  } else {
    if ((candleUpdates.get(tail) || 0) > update.asOfMs) return false;
    candleUpdates.set(tail, update.asOfMs);
    const q = session.liveQuote, start = candleEpoch(incoming.time);
    const minutes = session.base.endsWith('m') ? parseInt(session.base) :
      session.base.endsWith('H') ? parseInt(session.base) * 60 : 1440;
    const quoteInBucket = q?.time >= start && q.time < start + minutes * 60;
    const quoteIsNewer = quoteInBucket && (Number.isSafeInteger(update.lastTradeId)
      ? q.sequence >= update.lastTradeId : q.tradeTimeMs >= update.asOfMs);
    Object.assign(tail, incoming, {
      close: quoteIsNewer ? q.price : incoming.close,
      high: Math.max(tail.high, incoming.high), low: Math.min(tail.low, incoming.low),
      volume: Math.max(tail.volume || 0, incoming.volume),
    });
  }
  session.cursor = bars.length - 1;
  return true;
}

export function subscribeBitcoinLive(marketId, base, {initialQuote, onQuote, onCandle, onStatus}) {
  const root = socketRoots[marketId], interval = apiIntervals[base];
  if (!root || !interval) throw Error('币安实时订阅的市场或周期不支持。');
  let stopped = false, socket = null, request = null, state = null;
  let lastQuote = isFreshBitcoinQuote(marketId, initialQuote) ? initialQuote : null;
  let candidate = null, lastEmitted = 0, lastWsTrade = 0, openedAt = 0, retryAt = 0;
  let retryMs = 1000, nextPoll = 0;

  function status(next) {
    if (!stopped && state !== next) { state = next; onStatus?.(next); }
  }
  function publish(quote, mode) {
    if (stopped || !isFreshBitcoinQuote(marketId, quote)) return;
    if (lastQuote && (quote.sequence < lastQuote.sequence || quote.tradeTimeMs < lastQuote.tradeTimeMs)) return;
    if (!lastQuote || quote.sequence > lastQuote.sequence) {
      lastQuote = quote;
      lastEmitted = Date.now();
      onQuote(quote);
    }
    status(mode);
  }
  function disconnect() {
    if (socket) {
      const previous = socket;
      socket = null;
      previous.onmessage = previous.onerror = previous.onclose = null;
      previous.close();
    }
    lastWsTrade = 0;
    candidate = null;
    retryAt = Date.now() + retryMs;
    retryMs = Math.min(30000, retryMs * 2);
    if (state !== 'polling') status('offline');
  }
  function connect() {
    openedAt = Date.now();
    const url = root + '?streams=btcusdt@aggTrade/btcusdt@kline_' + interval;
    try { socket = new WebSocket(url); } catch { disconnect(); return; }
    socket.onerror = socket.onclose = disconnect;
    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data)?.data; } catch { return; }
      if (stopped || msg?.s !== 'BTCUSDT') return;
      if (msg.e === 'aggTrade') {
        let q;
        try { q = bitcoinTradeQuote(marketId, msg.p, msg.T, msg.l); } catch { return; }
        if (lastQuote && q.sequence < lastQuote.sequence) return;
        if (!candidate || q.sequence > candidate.sequence) candidate = q;
        lastWsTrade = Date.now();
        retryMs = 1000;
        if (state !== 'websocket' || Date.now() - lastEmitted >= sampleMs) publish(candidate, 'websocket');
      } else if (msg.e === 'kline' && msg.k?.s === 'BTCUSDT' && msg.k.i === interval) {
        const k = msg.k, age = Date.now() - msg.E;
        if (!Number.isFinite(age) || age < -2000 || age > 12000 || k.t > msg.E) return;
        let update;
        try { update = liveBitcoinCandle(marketId, base, [k.t,k.o,k.h,k.l,k.c,k.v], msg.E, k.L); }
        catch { return; }
        onCandle?.(update);
      }
    };
  }
  async function poll() {
    if (request || stopped) return;
    const current = new AbortController();
    request = current;
    try {
      const snapshot = await loadBitcoinFeed(base, {marketId, signal: current.signal, limit: 3});
      if (stopped || current.signal.aborted || (lastWsTrade && Date.now() - lastWsTrade < quietMs)) return;
      if (!isFreshBitcoinQuote(marketId, snapshot.quote)) { status('offline'); return; }
      for (const bar of snapshot.bars)
        onCandle?.({marketId, base, bar, asOfMs: snapshot.quote.tradeTimeMs});
      publish(snapshot.quote, 'polling');
    } catch {
      if (!stopped && !current.signal.aborted && (!lastWsTrade || Date.now() - lastWsTrade >= quietMs))
        status('offline');
    } finally {
      if (request === current) request = null;
      nextPoll = Date.now() + pollMs;
    }
  }
  function tick() {
    if (stopped) return;
    if (globalThis.navigator?.onLine === false) {
      if (state !== 'offline') offline();
      return;
    }
    const now = Date.now();
    if (state !== 'connecting' && !isFreshBitcoinQuote(marketId, lastQuote, now)) status('offline');
    if (socket && now - (lastWsTrade || openedAt) > quietMs) disconnect();
    if (!socket && now >= retryAt) connect();
    if (candidate && lastWsTrade && now - lastEmitted >= sampleMs) publish(candidate, 'websocket');
    if ((!lastWsTrade || now - lastWsTrade >= quietMs) && now >= nextPoll) poll();
  }
  function offline() {
    request?.abort();
    disconnect();
    status('offline');
  }
  function online() { retryAt = nextPoll = 0; tick(); }
  status('connecting');
  nextPoll = Date.now() + 1200;
  tick();
  if (globalThis.navigator?.onLine === false) status('offline');
  const timer = setInterval(tick, 500);
  globalThis.addEventListener?.('offline', offline);
  globalThis.addEventListener?.('online', online);
  return () => {
    stopped = true;
    clearInterval(timer);
    request?.abort();
    disconnect();
    globalThis.removeEventListener?.('offline', offline);
    globalThis.removeEventListener?.('online', online);
  };
}
