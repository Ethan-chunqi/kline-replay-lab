// One instrument per training account. Margin trading requires an explicit futures contract.
export const DEFAULT_INITIAL_CASH = 500_000;
const EPSILON = 1e-9;
const emptyPosition = () => ({ qty: 0, avgPrice: 0, entryFees: 0, takeProfit: null, stopLoss: null });
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function positive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(name + '必须大于零');
  return number;
}

function basisPoints(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number >= 10000)
    throw new Error('费率或滑点须在 0 至 10000 基点之间');
  return number;
}

function timestamp(value) {
  if (typeof value === 'number') return value;
  return typeof value === 'string' ? Date.parse(value) / 1000 : NaN;
}

function validateBar(bar) {
  if (!bar || !Number.isFinite(timestamp(bar.time))) throw new Error('行情时间无效');
  const { open, high, low, close } = bar;
  if (
    ![open, high, low, close].every((value) => Number.isFinite(value) && value > 0) ||
    low > Math.min(open, close) ||
    high < Math.max(open, close)
  )
    throw new Error('行情价格无效');
}

function contractTerms(contract) {
  const multiplier = positive(contract.multiplier, '合约乘数');
  const marginRate = positive(contract.marginRate, '开仓保证金率');
  if (marginRate > 1) throw new Error('开仓保证金率须在 0 至 1 之间');
  const maintenanceRate = positive(contract.maintenanceRate ?? marginRate * 0.75, '维持保证金率');
  if (maintenanceRate >= marginRate) throw new Error('维持保证金率须低于开仓保证金率');
  const tickSize = positive(contract.tickSize ?? 0.2, '最小价格变动');
  return {
    ...contract,
    symbol: String(contract.symbol ?? ''),
    multiplier,
    marginRate,
    maintenanceRate,
    tickSize,
  };
}

export function defaultCapital(marketId) {
  return marketId === 'btcPerp' || marketId === 'btc' ? 10_000 : DEFAULT_INITIAL_CASH;
}

// Linear, cross-margin USDT practice contract. Maintenance uses a fixed training rate.
export function bitcoinPerpTerms(leverage = 1) {
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 100)
    throw new Error('请选择 1 至 100 之间的整数杠杆倍数');
  return {
    symbol: 'BTCUSDT', perpetual: true, leverage, multiplier: 1,
    quantityDecimals: 3, tickSize: 0.1, marginRate: 1 / leverage, maintenanceRate: 0.004,
  };
}

export function setPerpLeverage(account, leverage, mark) {
  if (!account.contract?.perpetual) throw new Error('当前账户没有永续合约');
  const terms = bitcoinPerpTerms(leverage);
  const snap = getSnapshot(account, mark);
  if (snap.notional * terms.marginRate > snap.equity + EPSILON)
    throw new Error('可用保证金不足以调低杠杆，请先减少持仓');
  account.contract = terms;
}

export function createAccount({
  initialCash = DEFAULT_INITIAL_CASH,
  feeBps = 3,
  slippageBps = 2,
  allowShort = true,
  contract = null,
  spotRules = null,
} = {}) {
  const capital = positive(initialCash, '初始资金');
  return {
    initialCash: capital,
    cash: capital,
    feeBps: basisPoints(feeBps),
    slippageBps: basisPoints(slippageBps),
    allowShort: spotRules ? false : Boolean(allowShort),
    ...(spotRules ? {spotRules} : {}),
    ...(contract == null ? {} : { contract: contractTerms(contract) }),
    position: emptyPosition(),
    orders: [],
    fills: [],
    equityCurve: [],
    lastTime: null,
    lastPrice: null,
    nextOrderId: 1,
    fees: 0,
    realized: 0,
    trades: 0,
    wins: 0,
    peakEquity: capital,
    maxDrawdownPct: 0,
    gapCredit: 0,
  };
}

function marked(account, price) {
  const { position, contract } = account;
  const units = position.qty * (contract?.multiplier ?? 1);
  const positionValue = units * price;
  const notional = Math.abs(positionValue);
  const floatingPnl = units * (price - position.avgPrice);
  // Futures exchange only fees and realized P&L in cash. The index model exchanges the full consideration.
  const equity = account.cash + (contract ? floatingPnl : positionValue);
  const marginUsed = notional * (contract?.marginRate ?? 1);
  const maintenanceMargin = notional * (contract?.maintenanceRate ?? (position.qty < 0 ? 0.5 : 0));
  const freeMargin = equity - marginUsed;
  const available = Math.max(0, freeMargin);
  const leverage = equity > 0 ? notional / equity : 0;
  return {
    positionValue,
    notional,
    floatingPnl,
    equity,
    marginUsed,
    maintenanceMargin,
    freeMargin,
    available,
    leverage,
  };
}

export function getSnapshot(account, barOrPrice = account.lastPrice) {
  const price = Number(typeof barOrPrice === 'object' && barOrPrice !== null ? barOrPrice.close : barOrPrice);
  if (!Number.isFinite(price) || price < 0 || (!price && account.position.qty))
    throw new Error('估值价格无效');
  const valuation = marked(account, price);
  const pnl = valuation.equity - account.initialCash;
  return {
    ...valuation,
    cash: account.cash,
    unrealized: valuation.floatingPnl - account.position.entryFees,
    realized: account.realized,
    pnl,
    returnPct: (pnl / account.initialCash) * 100,
    drawdownPct: Math.max(0, (1 - valuation.equity / account.peakEquity) * 100),
    maxDrawdownPct: account.maxDrawdownPct,
    trades: account.trades,
    winRate: account.trades ? (account.wins / account.trades) * 100 : 0,
    fees: account.fees,
  };
}

function recordEquity(account, bar) {
  const equity = marked(account, bar.close).equity;
  account.lastTime = bar.time;
  account.lastPrice = bar.close;
  account.peakEquity = Math.max(account.peakEquity, equity);
  account.maxDrawdownPct = Math.max(account.maxDrawdownPct, (1 - equity / account.peakEquity) * 100);
  const last = account.equityCurve.at(-1);
  if (last && timestamp(last.time) === timestamp(bar.time)) last.equity = equity;
  else account.equityCurve.push({ time: bar.time, equity });
}

function optionalPrice(value, name) {
  return value == null || value === '' ? null : positive(value, name);
}

function protectionFields(input) {
  const fields = {};
  if (has(input, 'stopLoss')) fields.stopLoss = optionalPrice(input.stopLoss, '止损价');
  if (has(input, 'takeProfit')) fields.takeProfit = optionalPrice(input.takeProfit, '止盈价');
  return fields;
}

function checkProtection(fields, side, price) {
  const sign = side === 'buy' ? 1 : -1;
  if (fields.stopLoss != null && (price - fields.stopLoss) * sign <= 0)
    throw new Error(side === 'buy' ? '多头止损价应低于参考价' : '空头止损价应高于参考价');
  if (fields.takeProfit != null && (fields.takeProfit - price) * sign <= 0)
    throw new Error(side === 'buy' ? '多头止盈价应高于参考价' : '空头止盈价应低于参考价');
}

function tickCount(price, tick) {
  const count = price / tick;
  const nearest = Math.round(count);
  return Math.abs(count - nearest) <= Math.max(1e-9, Math.abs(count) * Number.EPSILON * 8) ? nearest : count;
}

function validateTicks(account, fields) {
  const tick = account.contract ? account.contract.tickSize ?? 0.2 : account.spotRules?.tickSize;
  if (!tick) return;
  for (const [key, label] of [
    ['price', '委托价'],
    ['limitPrice', '限价'],
    ['stopLoss', '止损价'],
    ['takeProfit', '止盈价'],
  ]) {
    if (fields[key] != null && !Number.isInteger(tickCount(fields[key], tick)))
      throw new Error(label + '须为最小价格变动 ' + tick + ' 的整数倍');
  }
}

function executionPrice(account, order, marketPrice) {
  const sign = order.side === 'buy' ? 1 : -1;
  let slipped = marketPrice * (1 + (sign * account.slippageBps) / 10000);
  const tick = account.contract ? account.contract.tickSize ?? 0.2 : account.spotRules?.tickSize;
  if (tick) {
    const ticks = tickCount(slipped, tick);
    const rounded = order.side === 'buy' ? Math.ceil(ticks) : Math.floor(ticks);
    slipped = Number((Math.max(1, rounded) * tick).toPrecision(15));
  }
  const limit = order.type === 'stopLimit' ? order.limitPrice : order.type === 'limit' ? order.price : null;
  if (limit === null) return slipped;
  return order.side === 'buy' ? Math.min(slipped, limit) : Math.max(slipped, limit);
}

// Same-direction opening capacity at the ticket's reference price.
export function bitcoinOpeningCapacity(account, order, mark) {
  if (!Number.isFinite(mark) || mark <= 0) return 0;
  const execution = executionPrice(account, order, mark);
  const feePerBtc = execution * account.feeBps / 10000;
  if (!account.contract)
    return order.side === 'buy' ? account.cash / (execution + feePerBtc) : 0;
  const slippageCost = (order.side === 'buy' ? 1 : -1) * (execution - mark);
  const cost = mark * account.contract.marginRate + slippageCost + feePerBtc;
  const free = marked(account, mark).available;
  return Math.min(free / cost, feePerBtc ? account.cash / feePerBtc : Infinity);
}

function quote(account, order, price, mark = price) {
  const oldQty = account.position.qty;
  const sign = order.side === 'buy' ? 1 : -1;
  if (order.reduceOnly && oldQty * sign >= 0) throw new Error('没有可平的对应方向持仓');
  const qty = order.reduceOnly ? Math.min(Math.abs(oldQty), order.qty) : order.qty;
  const closedQty = oldQty * sign < 0 ? Math.min(Math.abs(oldQty), qty) : 0;
  const openedQty = qty - closedQty;
  const remainder = oldQty + sign * qty;
  const quantityDecimals = account.contract?.quantityDecimals ?? account.spotRules?.quantityDecimals;
  const nextQty = quantityDecimals != null
    ? Number(remainder.toFixed(quantityDecimals))
    : Math.abs(remainder) <= Number.EPSILON * Math.max(Math.abs(oldQty), qty) * 4 ? 0 : remainder;
  const multiplier = account.contract?.multiplier ?? 1;
  const notional = qty * price * multiplier;
  const fee = (notional * account.feeBps) / 10000;
  const closedGrossPnl = closedQty * Math.sign(oldQty) * (price - account.position.avgPrice) * multiplier;
  const nextCash = account.cash + (account.contract ? closedGrossPnl : -sign * notional) - fee;
  if (![nextQty, nextCash, notional, fee].every(Number.isFinite)) throw new Error('委托金额超过有效范围');
  if (nextQty !== 0 && nextCash < -EPSILON) throw new Error('可用资金不足，请调整数量');
  if (nextQty < 0 && openedQty > 0 && !account.allowShort) throw new Error('已关闭做空，可卖数量不足');
  if (openedQty > 0 && account.contract) {
    const projectedEquity = marked(account, mark).equity + sign * qty * multiplier * (mark - price) - fee;
    const required = Math.abs(nextQty) * multiplier * mark * account.contract.marginRate;
    if (projectedEquity + EPSILON < required) throw new Error('可用保证金不足，请减少手数');
  } else if (openedQty > 0) {
    const locked = nextQty < 0 ? -2 * nextQty * Math.max(mark, price) : 0;
    if (nextCash + EPSILON < locked) throw new Error('可用资金不足，请减少数量');
  }
  return { qty, closedQty, openedQty, nextQty, fee, nextCash, closedGrossPnl };
}

function execute(account, order, marketPrice, time) {
  const price = executionPrice(account, order, marketPrice);
  const { qty, closedQty, openedQty, nextQty, fee, nextCash, closedGrossPnl } = quote(
    account,
    order,
    price,
    marketPrice,
  );
  const old = account.position;
  const entryFeesClosed = closedQty ? old.entryFees * (closedQty / Math.abs(old.qty)) : 0;
  const exitFee = fee * (closedQty / qty);
  let realizedPnl = closedGrossPnl - entryFeesClosed - exitFee;
  // An extreme overnight gap can exceed all collateral. A liquidated training account stops at zero.
  const gapCredit = nextQty === 0 && nextCash < -EPSILON ? -nextCash : 0;
  realizedPnl += gapCredit;
  if (!nextQty) {
    account.position = emptyPosition();
  } else if (openedQty && nextQty * old.qty <= 0) {
    account.position = {
      qty: nextQty,
      avgPrice: price,
      entryFees: fee - exitFee,
      takeProfit: order.takeProfit ?? null,
      stopLoss: order.stopLoss ?? null,
    };
  } else {
    if (openedQty) {
      old.avgPrice = (Math.abs(old.qty) * old.avgPrice + openedQty * price) / Math.abs(nextQty);
      Object.assign(old, protectionFields(order));
    }
    old.qty = nextQty;
    old.entryFees = Math.max(0, old.entryFees - entryFeesClosed + fee - exitFee);
  }
  account.cash = Math.max(0, nextCash + gapCredit);
  account.gapCredit += gapCredit;
  account.fees += fee;
  account.realized += realizedPnl;
  if (closedQty) {
    account.trades++;
    if (realizedPnl > EPSILON) account.wins++;
  }
  Object.assign(order, { status: 'filled', fillTime: time, fillPrice: price, filledQty: qty });
  const fill = {
    id: account.fills.length + 1,
    orderId: order.id,
    recordedAt: Date.now(),
    time,
    side: order.side,
    qty,
    price,
    fee,
    closedQty,
    realizedPnl,
    reason: order.reason,
    gapCredit,
  };
  account.fills.push(fill);
  return fill;
}

function newOrder(account, fields, time) {
  const order = {
    id: account.nextOrderId++,
    status: 'pending',
    time,
    fillTime: null,
    fillPrice: null,
    filledQty: 0,
    reduceOnly: false,
    price: null,
    ...fields,
  };
  account.orders.push(order);
  return order;
}

function cancelPending(account, reason) {
  for (const order of account.orders) {
    if (order.status === 'pending') Object.assign(order, { status: 'cancelled', reason });
  }
}

// When multiple levels are crossed, walk the public OHLC bar in one documented order.
// Marketable gaps fill at the open; price improves on limits and may gap through stops.
function nextEvent(account, start, end) {
  let next = null;
  function consider(direction, level, details) {
    if (level == null) return;
    let at;
    if ((start - level) * direction >= 0) at = start;
    else if ((end - level) * direction >= 0) at = level;
    else return;
    const distance = Math.abs(at - start);
    if (!next || distance < next.distance) next = { ...details, at, distance };
  }
  const position = account.position;
  if (position.qty) {
    const sign = Math.sign(position.qty);
    if (account.contract) {
      // Solve cash + units * (mark - entry) = abs(units) * mark * maintenanceRate.
      const units = position.qty * account.contract.multiplier;
      const callPrice =
        (position.avgPrice - account.cash / units) / (1 - sign * account.contract.maintenanceRate);
      consider(-sign, callPrice, { reason: 'marginCall' });
    } else if (sign < 0) {
      consider(1, account.cash / (1.5 * -position.qty), { reason: 'marginCall' });
    }
    consider(-sign, position.stopLoss, { reason: 'stopLoss' });
    consider(sign, position.takeProfit, { reason: 'takeProfit' });
  }
  for (const order of account.orders) {
    if (order.status !== 'pending') continue;
    const sign = order.side === 'buy' ? 1 : -1;
    if (order.type === 'stopLimit') {
      if (order.activated) consider(-sign, order.limitPrice, { order });
      else consider(sign, order.price, { order, activate: true });
    } else {
      consider(order.type === 'limit' ? -sign : sign, order.price, { order });
    }
  }
  return next;
}

function runSegment(account, start, end, time) {
  let cursor = start;
  for (;;) {
    const event = nextEvent(account, cursor, end);
    if (!event) return;
    cursor = event.at;
    if (event.activate) {
      Object.assign(event.order, { activated: true, activatedAt: time, activationPrice: cursor });
      continue;
    }
    if (event.order) {
      try {
        execute(account, event.order, cursor, time);
      } catch (error) {
        Object.assign(event.order, { status: 'rejected', reason: error.message });
      }
      continue;
    }
    const position = account.position;
    const takeProfit = event.reason === 'takeProfit';
    const order = newOrder(
      account,
      {
        side: position.qty > 0 ? 'sell' : 'buy',
        type: takeProfit ? 'limit' : 'stop',
        qty: Math.abs(position.qty),
        price: takeProfit ? position.takeProfit : cursor,
        reason: event.reason,
        reduceOnly: true,
      },
      time,
    );
    execute(account, order, cursor, time);
    if (event.reason === 'marginCall') cancelPending(account, '强平后撤销未成交委托');
  }
}

export function advanceBar(account, bar) {
  validateBar(bar);
  const time = timestamp(bar.time);
  if (account.lastTime !== null) {
    const last = timestamp(account.lastTime);
    if (time < last) throw new Error('不能在当前进度之前交易');
    if (time === last) {
      if (bar.close !== account.lastPrice) throw new Error('同一根 K 线收盘价不一致');
      return getSnapshot(account, bar);
    }
  }
  const { open, low, high, close } = bar;
  const lowFirst = open - low <= high - open;
  const first = lowFirst ? low : high;
  const second = lowFirst ? high : low;
  runSegment(account, open, first, bar.time);
  runSegment(account, first, second, bar.time);
  runSegment(account, second, close, bar.time);
  recordEquity(account, bar);
  return getSnapshot(account, bar);
}

export function placeOrder(account, input, bar) {
  advanceBar(account, bar);
  const { side, type = 'market', reduceOnly = false } = input;
  if (!['buy', 'sell'].includes(side) || !['market', 'limit', 'stop', 'stopLimit'].includes(type))
    throw new Error('委托方向或类型无效');
  const qty = positive(input.qty, '委托数量');
  const decimals = account.contract?.quantityDecimals ?? account.spotRules?.quantityDecimals;
  if (decimals != null) {
    const step = 1 / 10 ** decimals;
    if (!Number.isSafeInteger(tickCount(qty, step)) || qty < step)
      throw new Error('数量须为 ' + step + ' BTC 的正整数倍');
  } else if (account.contract && !Number.isSafeInteger(qty)) throw new Error('期货委托手数须为正整数');
  const price = type === 'market' ? null : positive(input.price, '触发价格');
  const fields = {
    side,
    type,
    price,
    qty,
    reduceOnly: Boolean(reduceOnly),
    reason: type,
    ...protectionFields(input),
  };
  if (type === 'stopLimit') {
    Object.assign(fields, {
      limitPrice: positive(input.limitPrice, '限价'),
      activated: false,
      activatedAt: null,
      activationPrice: null,
    });
  }
  validateTicks(account, fields);
  const reference = fields.limitPrice ?? price ?? bar.close;
  const terms = quote(account, fields, executionPrice(account, fields, reference), reference);
  if (terms.openedQty) checkProtection(fields, side, reference);
  else if (fields.stopLoss != null || fields.takeProfit != null) throw new Error('平仓委托无需设置止盈止损');
  const order = newOrder(account, fields, bar.time);
  if (type === 'market') {
    execute(account, order, bar.close, bar.time);
    recordEquity(account, bar);
  }
  return order;
}

export function cancelOrder(account, id) {
  const order = account.orders.find((item) => String(item.id) === String(id));
  if (!order || order.status !== 'pending') throw new Error('没有可撤销的对应委托');
  Object.assign(order, { status: 'cancelled', reason: '手动撤单' });
  return order;
}

export function closePosition(account, bar) {
  advanceBar(account, bar);
  const qty = account.position.qty;
  if (!qty) throw new Error('当前没有持仓');
  return placeOrder(
    account,
    { side: qty > 0 ? 'sell' : 'buy', type: 'market', qty: Math.abs(qty), reduceOnly: true },
    bar,
  );
}

export function updateProtection(account, input, bar) {
  advanceBar(account, bar);
  const position = account.position;
  if (!position.qty) throw new Error('当前没有可设置止盈止损的持仓');
  const fields = protectionFields(input);
  validateTicks(account, fields);
  checkProtection(fields, position.qty > 0 ? 'buy' : 'sell', bar.close);
  Object.assign(position, fields);
  return position;
}
