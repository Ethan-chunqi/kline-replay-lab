import {startFeed} from './feed.js';
import {createCycleTracker} from './cycle.js';
import {createChartView} from './chart.js';
import {getCryptoBars} from './crypto-intervals.js';
import {equityCatalog, startEquityFeed, loadEquityWindow} from './equities/feed.js';
import {createPositions} from './positions.js?v=two-lots';
import {futureCatalog,startIndexFutureFeed,loadFutureWindow} from './futures/feed.js';
import {t, languages, localeFor, dateTime, clockTime, ageText, applyI18n} from './i18n.js?v=direction-colors';
import {percent} from './metrics.js';

window.EQUITY_DATA_URL = 'https://raw.githubusercontent.com/Ethan-chunqi/kline-replay-lab/market-data/quotes/';
const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const HOUR = 3600000, DAY = 24 * HOUR;
const crypto = ['BTC','BNB','HYPE','SOL','ZEC'].map(base => ({
  symbol: base+'USDT', base, region:'crypto', type:'perpetual', currency:'USDT',
  timeZone:'Asia/Shanghai', digits:({SOL:3,HYPE:4})[base] || 2,
}));
const assets = new Map([...crypto,...equityCatalog,...futureCatalog].map(a => [a.symbol,a]));
const hot = {crypto:crypto.map(a=>a.symbol), us:['IXIC','DJI','QQQ','NVDA','SNDK'], cn:['IM','IC','IF','IH','SSE']};
const regionDefault = {crypto:'BTCUSDT',us:'IXIC',cn:'IM'};
const rangeChoices = {
  '15m':[[24,'24 小时'],[48,'48 小时'],[168,'7 天']],
  '30m':[[48,'48 小时'],[168,'7 天']], '1h':[[48,'48 小时'],[168,'7 天']],
  '1d':[[720,'1 个月'],[2160,'3 个月'],[8760,'1 年']],
};
const hours = {'15m':24,'30m':48,'1h':168,'1d':2160};
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key,value) { try { localStorage.setItem(key,value); } catch {} }
let lang = read('bulls-bears-language') || 'zh';
if (!Object.hasOwn(languages,lang)) lang = 'zh';
let theme = read('bulls-bears-theme') === 'light' ? 'light' : 'dark';
let asset, data, levels, hover, historyView, locating, chartError = '';
let bars = [], day = [], interval = '15m', subscription = 0, version = 0, pending = null, sparkFrame = 0;
let stopFeed, requestedBuild = false, building = false;
const translate = (key,params) => t(lang,key,params);
const clock = ms => clockTime(lang,ms,asset.timeZone);
const dt = (ms,opts={}) => dateTime(lang,ms,{timeZone:asset.timeZone,...opts});
const isCrypto = () => asset.region === 'crypto';
const isFuture = () => asset.type === 'future';
const unit = () => ['index','future'].includes(asset.type) ? translate('点') : asset.currency;
const kind = () => translate(({perpetual:'永续',index:'指数',stock:'股票',etf:'ETF',future:'股指期货'})[asset.type] || '股票');
const market = () => isCrypto() ? 'perpetual' : asset.region;
const activeInterval = () => historyView?.interval || interval;
const pointTime = p => dt(p.time,{dateOnly:(p.precisionMs || 0) >= DAY});
const write = (id,value) => { const el=$(id); if(el.textContent !== value) el.textContent=value; };
function num(value,digits=asset.digits || 2) {
  return Number.isFinite(value) ? value.toLocaleString(localeFor(lang),{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
}
function signedPercent(value) {
  if (!Number.isFinite(value)) return '—';
  const size = Math.abs(value);
  const digits = size > 0 && size < .01 ? Math.min(12,Math.ceil(-Math.log10(size))+1) : 2;
  return (value>0?'+':value<0?'−':'')+num(size,digits)+'%';
}
function assetName(a) {
  if (a.region === 'crypto') return a.base;
  const name=translate(a.nameZh);
  return lang==='zh' || name!==a.nameZh ? name : a.nameEn;
}
function blankState() {
  return {symbol:asset.symbol,source:'',sourceId:'',market:market(),status:'loading',candles:[],asOf:null,price:null};
}
function rebuildAssets() {
  const region=asset.region, group=$('instruments'), select=$('asset-select');
  for (const b of all('[data-region]')) b.setAttribute('aria-pressed',String(b.dataset.region===region));
  group.replaceChildren(); select.replaceChildren(); select.hidden=isCrypto();
  for (const sym of hot[region]) {
    const a=assets.get(sym), btn=document.createElement('button');
    btn.type='button';btn.className='contract';btn.dataset.symbol=sym;btn.setAttribute('aria-pressed', String(asset.symbol===sym));
    if (isCrypto()) { const icon=new Image();icon.src='./coins/'+a.base+'.png';icon.alt='';btn.append(icon); }
    const label=document.createElement('span');label.textContent=a.base || (a.type==='future'?sym:region==='cn' && lang==='zh' ? (a.nameZh.replace(/指数$/,'')) : sym);
    btn.append(label);btn.title=assetName(a);btn.addEventListener('click',()=>openAsset(sym));group.append(btn);
  }
  if (!isCrypto()) {
    for (const type of ['future','index','etf','stock']) {
      const items=[...futureCatalog,...equityCatalog].filter(a=>a.region===region && a.type===type);
      if (!items.length) continue;
      const options=document.createElement('optgroup');options.label=translate(({index:'基准指数',etf:'主要 ETF',stock:'股票',future:'股指期货'})[type]);
      for(const a of items) options.append(new Option(a.symbol+' · '+assetName(a),a.symbol));
      select.append(options);
    }
    select.value=asset.symbol;
  }
}
function renderAsset() {
  document.title=translate('pageTitle',{symbol:asset.symbol})+' · Bulls & Bears';
  const src=$('hero-coin');src.hidden=!isCrypto();
  if(isCrypto()) src.src='./coins/'+asset.base+'.png';
  const secondary=document.createElement('span');
  secondary.textContent=isCrypto()?'USDT':assetName(asset);
  $('asset-name').replaceChildren(document.createTextNode(isCrypto()?asset.base:isFuture()?(data.contract || asset.symbol):asset.symbol), secondary);
  $('asset-name').classList.toggle('equity-heading',!isCrypto());
  write('asset-kind',kind());write('quote-unit',unit());write('position-unit',asset.currency);
  write('change-name',translate(isCrypto()?'24 小时涨跌幅':'交易日涨跌幅'));
  write('day-high-label',translate(isCrypto()?'24 小时最高':'交易日最高'));
  write('day-low-label',translate(isCrypto()?'24 小时最低':'交易日最低'));
  write('trend-name',translate(isCrypto()?'24 小时价格走势':'交易日走势'));
  write('volume-unit',isCrypto()?asset.base:asset.type==='index'?'':translate('股'));
  write('trend-range',isCrypto()?asset.base+' / USDT':asset.symbol);
  write('zone-label',asset.timeZone);
}
function renderRange() {
  const selected=activeInterval();
  for(const btn of all('[data-interval]')) btn.setAttribute('aria-pressed',String(btn.dataset.interval===selected));
  const range=$('view-range');range.hidden=Boolean(historyView || locating);
  range.replaceChildren(...rangeChoices[selected].map(([h,key])=>new Option(translate(key),String(h))));
  range.value=String(hours[selected]);
}
function ohlc() {
  const candle=hover || bars.at(-1);
  for(const id of ['open','high','low','close']) write(id,candle ? num(candle[id]) : '—');
}
const chart=createChartView($('chart'),candle=>{hover=candle;ohlc();});
const positions=createPositions($('position-panel'),{t});
function drawPositions() {
  if (!asset || !data) return;
  positions.update({symbol:asset.symbol,market:market(),type:asset.type,currency:asset.currency,base:asset.base || asset.symbol,
    sourceId:data.sourceId,lastPrice:data.price,asOf:data.asOf,levels,status:data.status,lang,priceDigits:asset.digits||2,
    contract:data.contract || '',multiplier:data.multiplier ?? asset.multiplier,tick:data.tick ?? asset.tick,marginRate:data.marginRate ?? asset.marginRate,marginAsOf:data.marginAsOf,marginSourceUrl:data.marginSourceUrl});
}
function chartState() {
  return {interval:activeInterval(),market:market(),sourceId:data.sourceId,levels,theme,locale:lang,historical:Boolean(historyView),timeZone:asset.timeZone};
}
function drawChart() {
  const ctx=chartState();
  const barSource=ctx.interval==='1d'?data.dailySource:data.barSource;
  $('bar-source').hidden=!isFuture() || !barSource;
  write('bar-source',isFuture() && barSource ? (barSource==='新浪期货' && lang!=='zh'?'Sina Finance':translate(barSource)) : '');
  chart.update(bars,hours[ctx.interval],historyView?null:data.price,asset.symbol,ctx);
  $('chart-empty').hidden=bars.length>0 && !chartError;
  write('chart-empty',chartError || translate(data.status==='offline'?'chartOffline':'loadingChart'));
  ohlc();
}
function discardView() {
  version++;pending?.abort();pending=null;locating=null;historyView=null;chartError='';hover=null;bars=[];
  $('chart-context').hidden=true;
}
async function buildLatest() {
  if(building) { requestedBuild=true; return; }
  building=true;
  do {
    requestedBuild=false;
    if(!data?.candles.length || historyView || locating) break;
    const expected=version,source=data,current=interval;
    try {
      const result=isCrypto() ? (await getCryptoBars(source,current)).candles : source.candles;
      if(expected===version && source.sourceId===data.sourceId && !locating && !historyView) {
        bars=result;chartError='';drawChart();
      }
    } catch { if(expected===version) { bars=[];chartError=translate('没有可用的 K 线');drawChart(); } }
  } while(requestedBuild);
  building=false;
}
function renderLevels() {
  const ready=Boolean(levels?.high);
  write('cycle-status',(isFuture() && data.contract?data.contract+' · ':'')+translate(ready?(isCrypto()?'cycleFull':levels.low?'可用历史':'低点与高点的时间顺序待确认'):(levels?.status==='unavailable'?'cycleUnavailable':'cycleLoading')));
  $('cycle-status').title=ready && (data?.historyStart || levels?.historyStart) ? translate('历史起点')+' '+dt(data.historyStart || levels.historyStart,{dateOnly:true}) : '';
  for(const side of ['high','low']) {
    const p=levels?.[side],btn=document.querySelector('[data-locate="'+side+'"]'),at=$(side+'-at');
    btn.disabled=!p; const pct=side==='high'?'drawdown':'rebound';
    if(!p) { for(const id of [side+'-price',side+'-at',side+'-ago',pct]) write(id,'—');at.removeAttribute('datetime');continue; }
    write(side+'-price',num(p.price));write(side+'-at',pointTime(p));at.dateTime=new Date(p.time).toISOString();
    at.title=pointTime(p)+' · '+asset.timeZone;
    const asOf = data.status==='stale' ? data.asOf : Date.now();
    write(side+'-ago',ageText(lang,side,p.time,asOf));
    write(pct,data.price ? signedPercent(percent(data.price,p.price)) : '—');
  }
  drawPositions();
}
const cycle=createCycleTracker(result=>{
  if(!asset || !isCrypto() || result.symbol!==asset.symbol || result.sourceId!==data.sourceId) return;
  const before=levels;levels=result;renderLevels();
  if(!before || before.high?.time!==result.high?.time || before.low?.time!==result.low?.time ||
    before.high?.price!==result.high?.price || before.low?.price!==result.low?.price) drawChart();
});
function renderQuote() {
  const st=data.status,stock=!isCrypto();
  const statusLabel=({loading:'statusLoading',live:stock?'证券行情':'statusLive',stale:'statusStale',offline:'statusOffline',snapshot:'stockSnapshot',delayed:'延迟行情',closed:'已收盘'})[st] || 'stockSnapshot';
  $('connection').dataset.status=st;write('status-label',translate(stock && st==='snapshot' ? (data.sessionLabel || 'stockSnapshot') : statusLabel));
  const notice=$('feed-notice');notice.hidden=true;
  if(st==='offline' || st==='stale') {
    notice.hidden=false;
    notice.textContent=st==='offline'?translate('noticeOffline'):translate('noticeStale',{source:translate(data.source),time:dt(data.asOf,{seconds:true})});
  }
  if(isFuture() && data.contract) {
    $('asset-name').firstChild.textContent=data.contract;
    write('trend-range',data.contract);
  }
  const evidence=$('evidence');
  evidence.hidden=!isFuture() || !/^(IM|IC|IF|IH)\d{4}$/.test(data.contract || '');
  if(!evidence.hidden) evidence.href='https://quote.eastmoney.com/qihuo/'+data.contract+'.html';
  if(stock && data.volumeUnit) write('volume-unit',data.volumeUnit === '成交量' ? '' : translate(data.volumeUnit));
  write('price',num(data.price));day=isCrypto()?data.candles.slice(-96):(data.sessionCandles || []);
  const first=day[0],basis=isCrypto()?first?.open:isFuture()?(data.prevSettlement ?? data.prevClose):data.prevClose;
  const delta=basis && data.price ? percent(data.price,basis) : NaN;
  write('change24',signedPercent(delta));$('change24').dataset.tone=delta>0?'positive':delta<0?'negative':'neutral';
  $('change24').title=translate(isCrypto()?'changePeriodTip':isFuture()?'前结算价':'前收盘价')+(stock && basis?' '+num(basis):'');
  const high=data.dayHigh || (day.length?Math.max(...day.map(b=>b.high)):null);
  const low=data.dayLow || (day.length?Math.min(...day.map(b=>b.low)):null);
  write('day-high',num(high));write('day-low',num(low));
  write('trend-start',first?clock(first.time):'—');write('trend-end',data.asOf?clock(data.asOf):'—');
  write('foot-source',data.source ? (isCrypto()?translate('sourceFutures',{source:data.source}):translate(data.source)+' · '+translate(isFuture()?'期货行情':'stockSnapshot')) : translate('waitingSource'));
  write('updated',data.asOf?translate('updated',{time:dt(data.asOf,{seconds:isCrypto()})}):translate('waitingQuote'));
  if(stock && data.asOf) $('updated').title=translate('证券报价有延迟，时间以行情源为准。');
  else $('updated').removeAttribute('title');
  scheduleSpark();
}
function accept(next) {
  if(next.symbol!==asset.symbol) return;
  if(data.sourceId && next.sourceId && next.sourceId!==data.sourceId) {discardView();levels=null;}
  data=next;
  if(isCrypto() && data.candles.length) cycle.update(data);
  if(!isCrypto()) levels=data.high?{high:data.high,low:data.low,symbol:asset.symbol,sourceId:data.sourceId,status:'ready',historyStart:data.historyStart}:null;
  renderQuote();renderLevels();
  if(!data.candles.length) {drawChart();return;}
  void buildLatest();
}
function subscribe() {
  stopFeed?.();const id=++subscription;
  const change=next=>{if(id===subscription) accept(next);};
  if(isCrypto()) stopFeed=startFeed(change,asset.symbol);
  else if(isFuture()) stopFeed=startIndexFutureFeed(change,asset.symbol,interval);
  else stopFeed=startEquityFeed(change,asset.symbol,interval);
}
async function locate(kind) {
  const p=levels?.[kind];if(!p) return;
  pending?.abort();const ctl=new AbortController();pending=ctl;
  const id=++version;locating=kind;chartError='';hover=null;
  $('chart-context').hidden=false;write('context-label',translate('loadingChart'));
  try {
    let result;
    if(isCrypto()) result=await getCryptoBars(data,interval,{point:p,kind,signal:ctl.signal});
    else if(isFuture()) {
      const precision=p.precisionMs || DAY;
      const desired=precision>=DAY?'1d':interval;
      let chosen=desired;
      let candles=await loadFutureWindow(asset.symbol,chosen,p.time,ctl.signal);
      if(!candles?.length && chosen!=='1d') {chosen='1d';candles=await loadFutureWindow(asset.symbol,chosen,p.time,ctl.signal);}
      result={interval:chosen,candles};
    } else result={interval:'1d',candles:await loadEquityWindow(asset.symbol,'1d',p.time,ctl.signal)};
    if(id!==version || ctl.signal.aborted) return;
    historyView={kind,interval:result.interval,point:p};
    bars=result.candles;locating=null;renderRange();drawChart();
    if(!chart.locate(kind)) throw Error('unmatched');
    write('context-label',translate(kind==='high'?'历史高点':'峰后低点')+' · '+pointTime(p)+' · '+translate(({'15m':'15 分钟','30m':'30 分钟','1h':'1 小时','1d':'日线'})[result.interval]));
  } catch {
    if(id!==version || ctl.signal.aborted) return;
    locating=null;historyView=null;write('context-label',translate('无法定位该根 K 线'));renderRange();void buildLatest();
  } finally { if(pending===ctl)pending=null; }
}
function applyAppearance() {
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]').content=theme==='light'?'#f5f6f7':'#101217';
  $('theme').firstElementChild.textContent=theme==='dark'?'☀':'☾';
  $('theme').title=translate(theme==='dark'?'浅色':'深色');$('theme').setAttribute('aria-label',$('theme').title);
  $('theme').setAttribute('aria-pressed',String(theme==='light'));
}
function applyLanguage() {
  $('language').value=lang;applyI18n(lang);applyAppearance();rebuildAssets();renderAsset();renderRange();
  renderQuote();renderLevels();drawChart();
  if(historyView) write('context-label',translate(historyView.kind==='high'?'历史高点':'峰后低点')+' · '+pointTime(historyView.point));
}
function openAsset(symbol,changeUrl=true) {
  if(!assets.has(symbol)) return;
  stopFeed?.();stopFeed=null;++subscription;discardView();asset=assets.get(symbol);data=blankState();levels=null;cycle.update(data);
  save('bulls-bears-asset',symbol);save('bulls-bears-last-'+asset.region,symbol);
  if(changeUrl) {const url=new URL(location.href);url.searchParams.set('symbol',symbol);history.replaceState(null,'',url);}
  applyLanguage();subscribe();
}
function switchInterval(value) {
  if(!Object.hasOwn(rangeChoices,value)) return;
  const previous=interval;discardView();interval=value;renderRange();drawChart();
  if(!isCrypto() && value!==previous) subscribe();else void buildLatest();
}
for(const btn of all('[data-region]'))btn.addEventListener('click',()=>{
  const region=btn.dataset.region;
  if(region===asset.region) return;
  const last=read('bulls-bears-last-'+region);
  openAsset(assets.get(last)?.region===region?last:regionDefault[region]);
});
for(const b of all('[data-interval]')) b.addEventListener('click',()=>switchInterval(b.dataset.interval));
for(const b of all('[data-locate]')) b.addEventListener('click',()=>locate(b.dataset.locate));
$('asset-select').addEventListener('change',e=>openAsset(e.target.value));
$('view-range').addEventListener('change',e=>{hours[activeInterval()]=Number(e.target.value);drawChart();chart.reset();});
$('back-latest').addEventListener('click',()=>switchInterval(interval));
$('reset').addEventListener('click',()=>{if(historyView || locating) switchInterval(interval);else chart.reset();});
const directionColorKey='bulls-bears-direction-colors';
function setDirectionColors(reversed) {
  $('calculator').dataset.directionColors=reversed?'reversed':'default';
  $('direction-toggle').setAttribute('aria-pressed',String(reversed));
}
setDirectionColors(read(directionColorKey)==='reversed');
$('direction-toggle').addEventListener('click',()=>{
  const reversed=$('calculator').dataset.directionColors!=='reversed';
  setDirectionColors(reversed);
  save(directionColorKey,$('calculator').dataset.directionColors);
});
$('theme').addEventListener('click',()=>{theme=theme==='light'?'dark':'light';save('bulls-bears-theme',theme);applyAppearance();drawChart();scheduleSpark();});
$('language').addEventListener('change',e=>{lang=e.target.value;save('bulls-bears-language',lang);applyLanguage();});
for(const a of document.querySelectorAll('nav a,.brand'))a.addEventListener('click',()=>{
  const calc=a.hash==='#calculator';$('nav-market').classList.toggle('active',!calc);$('nav-calc').classList.toggle('active',calc);
});

function plotSpark() {
  sparkFrame = 0;
  const canvas = $('spark');
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const width = rect.width, height = rect.height;
  ctx.clearRect(0,0,width,height);
  if (!day.length) return;
  const values = [day[0].open, ...day.map(b => b.close)];
  const min = Math.min(...values), max = Math.max(...values);
  const spread = max - min || 1;
  const point = (v,i) => [3 + (width-10)*i/(values.length-1), max === min ? height/2 : 7 + (height-14)*(max-v)/spread];
  const points = values.map(point);
  ctx.lineWidth = 1;
  ctx.setLineDash([3,4]); ctx.strokeStyle = '#70798744';
  for (const fraction of [.2,.5,.8]) {
    ctx.beginPath();ctx.moveTo(0,height*fraction);ctx.lineTo(width,height*fraction);ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.beginPath();points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  ctx.strokeStyle = theme==='light'?'#9a6800':'#f5c842';ctx.lineJoin = 'round';ctx.lineWidth = 2;ctx.stroke();
  const last = points.at(-1);
  ctx.lineTo(last[0],height);ctx.lineTo(points[0][0],height);ctx.closePath();
  const gradient = ctx.createLinearGradient(0,3,0,height);
  gradient.addColorStop(0,'#efba294a');gradient.addColorStop(1,'#efba2901');
  ctx.fillStyle=gradient;ctx.fill();
  ctx.beginPath();ctx.arc(...last,5,0,2*Math.PI);ctx.fillStyle='#f4c73742';ctx.fill();
  ctx.beginPath();ctx.arc(...last,2.6,0,2*Math.PI);ctx.fillStyle='#ffe190';ctx.fill();
}
function scheduleSpark() {
  if (!sparkFrame) sparkFrame = requestAnimationFrame(plotSpark);
}

new ResizeObserver(scheduleSpark).observe($('spark'));
const urlSymbol=new URLSearchParams(location.search).get('symbol');
const initial=[urlSymbol,read('bulls-bears-asset'),'BTCUSDT'].find(s=>assets.has(s));
openAsset(initial,false);
