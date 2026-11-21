import {perpetualSources,bitgetPath} from './perpetuals.js?v=20261122-market-v3';
// Public trade-price candles for USDT-settled perpetual contracts. Bar timestamps and quote timestamps are Unix milliseconds.
const INTERVAL = 15 * 60_000;
const HISTORY = 675;
const STALE_AFTER = 16_000;
const symbols = new Set(Object.keys(perpetualSources));
const verifiedUntil = new Map();

const feeds = [
  { source:'Bitget',sourceId:'bitget-usdt',base:'https://api.bitget.com' },
  { source: 'Binance', sourceId: 'binance-usdm', base: 'https://fapi.binance.com' },
  { source: 'Bybit', sourceId: 'bybit-linear', base: 'https://api.bybit.com' },
  { source: 'Bybit', sourceId: 'bybit-linear', base: 'https://api.bytick.com' },
];

function bar(time, open, high, low, close, volume) {
  return { time: +time, open: +open, high: +high, low: +low, close: +close, volume: +volume };
}

function checkBars(candles, minimum = 1) {
  if (!Array.isArray(candles) || candles.length < minimum) throw new Error('K 线历史不足');
  for (let i = 0; i < candles.length; i++) {
    const b = candles[i];
    if (!Number.isSafeInteger(b.time) || b.time % INTERVAL !== 0 ||
        ![b.open,b.close,b.low,b.high,b.volume].every(Number.isFinite) ||
        b.low <= 0 || b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) ||
        b.volume < 0 || (i > 0 && b.time - candles[i - 1].time !== INTERVAL)) {
      throw new Error('K 线数据不完整');
    }
  }
  return candles;
}

async function fetchJSON(url, signal, timeout = 5_000) {
  const ac = new AbortController();
  const abort = () => ac.abort();
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  const timeoutId = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { signal: ac.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('行情接口暂不可用');
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', abort);
  }
}

async function verifyContract(feed, instrument, signal) {
  const { symbol } = instrument;
  const key = feed.base + '/' + symbol;
  if (verifiedUntil.get(key) > Date.now()) return;
  const expiry = Date.now() + 300_000;
  if (feed.sourceId === 'binance-usdm') {
    const data = await fetchJSON(feed.base + '/fapi/v1/exchangeInfo', signal, 10_000);
    for (const s of data.symbols ?? []) {
      if (symbols.has(s.symbol) && s.symbol === s.pair && s.symbol === s.baseAsset + 'USDT' &&
          s.contractType === 'PERPETUAL' && s.status === 'TRADING' &&
          s.quoteAsset === 'USDT' && s.marginAsset === 'USDT') {
        verifiedUntil.set(feed.base + '/' + s.symbol, expiry);
      }
    }
  } else if(feed.sourceId==='bitget-usdt') {
    const data=await fetchJSON(bitgetPath('contracts',symbol),signal);
    if(data.code==='00000' && data.data.some(s=>s.symbol===symbol && s.baseCoin+'USDT'===symbol &&
      s.quoteCoin==='USDT' && s.supportMarginCoins?.includes('USDT') && s.symbolType==='perpetual' &&
      s.symbolStatus==='normal'))verifiedUntil.set(key,expiry);
  } else {
    const data = await fetchJSON(feed.base + '/v5/market/instruments-info?category=linear&symbol=' + symbol, signal);
    const valid = data.retCode === 0 && data.result?.category === 'linear' && data.result.list.some(s =>
      s.symbol === symbol && s.contractType === 'LinearPerpetual' && s.status === 'Trading' &&
      s.baseCoin + 'USDT' === symbol && s.quoteCoin === 'USDT' && s.settleCoin === 'USDT');
    if (valid) verifiedUntil.set(key, expiry);
  }
  if (!(verifiedUntil.get(key) > Date.now())) throw new Error('永续合约信息不符');
}

async function readMarket(feed, full, instrument, signal) {
  const { symbol } = instrument;
  const count = full ? HISTORY : 3;
  const requestAt = Date.now();
  let asOf = requestAt;
  let candles;
  if (feed.sourceId === 'bybit-linear') {
    const data = await fetchJSON(feed.base + '/v5/market/kline?category=linear&symbol=' + symbol + '&interval=15&limit=' + count, signal);
    if (data.retCode !== 0 || data.result?.symbol !== instrument.symbol || data.result?.category !== 'linear') {
      throw new Error('永续合约行情不符');
    }
    candles = data.result.list.map(r => bar(...r)).reverse();
    asOf = +data.time;
  } else if(feed.sourceId==='bitget-usdt') {
    const raw=await fetchJSON(bitgetPath('candles',symbol,{granularity:'15m',limit:count}),signal);
    if(raw.code!=='00000' || !Array.isArray(raw.data))throw Error('Invalid Bitget perpetual data');
    candles=raw.data.map(r=>bar(...r));asOf=+raw.requestTime;
  } else {
    const data = await fetchJSON(feed.base + '/fapi/v1/klines?symbol=' + symbol + '&interval=15m&limit=' + count + '&endTime=' + requestAt, signal);
    if (!Array.isArray(data) || !data.every(r => r[6] - r[0] === INTERVAL - 1)) {
      throw new Error('K 线周期不符');
    }
    candles = data.map(r => bar(...r));
  }
  checkBars(candles, full ? 673 : 2);
  const latest = candles.at(-1).time;
  // In the first seconds of a quarter hour a venue may only have the completed candle.
  if (latest > Date.now() + 5000 || Date.now() - latest > INTERVAL + 12_000 ||
      !Number.isFinite(asOf) || Math.abs(Date.now() - asOf) > STALE_AFTER) {
    throw new Error('交易所行情已延迟');
  }
  return { ...instrument, candles, asOf, source: feed.source, sourceId: feed.sourceId };
}

function readSnapshot(data, instrument) {
  if (!data || data.symbol !== instrument.symbol || data.interval !== instrument.interval || data.market !== instrument.market ||
      !perpetualSources[instrument.symbol]?.includes(data.sourceId) || !feeds.some(f => f.source === data.source && f.sourceId === data.sourceId) ||
      !Number.isSafeInteger(data.asOf) || data.asOf > Date.now() + 5000) return null;
  checkBars(data.candles, 673);
  const last = data.candles.at(-1);
  if (data.asOf < last.time - 5000 || data.asOf > last.time + INTERVAL + 12_000) return null;
  return { ...instrument, source: data.source, sourceId: data.sourceId, asOf: data.asOf, candles: data.candles.slice(-HISTORY) };
}

export function startFeed(onUpdate, symbol = 'BTCUSDT') {
  if (!symbols.has(symbol)) throw new RangeError('不支持的永续合约');
  const instrument = { symbol, interval: '15m', market: 'perpetual' };
  const cacheKey = symbol.slice(0, -4).toLowerCase() + '-usdt-linear-perpetual-15m-v1';
  const snapshot = new URL(symbol === 'BTCUSDT' ? './snapshot.json' : './snapshots/' + symbol + '.json', import.meta.url);
  const binanceStream = 'wss://fstream.binance.com/market/ws/' + symbol.toLowerCase() + '@kline_15m';
  const controller = new AbortController();
  const { signal } = controller;
  let state = { ...instrument, sourceId: '', candles: [], price: null, asOf: null, source: '', status: 'loading', error: '' };
  let stopped = false;
  let feed = null;
  let socket = null;
  let socketTick = 0;
  let nextSocket = 0;
  let nextPoll = 0;
  let polling = false;
  let fullNeeded = false;
  let failures = 0;
  let lastCache = 0;

  function publish(data, status) {
    if (stopped) return;
    const changedMarket = state.sourceId !== data.sourceId;
    state = { ...data, price: data.candles.at(-1)?.close ?? null, status, error: '' };
    onUpdate(state);
    if (status !== 'live' || (!changedMarket && Date.now() - lastCache < 30_000)) return;
    lastCache = Date.now();
    try {
      const { candles, source, sourceId, asOf } = state;
      localStorage.setItem(cacheKey, JSON.stringify({ ...instrument, candles, source, sourceId, asOf }));
    } catch { /* Storage is optional in private browsing. */ }
  }

  function markUnavailable() {
    if (stopped) return;
    const status = state.candles.length ? 'stale' : 'offline';
    if (state.status === status) return;
    state = { ...state, status, error: '行情连接中断，正在重连' };
    onUpdate(state);
  }

  function acceptSnapshot(raw) {
    if (stopped || feed) return;
    const data = readSnapshot(raw, instrument);
    if (data && data.asOf > (state.asOf ?? 0)) publish(data, 'stale');
  }

  function merge(data) {
    if (data.symbol !== symbol || data.sourceId !== state.sourceId) throw new Error('行情源不同');
    const first = data.candles[0].time;
    const previous = state.candles.at(-1);
    if (!previous || first > previous.time + INTERVAL) throw new Error('需要补齐 K 线');
    // HTTP responses can arrive after a newer streaming event for the same live candle.
    if (data.asOf < state.asOf || data.candles.at(-1).time < previous.time) return;
    let cut = state.candles.length;
    while (cut > 0 && state.candles[cut - 1].time >= first) cut--;
    const candles = state.candles.slice(0, cut).concat(data.candles).slice(-HISTORY);
    if (candles.length < 673) throw new Error('需要补齐 K 线');
    publish({ ...data, candles }, 'live');
  }

  function closeStream() {
    const current = socket;
    socket = null;
    socketTick = 0;
    if (current) {
      current.onmessage = current.onopen = current.onclose = current.onerror = null;
      current.close();
    }
  }

  function connectStream() {
    if (stopped || socket || feed?.source !== 'Binance' || Date.now() < nextSocket) return;
    nextSocket = Date.now() + 25_000;
    let current;
    try { current = new WebSocket(binanceStream); } catch { return; }
    socket = current;
    current.onmessage = e => {
      if (socket !== current || stopped) return;
      try {
        const tick = JSON.parse(e.data);
        const k = tick.k;
        if (tick.e !== 'kline' || tick.s !== instrument.symbol || k.s !== instrument.symbol ||
            k.i !== instrument.interval || k.T - k.t !== INTERVAL - 1 || !Number.isFinite(tick.E) ||
            Math.abs(Date.now() - tick.E) > STALE_AFTER) return;
        const candles = checkBars([bar(k.t,k.o,k.h,k.l,k.c,k.v)]);
        merge({ ...instrument, source: 'Binance', sourceId: 'binance-usdm', candles, asOf: tick.E });
        socketTick = Date.now();
      } catch {
        fullNeeded = true;
        nextPoll = 0;
      }
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      socketTick = 0;
      nextSocket = Date.now() + 15_000;
      nextPoll = 0;
    };
    current.onerror = () => current.close();
  }

  async function discover() {
    for (const candidate of feeds.filter(f=>perpetualSources[symbol].includes(f.sourceId))) {
      if (stopped || navigator.onLine === false) return false;
      try {
        const [, data] = await Promise.all([verifyContract(candidate, instrument, signal), readMarket(candidate, true, instrument, signal)]);
        if (stopped) return false;
        feed = candidate;
        fullNeeded = false;
        failures = 0;
        publish(data, 'live');
        connectStream();
        return true;
      } catch { /* Try the next public endpoint with a complete history. */ }
    }
    return false;
  }

  async function tick() {
    if (stopped) return;
    const now = Date.now();
    if (navigator.onLine === false) {
      markUnavailable();
      return;
    }
    if (state.status === 'live' && now - state.asOf > STALE_AFTER) markUnavailable();
    connectStream();
    if (polling || now < nextPoll) return;
    polling = true;
    try {
      if (!feed) {
        if (!await discover()) {
          markUnavailable();
          nextPoll = Date.now() + 10_000;
          return;
        }
      } else {
        const needFull = fullNeeded || now - state.asOf >= 2 * INTERVAL;
        const data = await readMarket(feed, needFull, instrument, signal);
        if (stopped) return;
        if (needFull) {
          if (data.asOf >= state.asOf) publish(data, 'live');
          fullNeeded = false;
        } else {
          try { merge(data); } catch { fullNeeded = true; }
        }
        failures = 0;
      }
      nextPoll = fullNeeded ? 0 : Date.now() + 4000;
    } catch {
      failures++;
      if (failures >= 2 && Date.now() - socketTick > STALE_AFTER) {
        closeStream();
        feed = null;
        markUnavailable();
      }
      nextPoll = Date.now() + 2500;
    } finally {
      polling = false;
    }
  }

  // When streaming, periodic REST reconciliation corrects the just-completed candles.
  let lastReconcile = 0;
  function maintain() {
    if (stopped) return;
    const now = Date.now();
    const streaming = socketTick && now - socketTick < 7000;
    if (streaming && !fullNeeded && now - lastReconcile < 30_000) return;
    if (streaming) lastReconcile = now;
    void tick();
  }
  function resume() {
    if (stopped || document.hidden) return;
    nextPoll = 0;
    lastReconcile = 0;
    void tick();
  }
  onUpdate(state);
  try { acceptSnapshot(JSON.parse(localStorage.getItem(cacheKey))); } catch { /* No valid local history. */ }
  void fetchJSON(snapshot, signal).then(acceptSnapshot).catch(() => {});
  void tick();
  const timer = setInterval(maintain, 1000);
  window.addEventListener('online', resume);
  window.addEventListener('offline', markUnavailable);
  document.addEventListener('visibilitychange', resume);
  return () => {
    stopped = true;
    controller.abort();
    clearInterval(timer);
    closeStream();
    window.removeEventListener('online', resume);
    window.removeEventListener('offline', markUnavailable);
    document.removeEventListener('visibilitychange', resume);
  };
}
