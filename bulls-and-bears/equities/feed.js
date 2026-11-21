import { equityCatalog } from './catalog.js?v=20261122-market-v3';
import { koreanHours, koreanSession } from './korea-session.js?v=20261122-market-v3';
export { equityCatalog };

const localRoot = new URL('./', import.meta.url);
const byId = new Map(equityCatalog.map(asset => [asset.symbol, asset]));
const intervals = new Map([['1m',1],['15m',15],['30m',30],['1h',60],['1d',1440]]);
const recent = new Map();
const hour = 3600000;
const day = 24 * hour;
const quarter = hour / 4;
const formatters = new Map();

function wall(time, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
  }
  const parts = Object.fromEntries(formatters.get(timeZone).formatToParts(time).map(p => [p.type,p.value]));
  return { date: parts.year+'-'+parts.month+'-'+parts.day, minutes: +parts.hour*60+(+parts.minute) };
}

function stateOfSession(meta, raw) {
  const now = Date.now();
  if (meta.region==='kr') return koreanSession(raw,now,wall);
  const { date, minutes } = wall(now,meta.timeZone);
  const calendarDate = new Date(date+'T12:00:00Z');
  const weekday = calendarDate.getUTCDay();
  const weekend = weekday===0 || weekday===6;
  const china = meta.region === 'cn';
  if (!raw) return 'unknown';
  const tradingDate = wall(raw.tradeDay,meta.timeZone).date;
  if (weekend || minutes<570) {
    // Only show the close when the last expected weekday and its closing print are covered.
    // During multi-day exchange holidays a dated snapshot is more truthful than assuming the market calendar.
    do { calendarDate.setUTCDate(calendarDate.getUTCDate()-1); }
    while ([0,6].includes(calendarDate.getUTCDay()));
  }
  const expectedDate = calendarDate.toISOString().slice(0,10);
  if (tradingDate !== expectedDate) return 'unknown';
  const close = raw.sessionEnd || raw.tradeDay + (china?15:16)*hour;
  if (weekend || minutes<570 || now>=close) return raw.asOf>=close-120000?'closed':'unknown';
  if (china && minutes>=690 && minutes<780) {
    return raw.asOf>=raw.tradeDay+11.5*hour-120000?'break':'unknown';
  }
  if (now-raw.asOf > 45*60000) return 'unknown';
  return 'open';
}
const sessionLabels = {closed:'已收盘',open:'盘中 · 延时报价',break:'午间休市',unknown:'历史报价 · 待更新'};

function bar(row) {
  return {time:row[0]*1000,open:row[1],high:row[2],low:row[3],close:row[4],volume:row[5]};
}
function validRows(rows, adjusted=false) {
  return Array.isArray(rows) && rows.length > 0 && rows.every((r,i) =>
    Array.isArray(r) && r.length === 6 && r.every(Number.isFinite) && r[0] > 0 &&
    (adjusted || r[3] > 0) && r[3] <= Math.min(r[1],r[4]) && r[2] >= Math.max(r[1],r[4]) && r[5] >= 0 &&
    (!i || r[0] > rows[i-1][0]));
}
function validPoint(p) { return p && Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.time); }
function verified(raw, meta) {
  const expected = meta.region === 'cn' ? (meta.type==='stock' ? 'tencent-stock-qfq' : 'tencent-index') : (meta.region==='kr' && meta.type==='index' ? 'naver-krx' : 'yahoo-chart');
  return raw?.schema === 1 && raw.symbol === meta.symbol && raw.sourceId === expected &&
    raw.price > 0 && raw.asOf <= Date.now()+60_000 && raw.asOf >= raw.tradeDay &&
    raw.generatedAt > 0 && raw.tradeDay > 0 && validPoint(raw.high) && (!raw.low || validPoint(raw.low)) &&
    validRows(raw.intraday) && validRows(raw.minutes) && validRows(raw.days,expected==='tencent-stock-qfq');
}

function roll(rows, minutes, meta) {
  if (minutes === 1 || minutes === 15 || minutes === 1440) return rows.map(bar);
  const result = [];
  for (const row of rows) {
    const current = bar(row);
    const localTime = wall(current.time, meta.timeZone);
    const localMinutes = localTime.minutes;
    // Bucket from each exchange session opening bell. Shanghai restarts at 13:00 after lunch.
    const start = meta.region==='kr' ? koreanHours(localTime.date)[0] : meta.region === 'cn' && localMinutes >= 780 ? 780 : 570;
    const bucket = current.time - ((localMinutes-start) % minutes)*60000;
    const prev = result.at(-1);
    if (!prev || prev.time !== bucket) result.push({...current,time:bucket});
    else {
      prev.high=Math.max(prev.high,current.high); prev.low=Math.min(prev.low,current.low);
      prev.close=current.close; prev.volume+=current.volume;
    }
  }
  return result;
}

function remoteRoot() {
  const configured = globalThis.EQUITY_DATA_URL || 'https://raw.githubusercontent.com/Ethan-chunqi/kline-replay-lab/market-data/quotes/';
  const url = new URL(configured, localRoot);
  if (url.protocol !== 'https:' && url.origin !== localRoot.origin) return null;
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
async function read(url, signal, compressed=false) {
  const ac = new AbortController();
  const abort = () => ac.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(abort,9000);
  try {
    const response = await fetch(url,{signal:ac.signal,cache:'no-cache',credentials:'omit'});
    if (!response.ok) throw new Error('行情数据暂不可用');
    if (compressed) {
      const bytes = await response.arrayBuffer();
      const prefix = new Uint8Array(bytes,0,2);
      if (prefix[0]===31 && prefix[1]===139) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).json();
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',abort);
  }
}

function sessionState(meta, raw, interval) {
  const selected = intervals.get(interval);
  const session = stateOfSession(meta,raw);
  const krHours=raw && meta.region==='kr' ? koreanHours(wall(raw.tradeDay,meta.timeZone).date) : null;
  const levels = raw ? { symbol:meta.symbol, sourceId:raw.sourceId, high:raw.high, low:raw.low, asOf:raw.asOf, status:'verified' } : null;
  return {
    symbol:meta.symbol, interval, market:'equity', currency:meta.currency, timeZone:meta.timeZone,
    priceUnit:meta.type==='index'?'点':meta.currency, volumeUnit:meta.region==='cn'?'手':meta.type==='index'?'成交量':'股',
    sessionStart:krHours ? raw.tradeDay+krHours[0]*60000 : undefined,
    sessionEnd:raw?.sessionEnd || (krHours ? raw.tradeDay+krHours[1]*60000 : undefined),
    executionConfirmedAt:raw?.executionConfirmedAt,executionSourceId:raw?.sourceId,executionSource:raw?.source,
    intradaySourceId:raw?.intradaySourceId, marketCap:raw?.marketCap, marketCapAsOf:raw?.marketCapAsOf,
    sourceId:(selected===1 ? raw?.minuteSourceId : selected!==1440 && meta.region==='kr' ? raw?.intradaySourceId : raw?.sourceId) || '', source:(selected===1 ? raw?.minuteSource : selected!==1440 && meta.region==='kr' ? raw?.intradaySource : raw?.source) || '', status:raw?'snapshot':'loading', error:'',
    candles:raw?roll(selected===1440 ? raw.days.slice(-480) : selected===1 ? (raw.minutes||[]) : raw.intraday,selected,meta):[],
    sessionCandles:raw?raw.intraday.filter(r=>r[0]*1000>=raw.tradeDay).map(bar):[],
    price:raw?.price??null, asOf:raw?.asOf??null, generatedAt:raw?.generatedAt??null,
    tradeDay:raw?.tradeDay??null, dayHigh:raw?.dayHigh??null, dayLow:raw?.dayLow??null, prevClose:raw?.prevClose??null,
    high:raw?.high??null, low:raw?.low??null, cycle:levels, historyStart:raw?.historyStart??null,
    session, sessionLabel:sessionLabels[session], splitBasis:raw?.splitBasis||'', delayMinutes:raw?.delayMinutes??null,
  };
}

function cnTime(text) {
  if (!/^\d{12}(\d{2})?$/.test(text)) return NaN;
  return Date.UTC(+text.slice(0,4),+text.slice(4,6)-1,+text.slice(6,8),+text.slice(8,10)-8,+text.slice(10,12),+(text.slice(12,14)||0));
}
function cnMidnight(time) { return Math.floor((time+8*hour)/day)*day-8*hour; }

async function tencentUpdate(meta, base, signal, interval) {
  const s = meta.providerSymbol;
  const url = 'https://ifzq.gtimg.cn/appstock/app/kline/mkline?param='+s+',m15,,640';
  const result = await read(url,signal);
  const data = result.data?.[s];
  const q = data?.qt?.[s];
  if (result.code !== 0 || q?.[2] !== s.slice(2) || !Array.isArray(data.m15)) return null;
  const rows = data.m15.map(r=>[(cnTime(r[0])-quarter)/1000,+r[1],+r[3],+r[4],+r[2],Math.round(+r[5])]);
  if (!validRows(rows)) return null;
  const latest = rows.at(-1)[0]*1000;
  const tradeDay = cnMidnight(latest);
  const asOf = Math.min(Date.now(),cnTime(q[30]),latest+quarter);
  const price = +q[3];
  // Use overlapping history only, so no missing session between the saved ATH and the new quote can change a cycle.
  if (base.tradeDay < cnMidnight(rows[0][0]*1000) || rows[0][0]*1000>base.asOf || asOf <= base.asOf ||
      cnMidnight(asOf)!==tradeDay || !(price>0) || !(+q[4]>0) || !(+q[33]>=price) || !(+q[34]>0 && +q[34]<=price)) return null;
  if (meta.type==='stock' && tradeDay>base.tradeDay) {
    // A dividend or split can restate the entire forward-adjusted history. Only extend a
    // matching basis in the browser. The scheduled importer rebuilds history on a change.
    const adjusted=await read('https://ifzq.gtimg.cn/appstock/app/fqkline/get?param='+s+',day,,,100,qfq',signal);
    const rows=adjusted.data?.[s]?.qfqday;
    if (!Array.isArray(rows)) return null;
    const existing=new Map(base.days.map(b=>[b[0]*1000,b]));
    const overlap=rows.filter(r=>{const t=Date.parse(r[0]+'T00:00:00+08:00');return t<base.tradeDay && existing.has(t)});
    if (!overlap.length || overlap.some(r=>{
      const old=existing.get(Date.parse(r[0]+'T00:00:00+08:00'));
      return [+r[1],+r[3],+r[4],+r[2]].some((v,i)=>Math.abs(v-old[1+i])>.0011);
    })) return null;
  }
  const boundary = Math.floor(base.asOf/quarter)*quarter;
  let high={...base.high}, candidate=base.low || base.confirmedLowCandidate;
  let uncertain=base.uncertainLow;
  function consider(price,time,precision='15m') {
    if (!candidate || price<candidate.price) candidate={price,time,precision,precisionMs:precision==='day'?day:quarter};
  }
  const priorBar=base.intraday.at(-1);
  for (const r of rows) {
    const t=r[0]*1000;
    if (t<boundary) continue;
    if (r[2]>high.price) {
      high={price:r[2],time:t,precision:'15m',precisionMs:quarter};
      uncertain={price:r[3],time:t,precision:'15m',precisionMs:quarter};
      candidate=null;
      consider(r[4],t);
      if (r[1]===r[2] || r[3]===r[4]) consider(r[3],t);
    } else if (t>=high.time+high.precisionMs || t>=base.asOf) {
      consider(r[3],t);
    } else {
      // A print observed after the previous quote is after its then-existing peak, even within the same candle.
      consider(r[4],t);
      if (priorBar[0]===r[0] && r[3]<priorBar[3]) consider(r[3],t);
    }
    if (uncertain && candidate && candidate.price<=uncertain.price) uncertain=null;
  }
  // A quote can already contain a new record before the publisher's 15-minute bar catches up.
  if (+q[33]>high.price) {
    high={price:+q[33],time:tradeDay,precision:'day',precisionMs:day};
    candidate=null;
    uncertain={price:+q[34],time:tradeDay,precision:'day',precisionMs:day};
    if (+q[5]===high.price) consider(+q[34],tradeDay,'day');
  } else if (high.time+high.precisionMs<=tradeDay || (+q[34]<base.dayLow && tradeDay===base.tradeDay && high.price===base.high.price)) {
    consider(+q[34],tradeDay,'day');
  }
  // The latest actual print is an ordered observation even when an intrabar high and low cannot be ordered.
  consider(price,latest);
  if (uncertain && candidate && candidate.price<=uncertain.price) uncertain=null;
  const low=uncertain?null:candidate;
  const days = new Map(base.days.map(r=>[r[0],r]));
  const rebuilt = new Map();
  for (const r of rows) {
    const stamp=cnMidnight(r[0]*1000)/1000;
    if (stamp<base.tradeDay/1000) continue;
    const d=rebuilt.get(stamp);
    if (!d) {
      if (r[0]===stamp+9.5*3600) rebuilt.set(stamp,[stamp,...r.slice(1)]);
    } else {
      d[2]=Math.max(d[2],r[2]);d[3]=Math.min(d[3],r[3]);d[4]=r[4];d[5]+=r[5];
    }
  }
  for (const [t,r] of rebuilt) days.set(t,r);
  const current = days.get(tradeDay/1000);
  if (!current) return null;
  current[2]=Math.max(current[2],+q[33],price);
  current[3]=Math.min(current[3],+q[34],price);
  current[4]=price;
  const cap=Number(q[45])*100000000;
  const capital=meta.type==='stock' && Number.isFinite(cap) && cap>0 ? {marketCap:Math.round(cap),marketCapAsOf:asOf} : {};
  let minutes=base.minutes;
  if (interval==='1m') {
    const minuteData=await read('https://ifzq.gtimg.cn/appstock/app/kline/mkline?param='+s+',m1,,640',signal);
    const sourceRows=minuteData.data?.[s]?.m1;
    if (!Array.isArray(sourceRows)) return null;
    const parsed=sourceRows.map(r=>[(cnTime(r[0])-60000)/1000,+r[1],+r[3],+r[4],+r[2],+r[5]]).filter(r=>{
      const m=(r[0]*1000-cnMidnight(r[0]*1000))/60000;
      return (570<=m && m<690) || (780<=m && m<900);
    });
    if (!validRows(parsed)) return null;
    minutes=parsed;
  }
  return {...base,...capital,minutes,generatedAt:Date.now(),price,asOf,tradeDay,sessionEnd:tradeDay+15*hour,
    high,low,uncertainLow:uncertain,confirmedLowCandidate:uncertain?candidate:null,prevClose:+q[4],dayHigh:+q[33],dayLow:+q[34],intraday:rows,days:[...days.values()].sort((a,b)=>a[0]-b[0])};
}

export function startEquityFeed(onUpdate,symbol,interval='15m') {
  const meta=byId.get(symbol);
  if (!meta || !intervals.has(interval)) throw new RangeError('不支持的标的或 K 线周期');
  const controller=new AbortController();
  const {signal}=controller;
  let raw=recent.get(symbol);
  let busy=false;
  let previousSession=stateOfSession(meta,raw);
  function publish(next,online=false) {
    if (signal.aborted || !verified(next,meta)) return;
    if (raw && (raw.asOf>next.asOf || (raw.asOf===next.asOf && raw.generatedAt>=next.generatedAt &&
        (!online || raw.generatedAt>next.generatedAt || (raw.executionConfirmedAt && Date.now()-raw.executionConfirmedAt<30000))))) return;
    raw={...next,executionConfirmedAt:online?Date.now():null};recent.set(symbol,raw);
    previousSession=stateOfSession(meta,raw);
    onUpdate(sessionState(meta,raw,interval));
  }
  async function refresh() {
    if (busy || signal.aborted) return;
    busy=true;
    try {
      const roots=raw?[remoteRoot()]:[localRoot,remoteRoot()];
      await Promise.allSettled(roots.filter(Boolean).map(async root=>publish(await read(new URL('data/'+symbol+'.json',root),signal),root.href!==localRoot.href)));
      if (signal.aborted) return;
      if (raw && meta.region==='cn' && ['open','unknown'].includes(stateOfSession(meta,raw))) {
        try { const next=await tencentUpdate(meta,raw,signal,interval);if(next) publish(next,true); } catch { /* Saved quotation remains available. */ }
      }
      if (!signal.aborted) {
        if (!raw) onUpdate({...sessionState(meta,null,interval),status:'offline',error:'暂时无法获取证券行情'});
        else if (stateOfSession(meta,raw)!==previousSession) {
          previousSession=stateOfSession(meta,raw);
          onUpdate(sessionState(meta,raw,interval));
        }
      }
    } finally { busy=false; }
  }
  onUpdate(sessionState(meta,raw,interval));
  void refresh();
  const timer=setInterval(()=>{if(!document.hidden) void refresh();},60_000);
  const resume=()=>{if(!document.hidden) void refresh();};
  document.addEventListener('visibilitychange',resume);
  window.addEventListener('online',resume);
  return ()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
}

export async function loadEquityWindow(symbol,interval,pointTime,signal) {
  const meta=byId.get(symbol);
  if (!meta || !intervals.has(interval) || !Number.isFinite(pointTime)) return [];
  let raw=recent.get(symbol);
  if (!raw) {
    for (const root of [localRoot,remoteRoot()].filter(Boolean)) {
      try { const obj=await read(new URL('data/'+symbol+'.json',root),signal);if(verified(obj,meta)){raw=obj;break;} } catch { if(signal?.aborted)return []; }
    }
  }
  if (!raw || signal?.aborted) return [];
  const minutes=intervals.get(interval);
  if (minutes===1) {
    const minutes=raw.minutes||[];
    if (!minutes.length || pointTime<minutes[0][0]*1000 || pointTime>=minutes.at(-1)[0]*1000+60000) return [];
    return minutes.map(bar);
  }
  if (minutes!==1440) {
    if (pointTime<raw.intraday[0][0]*1000 || pointTime>=raw.intraday.at(-1)[0]*1000+quarter)return [];
    return roll(raw.intraday,minutes,meta);
  }
  const target=wall(pointTime,meta.timeZone).date;
  function windowAt(rows) {
    const i=rows.findIndex(r=>wall(r[0]*1000,meta.timeZone).date===target);
    if (i<0) return [];
    return rows.slice(Math.max(0,i-48),i+49).map(bar);
  }
  const available=windowAt(raw.days);
  if (available.length) return available;
  for (const root of [remoteRoot(),localRoot].filter(Boolean)) {
    try {
      const archive=await read(new URL('history/'+symbol+'.json.gz',root),signal,true);
      if (archive.symbol!==symbol || archive.sourceId!==raw.sourceId || !Array.isArray(archive.rows))continue;
      const arr=windowAt(archive.rows);
      if (arr.length) return arr;
    } catch { if (signal?.aborted)return []; }
  }
  return [];
}

export async function loadAiCaps(onData, region='cn') {
  const aiSymbols = new Set(equityCatalog.filter(a=>a.group===region+'-ai').map(a=>a.symbol));
  if (!['cn','kr'].includes(region))return;
  await Promise.allSettled([localRoot,remoteRoot()].filter(Boolean).map(async root=>{
    const rows=await read(new URL(region==='kr' ? 'market-caps-kr.json' : 'market-caps.json',root));
    if (!Array.isArray(rows) || rows.length!==aiSymbols.size || new Set(rows.map(r=>r.symbol)).size!==aiSymbols.size ||
        !rows.every(r=>aiSymbols.has(r.symbol) && Number.isFinite(r.marketCap) && r.marketCap>0 &&
          Number.isSafeInteger(r.marketCapAsOf) && r.marketCapAsOf>0 && r.marketCapAsOf<=Date.now()+60000)) return;
    onData(rows);
  }));
}
