import {equityLogos} from './equities/logos.js?v=20261122-market-v3';
import {reveal,quoteTick} from './motion.js?v=20261122-market-v3';
import {createPaperTrading} from './paper-trading.js?v=20261122-share';
import {startFeed} from './feed.js?v=20261122-market-v3';
import {createCycleTracker} from './cycle.js?v=20261122-share';
import {createChartView,findLevelIndex} from './chart.js?v=20261122-editorial';
import {movesForInterval} from './chart-moves.js?v=20261122-editorial';
import {createShareDialog} from './share-dialog.js?v=20261122-editorial-2';
import {createRocketDialog} from './rocket-dialog.js?v=20261122-editorial';
import {positionShareBars} from './share-bars.js?v=20261122-trails';
import {createMoveVolumes,describeMoves,marketTime} from './move-context.js?v=20261122-share';
import {getCryptoBars,loadCryptoYear,shareCycleBars,currentCryptoDay} from './crypto-intervals.js?v=20261122-share';
import {loadFutureYear} from './futures/year.js?v=20261122-market-v3';
import {equityCatalog, startEquityFeed, loadEquityWindow, loadAiCaps} from './equities/feed.js?v=20261122-trails';
import {createPositions} from './positions.js?v=20261122-editorial-2';
import {futureCatalog,startIndexFutureFeed,loadFutureWindow} from './futures/feed.js?v=20261122-trails';
import {t, languages, localeFor, dateTime, clockTime, ageText, applyI18n} from './i18n.js?v=20261122-editorial';
import {percent} from './metrics.js?v=20261122-market-v3';

window.EQUITY_DATA_URL = 'https://raw.githubusercontent.com/Ethan-chunqi/kline-replay-lab/market-data/quotes/';
const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const HOUR = 3600000, DAY = 24 * HOUR;
const crypto = ['BTC','BNB','HYPE','SOL','ZEC','OKB','BGB'].map(base => ({
  symbol: base+'USDT', base, region:'crypto', type:'perpetual', currency:'USDT',
  timeZone:'Asia/Shanghai', digits:({SOL:3,HYPE:4,BGB:4})[base] || 2,
}));
const assets = new Map([...crypto,...equityCatalog,...futureCatalog].map(a => [a.symbol,a]));
const hot = {crypto:crypto.map(a=>a.symbol), us:['IXIC','DJI','QQQ','NVDA','SNDK'], cn:['IM','IC','IF','IH','SSE'],kr:['KOSPI','KOSDAQ','069500','005930','000660']};
const regionDefault = {crypto:'BTCUSDT',us:'IXIC',cn:'IM',kr:'KOSPI'};
const rangeChoices = {
  '1m':[[1,'近 1 小时'],[3,'近 3 小时']],
  '15m':[[24,'24 小时'],[48,'48 小时'],[168,'7 天']],
  '30m':[[48,'48 小时'],[168,'7 天']], '1h':[[48,'48 小时'],[168,'7 天']],
  '1d':[[720,'1 个月'],[2160,'3 个月']],
};
const hours = {'1m':1,'15m':24,'30m':48,'1h':168,'1d':2160};
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key,value) { try { localStorage.setItem(key,value); } catch {} }
let lang = read('bulls-bears-language') || 'zh';
if (!Object.hasOwn(languages,lang)) lang = 'zh';
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
const savedTheme=read('bulls-bears-theme');
let themeMode=['light','dark'].includes(savedTheme)?savedTheme:'system';
const resolvedTheme=()=>themeMode==='system'?(systemTheme.matches?'dark':'light'):themeMode;
let theme=resolvedTheme();
let asset, data, levels, hover, historyView, locating, chartError = '';
let bars = [], day = [], interval = '15m', subscription = 0, version = 0, pending = null, sparkFrame = 0;
let stopFeed, requestedBuild = false, building = false;
let selectedMinuteDate=null;
let yearMode=false, yearView=null, yearRequest=null, yearRefresh=0, yearError=false;
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
const capRows = new Map();
const capsChecked=new Map();
function capAmount(value) {
  return new Intl.NumberFormat(localeFor(lang),{style:'currency',currency:asset.currency,currencyDisplay:'narrowSymbol',notation:'compact',maximumFractionDigits:2}).format(value);
}
function capLine() {
  const el=$('stock-details');
  el.hidden=!['cn-ai','kr-ai'].includes(asset.group);
  if (el.hidden) return;
  const cap=capRows.get(asset.symbol);
  const notes=cap ? [translate('marketCap'),capAmount(cap.marketCap),dt(cap.marketCapAsOf,{dateOnly:true})] : [];
  if (asset.symbol==='605117') notes.push(translate('deyeSector'));
  el.textContent=notes.join(' · ');
}
function acceptCaps(rows) {
  let changed=false;
  for (const row of rows) {
    const old=capRows.get(row.symbol);
    if (!old || old.marketCapAsOf<row.marketCapAsOf) {capRows.set(row.symbol,{marketCap:row.marketCap,marketCapAsOf:row.marketCapAsOf});changed=true;}
  }
  if (changed && ['cn','kr'].includes(asset.region)) {rebuildAssets();capLine();}
}
function refreshCaps() {
  const region=asset.region;
  if (!['cn','kr'].includes(region) || Date.now()-(capsChecked.get(region)||0)<60000) return;
  capsChecked.set(region,Date.now());
  void loadAiCaps(acceptCaps,region);
}
function rebuildAssets() {
  const region=asset.region, group=$('instruments'), select=$('asset-select');
  for (const b of all('[data-region]')) b.setAttribute('aria-pressed',String(b.dataset.region===region));
  group.replaceChildren(); select.replaceChildren(); select.hidden=isCrypto();
  for (const sym of hot[region]) {
    const a=assets.get(sym), btn=document.createElement('button');
    btn.type='button';btn.className='contract';btn.dataset.symbol=sym;btn.setAttribute('aria-pressed', String(asset.symbol===sym));
    const logo=isCrypto()?'./coins/'+a.base+'.png':equityLogos[a.symbol];
    if (logo) {const icon=new Image();icon.src=logo;icon.alt='';btn.append(icon);}
    const label=document.createElement('span');label.textContent=a.base || (a.type==='future'?sym:['cn','kr'].includes(region) && lang==='zh' ? (a.nameZh.replace(/指数$/,'')) : sym);
    btn.append(label);btn.title=assetName(a);btn.addEventListener('click',()=>openAsset(sym));group.append(btn);
  }
  if (!isCrypto()) {
    for (const type of ['future','index','etf','stock']) {
      const items=[...futureCatalog,...equityCatalog].filter(a=>a.region===region && a.type===type && !a.group);
      if (!items.length) continue;
      const options=document.createElement('optgroup');options.label=translate(({index:'基准指数',etf:'主要 ETF',stock:'股票',future:'股指期货'})[type]);
      for(const a of items) options.append(new Option(a.symbol+' · '+assetName(a),a.symbol));
      select.append(options);
    }
    if(region==='cn'||region==='kr') {
      const list=equityCatalog.filter(a=>a.group===region+'-ai').sort((a,b)=>(capRows.get(b.symbol)?.marketCap||0)-(capRows.get(a.symbol)?.marketCap||0));
      const group=document.createElement('optgroup');
      const timestamps=list.map(a=>capRows.get(a.symbol)?.marketCapAsOf).filter(Number.isFinite);
      const first=timestamps.length===list.length?dt(Math.min(...timestamps),{dateOnly:true}):'';
      const last=first?dt(Math.max(...timestamps),{dateOnly:true}):'';
      group.label=translate(region==='kr'?'krAiGroup':'cnAiGroup')+(first?' · '+first+(first!==last?' – '+last:''):'');
      for(const a of list) {
        const row=capRows.get(a.symbol);
        group.append(new Option(a.symbol+' · '+assetName(a)+(row?' · '+capAmount(row.marketCap):''),a.symbol));
      }
      select.append(group);
      refreshCaps();
    }
    select.value=asset.symbol;
  }
}
function renderAsset() {
  const head=document.querySelector('.hero');
  head.dataset.marketRegion=asset.region;
  if (asset.region==='us' || asset.region==='cn') head.setAttribute('aria-description',translate(asset.region==='us'?'artUsCredit':'artCnCredit'));
  else head.removeAttribute('aria-description');
  document.title=translate('pageTitle',{symbol:asset.symbol})+' · Bulls & Bears';
  const src=$('hero-coin'),logo=isCrypto()?'./coins/'+asset.base+'.png':equityLogos[asset.symbol];
  src.hidden=!logo;
  if(logo)src.src=logo;else src.removeAttribute('src');
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
  write('zone-label',asset.timeZone);capLine();
}
function renderRange() {
  const selected=activeInterval();
  $('move-high-summary').hidden=selected!=='1d';
  for(const btn of all('[data-interval]')) btn.setAttribute('aria-pressed',String(btn.dataset.interval===selected));
  $('year-range').setAttribute('aria-pressed',String(yearMode));
  $('cycle-overview').setAttribute('aria-pressed',String(historyView?.kind==='cycle'));
  const range=$('view-range');range.hidden=Boolean(historyView || locating || yearMode);
  range.replaceChildren(...rangeChoices[selected].map(([h,key])=>new Option(translate(key),String(h))));
  range.value=String(hours[selected]);
}
function ohlc() {
  const candle=hover || bars.at(-1);
  for(const id of ['open','high','low','close']) write(id,candle ? num(candle[id]) : '—');
}
const chart=createChartView($('chart'),candle=>{hover=candle;ohlc();});
const paperTrading=createPaperTrading($('paper-trading'),{t,localeFor,dateTime});
const shareDialog=createShareDialog({getModel:makeShareModel});
const rocketDialog=createRocketDialog({getModel:signal=>makeShareModel('long',{chartOnly:true,signal})});
$('rocket-video').addEventListener('click',()=>rocketDialog.open());
const positions=createPositions($('position-panel'),{t,onShare:side=>shareDialog.open(side)});
let volumeRecords={}, currentMoves=[];
const volumeTracker=createMoveVolumes(()=>{if(asset && data){renderLevels();drawChart();}});
function describeSource() {
  return {levels,price:data.price,records:volumeRecords,asOf:data.asOf,lang,timeZone:asset.timeZone,base:isCrypto()?asset.base:''};
}
function renderMoves() {
  volumeRecords=volumeTracker.update(data,isCrypto()?levels:null);
  currentMoves=describeMoves(describeSource(),t).map(move=>({...move,durationText:ageText(lang,move.kind,move.time,data.asOf)}));
  for(const kind of ['low','high']) {
    const move=currentMoves.find(m=>m.kind===kind);
    write('move-'+kind+'-percent',move?.percentText||'—');
    write('move-'+kind+'-volume',move?.volumeText||'—');
    write('move-'+kind+'-until',[move?.volumeBasis,move?.untilText].filter(Boolean).join(' · '));
  }
  $('cycle-overview').hidden=!isCrypto();
  $('cycle-overview').disabled=!currentMoves.length;
  $('rocket-video').disabled=!levels?.low || !data?.price;
  document.querySelectorAll('.move-volume-line').forEach(node=>{node.hidden=!isCrypto();});
}

async function makeShareModel(side,{chartOnly=false,signal}={}) {
  const position=chartOnly?{}:positions.snapshot(side);
  if(!position || !levels?.low || !data?.price || !data?.asOf) return null;
  // Freeze values before awaiting candles or volume. The market can switch while the PNG renders.
  const source={...data}, info={...describeSource(),records:{...volumeRecords}};
  const timezone=asset.timeZone, cryptoMarket=isCrypto(), selected=activeInterval();
  const language=lang, themeNow=theme;
  const marked=position.entryKind==='low'&&asset.symbol==='SOLUSDT'?translate('solLowLabel'):position.entryBasisText;
  const labels={ '1m':'1 分钟','15m':'15 分钟','30m':'30 分钟','1h':'1 小时','1d':'日线'};
  const title=cryptoMarket?asset.symbol:isFuture()?(data.contract||asset.symbol):assetName(asset)+' · '+asset.symbol;
  const color=chartOnly?'':getComputedStyle(document.querySelector('[data-share-side="'+side+'"]').closest('article')).getPropertyValue('--side-accent').trim();
  const barContext={...chartState(),symbol:asset.symbol};
  const series=positionShareBars({side,source,asset,selected,levels:info.levels,
    chartBars:chart.shareBars(),chartSourceId:barContext.sourceId,cryptoMarket,future:isFuture()});
  const asOfText=marketTime({time:source.asOf,precisionMs:1000},lang,timezone,t);
  const model={...position,lang:language,theme:themeNow,side,symbol:title,market:[data.source,kind()].filter(Boolean).join(' · '),
    currentPrice:data.price,currentTime:source.asOf,chartAsOf:source.asOf,timeZone:timezone,
    asOfText,priceDigits:asset.digits||2,priceText:num(data.price)+' '+unit(),sideColor:color,
    entryBasisText:marked,lowPriceText:num(levels.low.price)+' '+unit()};
  const captured=Object.fromEntries(Object.entries(info.records).map(([key,record])=>[key,{result:record.result}]));
  const waiting=Object.entries(info.records).filter(([,record])=>record.promise).map(([key,record])=>
    record.promise.then(()=>{
      const previous=captured[key].result;
      if((!previous || previous.to>source.asOf || source.asOf-previous.to>900000) && record.result?.to<=source.asOf) captured[key].result=record.result;
    }));
  let timeout;
  const ready=waiting.length?Promise.race([Promise.allSettled(waiting),new Promise(resolve=>{timeout=setTimeout(resolve,12000);})]):Promise.resolve();
  const moves=ready.then(()=>describeMoves({...info,records:captured},t,false));
  const [seriesData,shareMoves]=await Promise.all([series,moves]).finally(()=>clearTimeout(timeout));
  signal?.throwIfAborted();
  const {bars:chosen,frame,sourceId,breakAfter,barLevels}=seriesData;
  if(!chosen.length)return null;
  model.interval=t(language,labels[frame]);model.bars=chosen.map(b=>({...b}));model.breakAfter=breakAfter;
  barContext.interval=frame;
  barContext.sourceId=sourceId;
  if(barLevels)barContext.levels=barLevels;
  model.extremeTimes={};
  for(const kind of ['high','low']){
    const index=findLevelIndex(chosen,barContext,kind);
    if(index>=0)model.extremeTimes[kind]=chosen[index].time;
  }
  model.moves=movesForInterval(shareMoves,frame);
  const low=shareMoves.find(m=>m.kind==='low');
  model.lowTimeText=low?.timeText||marketTime(info.levels.low,language,timezone,t);
  const entry=shareMoves.find(m=>m.kind===position.entryKind);
  model.entryTimeText=entry?.timeText||(position.entryAt?marketTime({time:position.entryAt,precisionMs:1000},language,'Asia/Shanghai',t):'');
  return model;
}

function drawPositions() {
  if (!asset || !data) return;
  positions.update({symbol:asset.symbol,market:market(),type:asset.type,currency:asset.currency,base:asset.base || asset.symbol,
    sourceId:data.sourceId,lastPrice:data.price,asOf:data.asOf,levels,status:data.status,lang,priceDigits:asset.digits||2,
    contract:data.contract || '',multiplier:data.multiplier ?? asset.multiplier,tick:data.tick ?? asset.tick,marginRate:data.marginRate ?? asset.marginRate,marginAsOf:data.marginAsOf,marginSourceUrl:data.marginSourceUrl});
}
function chartState() {
  return {interval:activeInterval(),market:market(),sourceId:yearMode ? yearView?.sourceId : (activeInterval()!=='1d' && data.intradaySourceId) || data.sourceId,
    levels,asOf:data.asOf,theme,locale:lang,historical:Boolean(historyView && historyView.kind!=='cycle' || yearMode),yearRange:yearMode || historyView?.kind==='cycle',timeZone:asset.timeZone,
    currentPrice:data.price,currentTime:data.asOf,moves:currentMoves,base:isCrypto()?asset.base:''};
}
function drawChart() {
  const ctx=chartState();
  const barSource=ctx.interval==='1d'?data.dailySource:data.barSource;
  $('bar-source').hidden=yearMode || (asset.group!=='cn-ai' && (!isFuture() || !barSource));
  write('bar-source',asset.group==='cn-ai' ? translate(ctx.interval==='1d'?'stockAdjusted':'stockUnadjusted') : isFuture() && barSource ? (barSource==='新浪期货' && lang!=='zh'?'Sina Finance':translate(barSource)) : '');
  if(ctx.interval==='1m' && !yearMode && bars.length) {
    $('bar-source').hidden=false;
    write('bar-source',[isCrypto()?data.source:translate(barSource || data.source),dt(bars[0].time),dt(bars.at(-1).time)].filter(Boolean).join(' · '));
  }
  chart.update(bars,hours[ctx.interval],ctx.historical?null:data.price,asset.symbol,ctx);
  $('chart-empty').hidden=bars.length>0 && !chartError;
  write('chart-empty',yearMode ? translate(yearError?'yearUnavailable':'loadingYear') :
    chartError || translate(data.status==='offline'?'chartOffline':'loadingChart'));
  renderYearInfo();
  ohlc();
}
function discardView(keepYear=false) {
  yearRequest?.abort();yearRequest=null;yearView=null;yearRefresh=0;yearError=false;yearMode=keepYear;
  $('year-date').value='';selectedMinuteDate=null;
  version++;pending?.abort();pending=null;locating=null;historyView=null;chartError='';hover=null;bars=[];
  $('chart-context').hidden=true;
}
function exchangeDate(time) {
  const zone=isCrypto()?'UTC':asset.timeZone;
  return new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
}
function renderYearInfo() {
  const box=$('year-context');
  box.hidden=!yearMode;
  if(!yearMode)return;
  const pack=yearView,first=bars[0],last=bars.at(-1);
  const cryptoMinute=isCrypto() && interval==='1m';
  $('year-jump').hidden=!first && !cryptoMinute;
  if(cryptoMinute && data.asOf){
    const date=$('year-date');date.min='2026-01-01';date.max=exchangeDate(data.asOf);
    date.value=selectedMinuteDate || date.max;
  }
  $('year-daily').hidden=interval==='1d' || (!yearError && pack?.coverage!=='partial' && !cryptoMinute);
  $('year-retry').hidden=!yearError && pack?.coverage!=='partial';
  if(!first || !pack) {write('year-note',translate(yearError?(cryptoMinute?'minuteDayFailed':'yearUnavailable'):'loadingYear'));return;}
  const from=exchangeDate(first.time),to=exchangeDate(last.time),date=$('year-date');
  date.min=pack.dateRange?.first || from;date.max=pack.dateRange?.last || to;
  if(pack.dateRange)date.value=pack.dateRange.selected;
  else if(!date.value || date.value<from || date.value>to)date.value=from;
  box.dataset.first=from;box.dataset.last=to;box.dataset.coverage=pack.coverage;
  const note=[];
  if(pack.dateRange)note.push(translate('minuteByDay')+' · '+date.min+' – '+date.max);
  if(isFuture() && pack.listingDate)note.push(translate('contractListed',{contract:pack.contract,date:pack.listingDate}));
  if(pack.coverage==='partial')note.push(translate(pack.reason==='archiveEnd'?'yearGap':'yearLimited'));
  note.push(from+' – '+to,translate('barCount',{count:bars.length.toLocaleString(localeFor(lang))}));
  if(pack.source)note.push(translate(pack.source));
  write('year-note',note.join(' · '));
}
async function buildYear() {
  if(!yearMode || yearRequest || historyView || locating || !data.sourceId || !data.candles?.length || Date.now()<yearRefresh) return;
  if(!isCrypto() && data.interval!==interval)return;
  const ctl=new AbortController(), expected=version, source=data, frame=interval;
  yearRequest=ctl;
  try {
    let pack;
    if(isCrypto())pack=await loadCryptoYear(source,frame,ctl.signal,selectedMinuteDate);
    else if(isFuture())pack=await loadFutureYear(source,frame,ctl.signal);
    else {
      const {loadEquityYear}=await import('./equities/year.js?v=20261122-market-v3');
      pack=await loadEquityYear(source,frame,ctl.signal);
    }
    if(expected!==version || ctl.signal.aborted || !yearMode)return;
    if(!pack?.candles?.length || (pack.symbol && pack.symbol!==asset.symbol))throw Error('Invalid historical candles');
    yearView={...pack,sourceId:pack.sourceId || source.sourceId};
    bars=pack.candles;yearError=false;chartError='';
    yearRefresh=Date.now()+(isCrypto()&&pack.coverage==='full'?8000:60000);
    drawChart();
  } catch {
    if(expected!==version || ctl.signal.aborted)return;
    yearError=true;yearRefresh=Date.now()+15000;
    if(!yearView)bars=[];
    drawChart();
  } finally {if(yearRequest===ctl)yearRequest=null;}
}
async function buildLatest() {
  if(yearMode){await buildYear();return;}
  if(building) { requestedBuild=true; return; }
  building=true;
  do {
    requestedBuild=false;
    if(!data?.candles.length || historyView || locating) break;
    const expected=version,source=data,current=interval;
    try {
      const result=isCrypto() ? (await getCryptoBars(source,current)).candles : source.candles;
      if(expected===version && source.sourceId===data.sourceId && !locating && !historyView) {
        const floor=Date.parse(isCrypto()?'2026-01-01T00:00:00Z':asset.region==='kr'?'2026-01-01T00:00:00+09:00':asset.region==='us'?'2026-01-01T00:00:00-05:00':'2026-01-01T00:00:00+08:00');
        bars=result.filter(b=>b.time>=floor);chartError='';drawChart();
      }
    } catch { if(expected===version) { bars=[];chartError=translate('没有可用的 K 线');drawChart(); } }
  } while(requestedBuild);
  building=false;
}
function levelLabel(kind) {
  if (kind==='high') return '历史高点';
  return asset.symbol==='SOLUSDT' ? 'solLowLabel' : '峰后低点';
}
function renderLevels() {
  renderMoves();
  const ready=Boolean(levels?.high);
  const fixed=asset.symbol==='SOLUSDT';
  const lowLabel=document.querySelector('.low-box .level span');
  lowLabel.textContent=translate(fixed?'solLowSince':'见顶后最低价');
  document.querySelector('.low-box h4').textContent=translate(fixed?'solRebound':'周期低点反弹');
  const cycleText=(isFuture() && data.contract?data.contract+' · ':'')+translate(ready?(isCrypto()?(fixed?'solLowStartZone':'cycleFull'):levels.low?'可用历史':'低点与高点的时间顺序待确认'):(levels?.status==='unavailable'?'cycleUnavailable':'cycleLoading'));
  const cycleTitle=fixed ? translate('solCycleTip') : ready && (data?.historyStart || levels?.historyStart) ? translate('历史起点')+' '+dt(data.historyStart || levels.historyStart,{dateOnly:true}) : '';
  for(const side of ['high','low']) {
    write(side+'-cycle-status',cycleText);
    $(side+'-cycle-status').title=cycleTitle;
    const p=levels?.[side],btn=document.querySelector('[data-locate="'+side+'"]'),at=$(side+'-at');
    btn.disabled=!p; const pct=side==='high'?'drawdown':'rebound';
    if(!p) { for(const id of [side+'-price',side+'-at',side+'-ago',pct]) write(id,'—');at.removeAttribute('datetime');continue; }
    const move=currentMoves.find(m=>m.kind===side);
    write(side+'-price',num(p.price));write(side+'-at',move?.timeText||marketTime(p,lang,asset.timeZone,t));at.dateTime=new Date(move?.time??p.time).toISOString();
    at.title=at.textContent;
    const asOf = data.status==='stale' ? data.asOf : Date.now();
    write(side+'-ago',ageText(lang,side,p.time,asOf));
    write(pct,data.price ? signedPercent(percent(data.price,p.price)) : '—');
  }
  drawPositions();
}
const cycle=createCycleTracker(result=>{
  if(!asset || !isCrypto() || result.symbol!==asset.symbol || result.sourceId!==data.sourceId) return;
  const before=levels;levels=result;renderLevels();
  if(asset.symbol==='SOLUSDT' && historyView?.kind==='low' && result.low && !locating &&
      (historyView.point.time!==result.low.time || historyView.point.price!==result.low.price)) void locate('low');
  if(!before || before.high?.time!==result.high?.time || before.low?.time!==result.low?.time ||
    before.high?.price!==result.high?.price || before.low?.price!==result.low?.price) drawChart();
});
let previousPrice=null,previousFeed='';
function renderQuote() {
  paperTrading.update(asset,data,lang);
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
  const priceText=num(data.price),feedKey=asset.symbol+'/'+data.sourceId;
  if(feedKey===previousFeed && Number.isFinite(previousPrice) && Number.isFinite(data.price) &&
     priceText!==$('price').textContent && data.price!==previousPrice && ['live','delayed'].includes(st)) {
    quoteTick($('price'),data.price>previousPrice);
  }
  previousFeed=feedKey;previousPrice=data.price;
  write('price',priceText);day=isCrypto()?data.candles.slice(-96):(data.sessionCandles || []);
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
  if(data.sourceId && next.sourceId && next.sourceId!==data.sourceId) {discardView(yearMode);levels=null;}
  data=next;
  if(asset.group==='cn-ai' && data.marketCap>0 && data.marketCapAsOf) acceptCaps([data]);
  if(asset.region==='cn') refreshCaps();
  if(isCrypto() && data.candles.length) cycle.update(data);
  if(!isCrypto()) levels=data.high?{high:data.high,low:data.low,symbol:asset.symbol,sourceId:data.sourceId,status:'ready',historyStart:data.historyStart}:null;
  renderQuote();renderLevels();
  if(historyView?.kind==='cycle') {
    const today=currentCryptoDay(data);
    const last=bars.at(-1);
    if(today && last && today.time===last.time) bars[bars.length-1]=today;
    else if(today && last && today.time>last.time){void openCycleOverview();return;}
    drawChart();
    return;
  }
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
  if(yearMode){discardView();renderRange();renderYearInfo();}
  pending?.abort();const ctl=new AbortController();pending=ctl;
  const id=++version;locating=kind;chartError='';hover=null;
  $('chart-context').hidden=false;write('context-label',translate('loadingChart'));
  try {
    let result;
    if(isCrypto()) {
      try { result=await getCryptoBars(data,interval,{point:p,kind,signal:ctl.signal}); }
      catch (error) {
        if (asset.symbol!=='SOLUSDT' || kind!=='low' || interval==='15m' || ctl.signal.aborted) throw error;
        result=await getCryptoBars(data,'15m',{point:p,kind,signal:ctl.signal});
      }
    }
    else if(isFuture()) {
      const precision=p.precisionMs || DAY;
      const desired=precision>=DAY?'1d':interval;
      let chosen=desired;
      let candles=await loadFutureWindow(asset.symbol,chosen,p.time,ctl.signal);
      if(!candles?.length && chosen!=='1d') {chosen='1d';candles=await loadFutureWindow(asset.symbol,chosen,p.time,ctl.signal);}
      result={interval:chosen,candles};
    } else result={interval:'1d',candles:await loadEquityWindow(asset.symbol,'1d',p.time,ctl.signal)};
    if(id!==version || ctl.signal.aborted) return;
    if (asset.symbol==='SOLUSDT' && kind==='low' && (p.time!==levels?.low?.time || p.price!==levels?.low?.price)) return locate(kind);
    historyView={kind,interval:result.interval,point:p};
    bars=result.candles;locating=null;renderRange();drawChart();
    if(!chart.locate(kind)) throw Error('unmatched');
    write('context-label',translate(levelLabel(kind))+' · '+pointTime(p)+' · '+translate(({'1m':'1 分钟','15m':'15 分钟','30m':'30 分钟','1h':'1 小时','1d':'日线'})[result.interval]));
  } catch {
    if(id!==version || ctl.signal.aborted) return;
    locating=null;historyView=null;write('context-label',translate('无法定位该根 K 线'));renderRange();void buildLatest();
  } finally { if(pending===ctl)pending=null; }
}
function applyAppearance() {
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]').content=theme==='light'?'#f5f6f7':'#101217';
  $('theme').value=themeMode;
  $('theme-symbol').textContent=({system:'◐',light:'☀',dark:'☾'})[themeMode];
  $('theme').title=translate('主题')+' · '+$('theme').selectedOptions[0].textContent;
}
function applyLanguage() {
  $('language').value=lang;applyI18n(lang);applyAppearance();rebuildAssets();renderAsset();renderRange();
  renderQuote();renderLevels();drawChart();
  if(historyView) write('context-label',historyView.kind==='cycle'?overviewLabel():translate(levelLabel(historyView.kind))+' · '+pointTime(historyView.point));
}
function openAsset(symbol,changeUrl=true) {
  if(!assets.has(symbol)) return;
  if(asset && asset.symbol!==symbol){reveal(document.querySelector('.hero'));reveal(document.querySelector('.chart-card'));}
  stopFeed?.();stopFeed=null;++subscription;discardView(yearMode);asset=assets.get(symbol);data=blankState();levels=null;cycle.update(data);
  save('bulls-bears-asset',symbol);save('bulls-bears-last-'+asset.region,symbol);
  if(changeUrl) {const url=new URL(location.href);url.searchParams.set('symbol',symbol);history.replaceState(null,'',url);}
  applyLanguage();subscribe();
}
function switchInterval(value,keepYear=yearMode) {
  if(!Object.hasOwn(rangeChoices,value)) return;
  if(value!==interval || keepYear!==yearMode) reveal(document.querySelector('.chart-area'));
  const previous=interval;discardView(keepYear);interval=value;renderRange();drawChart();
  if(!isCrypto() && value!==previous) subscribe();else void buildLatest();
}
for(const btn of all('[data-region]'))btn.addEventListener('click',()=>{
  const region=btn.dataset.region;
  if(region===asset.region) return;
  const last=read('bulls-bears-last-'+region);
  openAsset(assets.get(last)?.region===region?last:regionDefault[region]);
});
for(const b of all('[data-interval]')) b.addEventListener('click',()=>switchInterval(b.dataset.interval));
function overviewLabel() {
  return translate(historyView.partial?'yearLimited':'cycleOverview')+' · '+dt(bars[0].time,{dateOnly:true})+' – '+dt(bars.at(-1).time,{dateOnly:true});
}
async function openCycleOverview() {
  if(!isCrypto() || !currentMoves.length)return;
  const start=Math.min(...currentMoves.map(m=>m.time));
  discardView();const generation=version;locating='cycle';
  $('chart-context').hidden=false;write('context-label',translate('loadingChart'));renderRange();
  try {
    const daily=await shareCycleBars(data,start);
    if(version!==generation)return;
    if(!daily.length)throw Error();
    historyView={kind:'cycle',interval:'1d',partial:daily[0].time>Math.floor(start/DAY)*DAY};bars=daily;locating=null;
    write('context-label',overviewLabel());
    renderRange();drawChart();chart.reset();
  } catch {
    if(version!==generation)return;
    locating=null;write('context-label',translate('没有可用的 K 线'));renderRange();void buildLatest();
  }
}
$('cycle-overview').addEventListener('click',()=>{if(historyView?.kind==='cycle')switchInterval(interval,false);else void openCycleOverview();});
for(const b of all('[data-locate]')) b.addEventListener('click',()=>{
  document.querySelector('.chart-card').scrollIntoView({block:'start'});
  void locate(b.dataset.locate);
});
$('asset-select').addEventListener('change',e=>openAsset(e.target.value));
$('year-range').addEventListener('click',()=>switchInterval(interval,!yearMode));
$('year-daily').addEventListener('click',()=>switchInterval('1d',true));
$('year-retry').addEventListener('click',()=>{yearRefresh=0;void buildYear();});
$('year-date').addEventListener('change',()=>{
  if(!yearMode)return;
  if(isCrypto()&&interval==='1m'){
    const date=$('year-date').value;
    if(!date || date<$('year-date').min || date>$('year-date').max)return;
    yearRequest?.abort();yearRequest=null;selectedMinuteDate=date;yearView=null;yearRefresh=0;yearError=false;
    bars=[];hover=null;drawChart();void buildYear();
  }else chart.focusDate($('year-date').value);
});
$('view-range').addEventListener('change',e=>{hours[activeInterval()]=Number(e.target.value);drawChart();chart.reset();});
$('back-latest').addEventListener('click',()=>switchInterval(interval));
$('reset').addEventListener('click',()=>{
  if(historyView || locating) switchInterval(interval);
  else {
    chart.reset();
    if(yearMode && !yearView?.dateRange)$('year-date').value=$('year-date').min;
  }
});
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
function refreshTheme() {
  theme=resolvedTheme();
  applyAppearance();
  drawChart();
  scheduleSpark();
}
$('theme').addEventListener('change',event=>{
  themeMode=event.target.value;
  save('bulls-bears-theme',themeMode);
  refreshTheme();
});
systemTheme.addEventListener('change',()=>{if(themeMode==='system') refreshTheme();});
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
