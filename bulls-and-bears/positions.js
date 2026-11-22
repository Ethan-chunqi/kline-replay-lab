import {perpetualSources,bitgetPath,venueNames} from './perpetuals.js?v=20261122-market-v3';
import {quotePerDollar,fxAsOf} from './equivalents/rates.js?v=20261122-market-v3';
import { createEquivalent } from './equivalents/view.js?v=20261122-editorial-2';
import { createBankComparison } from './bank.js?v=20261122-poster-layout';
import { parseAmount, readPrincipal } from './metrics.js?v=20261122-market-v3';

const storageKey = 'market-positions-v1';
const groupStore = 'market-positions-v2/';
const legacyKey = 'tide-linear-perp-settings-v2';

const leverages = [1,2,3,5,10,20,25,50,75,100,125];
const locales = { zh:'zh-CN', en:'en-US', ja:'ja-JP', ko:'ko-KR', ru:'ru-RU' };
const digitsCache = new Map();
const QUOTE_FRESH = 18_000;
const POSITIVE = value => Number.isFinite(value) && value > 0;

function futures(s) { return s.type === 'future' && (s.market === 'cn' || s.market === 'future'); }
function actualContract(s) {
  const name = typeof s.contract === 'string' ? s.contract.toUpperCase() : '';
  return /^(IF|IH|IC|IM)\d{4}$/.test(name) ? name : '';
}
function capitalUnit(s) {return ['us','kr'].includes(s.market)?'USDT':s.currency || 'USDT';}
function settingsGroup(s) { return futures(s) ? 'future/' + actualContract(s) : s.market; }

const sessionPrefs = new Map();
function saved(key) { try { return JSON.parse(localStorage.getItem(key)) ?? sessionPrefs.get(key); } catch { return sessionPrefs.get(key); } }
function store(key,value) { sessionPrefs.set(key,value); try { localStorage.setItem(key,JSON.stringify(value)); } catch { /* Optional. */ } }

function num(lang,value,min = 0,max = min) {
  if (!Number.isFinite(value)) return '—';
  const key = [lang,min,max].join('/');
  if (!digitsCache.has(key)) digitsCache.set(key,new Intl.NumberFormat(locales[lang] ?? locales.zh,{minimumFractionDigits:min,maximumFractionDigits:max}));
  return digitsCache.get(key).format(value);
}

function readAmount(text,lang) {
  const raw = String(text).trim().replace(/[\s\u00a0\u202f]/g,'');
  return parseAmount(lang === 'ru' && raw.includes(',') && !raw.includes('.') ? raw.replace(',','.') : raw);
}

function label(key) { return '<span data-pos-text="' + key + '"></span>'; }
function field(id,caption,unit) {
  return '<label class="position-field" id="' + id + '-label">' + label(caption) +
    '<span class="input-wrap"><input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="input-error"><span data-unit="' + unit + '"></span></span></label>';
}
const details = [
  ['margin','principalLabel'], ['leverage','杠杆倍数'], ['notional','入场名义金额'], ['quantity','持仓数量'],
  ['value','当前持仓价值'], ['entry','参考开仓价'], ['mark','标记价格'], ['liquidation','liquidation'],
  ['contract','合约'], ['multiplier','合约乘数'], ['tick','最小变动价位'], ['point-value','每点盈亏'],
  ['tick-value','每跳盈亏'], ['margin-used','目前保证金占用'],
];
function detailsToggle() {
  return '<summary><span class="when-closed">' + label('positionDetails') + '</span><span class="when-open">' + label('hidePositionDetails') + '</span></summary>';
}

function shareButton(side) {
  const chartIcon='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4v3m0 8v5m7-18v3m0 7v5m7-10v4m0 6v4"/><path d="M3 7h4v8H3zM10 5h4v7h-4zM17 11h4v6h-4z"/></svg>';
  const cardIcon='<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m6 15 4-4 3 2 4-5"/></svg>';
  const cardName=side==='savings'?label('shareSavingsStyle'):'<span id="'+side+'-share-style"></span>';
  return '<div class="position-share-actions" role="group"><button type="button" aria-haspopup="dialog" class="position-share" data-share-side="'+side+'">'+chartIcon+label('shareChartStyle')+'</button>'+
    '<button type="button" aria-haspopup="dialog" class="position-share" data-pnl-side="'+side+'">'+cardIcon+cardName+'</button></div>';
}

function cycleDetails(short) {
  const side = short ? 'high' : 'low';
  return `<section class="cycle-detail ${side}-box">
    <div class="extreme-top"><h4>${label(short?'历史高点回撤':'周期低点反弹')}</h4>
    <button type="button" class="locate" data-locate="${side}" data-i18n-aria="${short?'查看高点 K 线':'查看低点 K 线'}" disabled>${label('定位 K 线')} ↗</button></div>
    <div class="level">${short?label('历史最高价'):'<span></span>'}<strong id="${side}-price">—</strong></div>
    <div class="when"><b id="${side}-ago">—</b><time id="${side}-at">—</time></div>
    <small class="cycle-status" id="${side}-cycle-status"></small></section>`;
}
function card(side) {
  const short = side === 'short';
  const futureRows = ['contract','multiplier','tick','point-value','tick-value','margin-used'];
  const rows = details.map(([name,caption]) =>
    '<div' + (name === 'liquidation' ? ' data-contract-row' : futureRows.includes(name) ? ' data-future-row' : name === 'leverage' ? ' data-sim-leverage' : '') +
    '><dt id="' + side + '-' + name + '-label">' + label(caption) + '</dt><dd id="' + side + '-' + name + '">—</dd></div>').join('');
  return '<article class="result result-' + side + '"><div class="result-head"><span class="position"><svg aria-hidden="true"><use href="#i-' +
    (short ? 'down' : 'up') + '"/></svg>' + label(short ? '做空' : '做多') + '</span><span class="result-label">' + label('未实现盈亏') +
    '</span></div><div class="result-price"><strong id="' + side + '-pnl">—</strong><span data-unit="currency"></span></div>' +
    '<div class="position-metrics"><div>' + label('returnOnCapital') + ' <b id="' + side + '-roi">—</b></div><div>' +
    label(short?'priceDrawdown':'priceRebound') + ' <b id="' + (short?'drawdown':'rebound') + '">—</b></div></div>' +
    '<div class="entry-compare"><div>'+label(short?'sellPoint':'buyPoint')+'<b id="'+side+'-point-price">—</b></div>'+
    '<div>'+label('currentTradePrice')+'<b id="'+side+'-current-price">—</b></div></div>'+
    '<div class="value-equivalent" hidden></div><p class="position-risk" id="' + side + '-risk" hidden></p>' +
    '<details class="position-details">' + detailsToggle() + cycleDetails(short) + '<dl class="position-table">' + rows + '</dl></details>'+shareButton(side)+'</article>';
}

// One-way linear, isolated simulation. Maintenance is a fixed reference share
// of the current notional. Liquidation is the mark at which equity meets maintenance.
export function calculatePosition(capital,leverage,entry,mark,direction,rate) {
  const notional = capital * leverage;
  const quantity = notional / entry;
  const value = quantity * mark;
  const profit = direction * quantity * (mark - entry);
  const roe = profit / capital * 100;
  const equity = capital + profit;
  const risk = Number.isFinite(rate) && rate > 0 && rate < 1/leverage;
  const maintenance = risk ? value * rate : null;
  const liquidation = risk ? (notional - direction * capital) / (quantity * (1 - direction * rate)) : null;
  return { notional,quantity,value,profit,roe,
    liquidation, ratio:risk ? (equity > 0 ? maintenance / equity * 100 : Infinity) : null,
    crossed:risk && equity <= maintenance };
}

// CFFEX instruments have a CNY multiplier per index point per contract. Lots
// determine the exposure; the supplied margin fraction only determines collateral.
export function calculateFuturesPosition({lots,multiplier,tick,entry,mark,direction,marginRate}) {
  const valid = Number.isSafeInteger(lots) && lots > 0 && POSITIVE(multiplier);
  const perPoint = valid ? lots*multiplier : null;
  const amount = perPoint && POSITIVE(entry) ? entry*perPoint : null;
  const value = perPoint && POSITIVE(mark) ? mark*perPoint : null;
  const profit = amount && value ? (mark-entry)*direction*perPoint : null;
  const rate = POSITIVE(marginRate) && marginRate <= 1 ? marginRate : null;
  const margin = amount && rate ? amount*rate : null;
  return { quantity:valid ? lots : null, notional:amount, value, profit,
    margin, used:value && rate ? value*rate : null, roe:margin && Number.isFinite(profit) ? profit/margin*100 : null,
    point:perPoint ? perPoint*direction : null, tick:perPoint && POSITIVE(tick) ? perPoint*tick*direction : null };
}

async function venueMark(symbol,sourceId,signal) {
  const binance = sourceId === 'binance-usdm';
  const bitget=sourceId==='bitget-usdt';
  const urls = bitget ? [bitgetPath('ticker',symbol)] : binance ? ['https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + symbol] :
    ['https://api.bybit.com','https://api.bytick.com'].map(h => h + '/v5/market/tickers?category=linear&symbol=' + symbol);
  for (const url of urls) {
    signal.throwIfAborted();
    try {
      const res = await fetch(url,{ signal, cache:'no-store', credentials:'omit' });
      if (!res.ok) continue;
      const raw = await res.json();
      let row;
      if (binance) row = raw;
      else if(bitget && raw.code==='00000')row=raw.data?.find(r=>r.symbol===symbol);
      else if (raw.retCode === 0 && raw.result?.category === 'linear') row = raw.result.list.find(item => item.symbol === symbol);
      const price = +row?.markPrice;
      const asOf = +(bitget ? row?.ts : raw.time);
      if (row?.symbol === symbol && POSITIVE(price) && Number.isSafeInteger(asOf) &&
          asOf <= Date.now() + 3000 && Date.now() - asOf < QUOTE_FRESH) return { symbol,sourceId,price,asOf };
    } catch { /* Try another hostname of the same venue, or fall back to the last trade. */ }
  }
  return null;
}

export function createPositions(host,{t,onShare}) {
  host.innerHTML = '<div class="calc-grid"><div class="calc-controls"><div class="amount-row" id="capital-row">' + field('capital','principalLabel','capital') +
    '<label class="leverage position-field">' + label('杠杆倍数') + '<select id="leverage">' +
    leverages.map(l => '<option value="' + l + '">' + l + '×</option>').join('') + '</select></label></div>' +
    '<div class="amount-row" id="future-controls" hidden>' + field('lots','交易手数','lots') + '</div><small class="result-label position-rate-source" id="future-rate-info" hidden><span id="future-rate-source"></span> <a id="future-rate-evidence" target="_blank" rel="noopener noreferrer" hidden></a></small>' +
    '<details class="entry-settings"><summary>' + label('entrySettings') + '</summary><label class="position-field">' + label('开仓基准') + '<select id="basis"><option value="extremes" data-pos-text="历史高点做空 / 周期低点做多"></option>' +
    '<option value="custom" data-pos-text="自定义多空开仓价"></option></select></label>' + field('entry','自定义开仓价','price') + '</details>' +
    '<p id="input-error" role="status" hidden></p></div>' + card('long') + card('short') +
    '<article class="result bank-comparison"></article></div><p class="position-quote"></p><p class="calc-note position-note"></p>';
  const equivalents=Object.fromEntries(['short','long'].map(side=>[side,createEquivalent(host.querySelector('.result-'+side+' .value-equivalent'),t)]));
  const bank=createBankComparison(host.querySelector('.bank-comparison'),{t,num,detailsToggle,shareButton,readAmount:(text,lang)=>readPrincipal(text,lang,'CNY')});
  const shareValues={};
  for(const button of host.querySelectorAll('[data-share-side],[data-pnl-side]')){
    button.addEventListener('click',()=>onShare(button.dataset.shareSide||button.dataset.pnlSide,button.dataset.pnlSide?'trade':'report'));
  }
  const elements = new Map([...host.querySelectorAll('[id]')].map(el => [el.id,el]));
  const el = id => elements.get(id);
  const write = (id,v) => { if (el(id).textContent !== v) el(id).textContent = v; };
  const textItems = [...host.querySelectorAll('[data-pos-text]')];
  const note = host.querySelector('.position-note');
  const quote = host.querySelector('p.position-quote');
  let group = '';
  let state = { lang:'zh',symbol:'',market:'perpetual',currency:'USDT',status:'loading' };
  let basisKey = '';
  let language = '';
  let mark = null;
  let nextFetch = 0;
  let pending;
  let disposed = false;
  let lastClockKey = '';
  let lastClock = '';
  el('capital').value = '10,000';
  el('leverage').value = '10';
  el('lots').value = '2';
  el('lots').inputMode = 'numeric';

  function restoreGroup(next,lang) {
    group = settingsGroup(next);
    // The original unscoped capital came from the perpetuals-only terminal.
    // New securities portfolios start independently at their own default values.
    const prefs = saved(groupStore+group) ?? (group === 'perpetual' ? saved(storageKey) ?? saved(legacyKey) : null);
    el('capital').value = num(lang,POSITIVE(+prefs?.capital) ? +prefs.capital : 10000,0,8);
    el('leverage').value = leverages.includes(+prefs?.leverage) ? String(prefs.leverage) : '10';
    el('lots').value = String(Number.isSafeInteger(prefs?.lots) && prefs.lots > 0 ? prefs.lots : 2);
  }

  function persist() {
    const capital = readPrincipal(el('capital').value,state.lang,capitalUnit(state));
    const leverage = +el('leverage').value;
    if (futures(state)) {
      const lots = readAmount(el('lots').value,state.lang);
      if (actualContract(state) && Number.isSafeInteger(lots) && lots > 0) {
        store(groupStore+group,{lots});
      }
    } else if (capital) {
      store(groupStore+group,{capital,leverage});
    }
    const entry = readAmount(el('entry').value,state.lang);
    if (basisKey && (entry || el('basis').value === 'extremes')) store(basisKey,{entry,basis:el('basis').value});
  }

  function validMark() {
    return state.status === 'live' && mark?.symbol === state.symbol && mark.sourceId === state.sourceId &&
      Math.abs(mark.asOf-state.asOf) < QUOTE_FRESH && Date.now()-mark.asOf < QUOTE_FRESH && Date.now()-state.asOf < QUOTE_FRESH;
  }

  function clock(asOf) {
    if (!Number.isSafeInteger(asOf)) return '';
    const key = [state.lang,state.market,Math.floor(asOf/1000)].join('/');
    if (key !== lastClockKey) {
      lastClockKey = key;
      lastClock = new Intl.DateTimeFormat(locales[state.lang] ?? 'zh-CN', {
        timeZone:state.market === 'us' ? 'America/New_York' : state.market==='kr'?'Asia/Seoul':'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23',
      }).format(asOf);
    }
    return lastClock;
  }

  function signed(n,digits = 2) {
    if (!Number.isFinite(n)) return '—';
    const sign = n === 0 ? '' : n > 0 ? '+' : '−';
    const places = n !== 0 && Math.abs(n) < 10 ** -digits ? Math.min(8,Math.max(digits+1,Math.ceil(-Math.log10(Math.abs(n))))) : digits;
    return sign + num(state.lang,Math.abs(n),digits,places);
  }

  function draw() {
    if (disposed) return;
    const { lang,market,symbol,currency = 'USDT',type,sourceId } = state;
    const tr = key => t(lang,key);
    const crypto = market === 'perpetual';
    const future = futures(state), index = type === 'index';
    const contract = actualContract(state);
    const lots = readAmount(el('lots').value,lang);
    const validLots = Number.isSafeInteger(lots) && lots > 0;
    const officialRate=state.marginRate;
    const digits = Number.isInteger(state.priceDigits) ? Math.max(0,Math.min(8,state.priceDigits)) : 2;
    const priceUnit = index || future ? tr('点') : currency;
    const quantityUnit = future ? tr('手') : crypto ? (state.base || symbol.replace(/USDT$/,'')) : tr(index ? '模拟份额' : '股');
    const cap = readPrincipal(el('capital').value,lang,capitalUnit(state));
    const valuationCapital=market==='kr' && cap?cap*quotePerDollar('KRW'):cap;
    bank.update({lang,currency:market==='kr'?'USDT':currency,capital:cap,future});
    const leverage = +el('leverage').value;
    const custom = el('basis').value === 'custom';
    const entryValue = readAmount(el('entry').value,lang);
    const error = future && !validLots ? '请输入大于零的整数手数。' :
      !future && !cap ? '请输入大于 0 的有效本金。' : custom && !entryValue ? '请输入大于 0 的有效开仓价。' : '';
    if (language !== lang) {
      language = lang;
      for (const item of textItems) item.textContent = tr(item.dataset.posText);
      for(const group of host.querySelectorAll('.position-share-actions'))group.setAttribute('aria-label',tr('shareCard'));
    }
    for (const child of host.querySelectorAll('[data-unit]')) child.textContent = {currency,price:priceUnit,percent:'%',lots:tr('手'),capital:capitalUnit(state)}[child.dataset.unit];
    el('capital-row').hidden = future;
    el('future-controls').hidden = !future;
    el('future-rate-info').hidden = !future;
    if (future) {
      const reference=POSITIVE(officialRate)?tr('bankCollateralSource'):'';
      write('future-rate-source',reference);
      const stamp = state.marginAsOf ?? state.marginSourceDate;
      const date = Number.isSafeInteger(stamp) && Math.abs(stamp) <= 8.64e15 ? new Date(stamp).toISOString().slice(0,10) :
        typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(stamp) ? stamp.slice(0,10) : '';
      const link = el('future-rate-evidence');
      let evidence;
      try { evidence = new URL(state.marginSourceUrl); } catch { /* Reference URL is optional. */ }
      link.hidden = !reference || !evidence || !['http:', 'https:'].includes(evidence.protocol);
      if (!link.hidden) {
        link.href = evidence.href;
        link.textContent = date || evidence.hostname;
      } else if (reference && date) {
        write('future-rate-source',el('future-rate-source').textContent+' · '+date);
      }
    }
    el('lots').setAttribute('aria-invalid',String(future && !validLots));
    for (const r of host.querySelectorAll('[data-future-row]')) r.hidden = !future;
    for (const r of host.querySelectorAll('[data-sim-leverage]')) r.hidden = future;
    el('entry-label').hidden = !custom;
    el('capital').setAttribute('aria-invalid',String(!cap));
    el('entry').setAttribute('aria-invalid',String(custom && !entryValue));
    write('input-error',error ? tr(error) : '');
    el('input-error').hidden = !error;
    for (const r of host.querySelectorAll('[data-contract-row]')) r.hidden = !crypto;
    const hasMark = crypto && validMark();
    const estimate = hasMark ? mark.price : future && !contract ? null : state.lastPrice;
    const asOf = hasMark ? mark.asOf : state.asOf;
    const stale = ['stale','offline'].includes(state.status) || (crypto && (!asOf || Date.now()-asOf >= QUOTE_FRESH));
    const basisLabel = hasMark ? '交易所标记价' : stale ? 'estimateBySnapshot' : 'estimateByLast';
    const venue = hasMark ? venueNames[sourceId] + ' · ' : '';
    quote.textContent = POSITIVE(estimate) ? venue + tr(basisLabel) + ' · ' + clock(asOf) : tr('等待报价');
    note.textContent = future ? [tr('officialCollateralNote'),tr('每点及每跳盈亏以价格上涨为例。')].join(' ') :
      crypto ? tr('simLiquidationNote') :
      (market==='kr' ? tr('simulationRate')+' · 1 USDT = '+num(lang,quotePerDollar('KRW'),2)+' KRW · '+fxAsOf+' · ' : market === 'us' ? tr('美股本金以 USDT 输入，按 1 USDT = 1 USD 模拟，盈亏以美元显示。') + ' ' : '') + tr('证券和指数按模拟敞口计算，不含成本。');
    const money = v => Number.isFinite(v) ? num(lang,v,2,2) + ' ' + currency : '—';
    const price = v => Number.isFinite(v) ? num(lang,v,digits,digits) + ' ' + priceUnit : '—';
    const cert = state.levels?.sourceId && state.levels.sourceId === sourceId && state.levels.symbol === symbol &&
      (!state.levels.status || state.levels.status === 'ready') &&
      (!future || (contract && (!state.levels.contract || state.levels.contract === contract)));
    for (const side of ['short','long']) {
      write(side+'-share-style',tr(crypto||future?'shareContractStyle':'sharePnlStyle'));
      const dir = side === 'long' ? 1 : -1;
      const entry = custom ? entryValue : cert ? state.levels[dir > 0 ? 'low' : 'high']?.price : null;
      const contractResult = future ? calculateFuturesPosition({lots,multiplier:contract ? state.multiplier : null,tick:state.tick,
        entry,mark:estimate,direction:dir,marginRate:officialRate}) : null;
      const result = future ? contractResult : cap && POSITIVE(entry) && POSITIVE(estimate) ? calculatePosition(valuationCapital,leverage,entry,estimate,dir,crypto ? 0.005 : null) : null;
      const amount = future ? contractResult.notional : valuationCapital ? valuationCapital*leverage : null;
      const quantity = future ? contractResult.quantity : amount && POSITIVE(entry) ? amount/entry : null;
      const capitalCurrency=capitalUnit(state);
      write(side+'-margin-label',tr(future ? '开仓保证金' : 'principalLabel'));
      write(side+'-margin',future ? money(contractResult.margin) : cap ? num(lang,cap,2,2)+' '+capitalCurrency : '—');
      write(side+'-leverage',leverage+'×');
      write(side+'-notional',money(amount));
      if (future) {
        write(side+'-contract',contract || '—');
        write(side+'-multiplier',contract && POSITIVE(state.multiplier) ? num(lang,state.multiplier,0,4)+' '+tr('元／点／手') : '—');
        write(side+'-tick',contract && POSITIVE(state.tick) ? num(lang,state.tick,0,6)+' '+tr('点') : '—');
        write(side+'-point-value',Number.isFinite(contractResult.point) ? signed(contractResult.point)+' '+currency : '—');
        write(side+'-tick-value',Number.isFinite(contractResult.tick) ? signed(contractResult.tick)+' '+currency : '—');
        write(side+'-margin-used',money(contractResult.used));
      }
      write(side+'-quantity',Number.isFinite(quantity) ? num(lang,quantity,0,8)+' '+quantityUnit : '—');
      write(side+'-value',money(result?.value));
      write(side+'-entry',price(entry));
      write(side+'-point-price',price(entry));
      write(side+'-current-price',price(state.lastPrice));
      write(side+'-mark',price(estimate));
      write(side+'-mark-label',tr(hasMark ? '标记价格' : index ? '指数点位' : '最新成交价'));
      write(side+'-value-label',tr(index ? '模拟敞口' : '当前持仓价值'));
      equivalents[side].update(result?.profit,currency,lang,symbol,equivalents[side==='short'?'long':'short'].id);
      write(side+'-pnl',signed(result?.profit));
      write(side+'-roi',Number.isFinite(result?.roe) ? signed(result.roe)+'%' : '—');
      shareValues[side]=Number.isFinite(result?.profit) ? {
        pnl:result.profit,pnlText:signed(result.profit)+' '+currency,roiText:el(side+'-roi').textContent,
        capitalText:el(side+'-margin').textContent,leverageText:future?'':leverage+'×',lotsText:future?num(lang,lots)+' '+tr('手'):'',
        entryNotionalText:money(amount),entryPriceText:price(entry),entryBasisText:custom?tr('shareEntryCustom'):tr(dir>0?'峰后低点':'历史高点'),
        entryKind:custom?'custom':dir>0?'low':'high',asOf,markPriceText:price(estimate),markLabel:tr(basisLabel)
      }:null;
      for (const name of ['pnl','roi']) el(side+'-'+name).dataset.tone = !Number.isFinite(result?.profit) || result.profit === 0 ? 'neutral' : result.profit > 0 ? 'positive':'negative';
      if (crypto) {
        write(side+'-liquidation',result?.liquidation === 0 ? tr('无正数强平价') : price(result?.liquidation));
      } else {
        write(side+'-liquidation','—');
      }
      const risk = el(side+'-risk');
      risk.hidden = !(crypto && result?.crossed);
      risk.dataset.risk = risk.hidden ? 'normal' : 'liquidated';
      risk.textContent = risk.hidden ? '' : tr('已达模拟强平线');
    }
  }

  async function updateMark() {
    if (disposed || pending || Date.now() < nextFetch || document.hidden || navigator.onLine === false ||
      state.market !== 'perpetual' || state.status !== 'live' || Math.abs(Date.now()-state.asOf) >= QUOTE_FRESH ||
      !perpetualSources[state.symbol]?.includes(state.sourceId)) return;
    const {symbol,sourceId} = state;
    const request = new AbortController();
    pending = request;
    nextFetch = Date.now() + 5000;
    const timeout = setTimeout(() => request.abort(),6000);
    try {
      const result = await venueMark(symbol,sourceId,request.signal);
      if (result && !request.signal.aborted && state.market === 'perpetual' && state.symbol === symbol && state.sourceId === sourceId) mark = result;
    } catch { /* The synchronized last trade remains available while reconnecting. */ }
    finally {
      clearTimeout(timeout);
      if (pending === request) pending = null;
      if (!disposed) draw();
    }
  }
  function refresh() { draw(); void updateMark(); }
  for (const id of ['capital','entry','leverage','basis','lots']) {
    const control = el(id);
    control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => {
      if (id === 'basis' && control.value === 'custom' && !el('entry').value && POSITIVE(state.lastPrice)) {
        el('entry').value = num(state.lang,state.lastPrice,0,8);
      }
      persist();
      draw();
    });
  }
  el('capital').addEventListener('blur',()=>{
    const n=readPrincipal(el('capital').value,state.lang,capitalUnit(state));
    if(n) el('capital').value=num(state.lang,n,0,8);
  });
  function update(next) {
    if (disposed) return;
    const lang = next.lang || state.lang;
    if (lang !== state.lang) {
      for (const id of ['capital','entry','lots']) {
        const n = id==='capital' ? readPrincipal(el(id).value,state.lang,capitalUnit(state)) : readAmount(el(id).value,state.lang);
        if (n) el(id).value = num(lang,n,0,8);
      }
    }
    if (next.symbol !== state.symbol || next.market !== state.market || next.sourceId !== state.sourceId) {
      pending?.abort(); pending = null; mark = null; nextFetch = 0;
    }
    const nextGroup = settingsGroup(next);
    if (nextGroup !== group) restoreGroup(next,lang);
    if (next.market !== state.market || next.symbol !== state.symbol || actualContract(next) !== actualContract(state)) {
      basisKey = futures(next) ? (actualContract(next) ? groupStore + nextGroup + '/basis' : '') : storageKey + '/' + next.market + '/' + next.symbol;
      const record = saved(basisKey) ?? (next.market === 'perpetual' ? saved(legacyKey + '/' + next.symbol) : null);
      const v = POSITIVE(+record?.entry) ? +record.entry : null;
      el('entry').value = v ? num(lang,v,0,8) : '';
      el('basis').value = v && record?.basis === 'custom' ? 'custom' : 'extremes';
    }
    state = { ...next,lang };
    refresh();
  }
  const clockTimer = setInterval(() => { if (!document.hidden) refresh(); },2000);
  document.addEventListener('visibilitychange',refresh);
  draw();
  return {update,refresh,snapshot(side){
    if(side==='savings') return bank.snapshot();
    return shareValues[side] ? {...shareValues[side],...equivalents[side].snapshot()} : null;
  },destroy(){
    disposed = true; bank.destroy(); pending?.abort(); clearInterval(clockTimer); document.removeEventListener('visibilitychange',refresh);
  }};
}
