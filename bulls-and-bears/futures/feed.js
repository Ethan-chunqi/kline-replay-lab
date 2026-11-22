import { futureCatalog } from './catalog.js';
export { futureCatalog };

const localRoot = new URL('./',import.meta.url);
const products = new Map(futureCatalog.map(p => [p.symbol,p]));
const frames = new Map([['1m',1],['15m',15],['30m',30],['1h',60],['1d',1440]]);
const cache = new Map();
const minute = 60000;
const hour = 60*minute;
const day = 24*hour;
const quarter = 15*minute;
function midnight(t) { return Math.floor((t+8*hour)/day)*day-8*hour; }
function cnDate(t) { return new Date(t+8*hour).toISOString().slice(0,10); }
function candle(r) { return {time:r[0]*1000,open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]}; }
function validRows(a) {
  return Array.isArray(a) && a.length>0 && a.every((r,i)=>Array.isArray(r) && r.length===6 && r.every(Number.isFinite) && r[3]>0 &&
    r[2]>=Math.max(r[1],r[4]) && r[3]<=Math.min(r[1],r[4]) && r[5]>=0 && (!i || r[0]>a[i-1][0]));
}
function valid(raw,p) {
  return raw?.schema===1 && p.symbol===raw.symbol && new RegExp('^'+p.symbol+'[0-9]{4}$').test(raw.contract) &&
    raw.sourceId==='cffex-'+raw.contract && p.multiplier===raw.multiplier && p.tick===raw.tick &&
    raw.price>0 && raw.prevSettlement>0 && raw.asOf>=raw.tradeDay && raw.asOf<=Date.now()+60000 &&
    raw.high?.price>0 && (!raw.low || raw.low.price>0) && validRows(raw.intraday) && validRows(raw.days);
}
function aggregate(a,count) {
  if (count===1 || count===15 || count===1440) return a.map(candle);
  const result=[];
  for (const r of a) {
    const b=candle(r),open=midnight(b.time);
    const start=b.time>=open+13*hour ? open+13*hour : open+9.5*hour;
    const group=start+Math.floor((b.time-start)/(count*minute))*count*minute;
    const current=result.at(-1);
    if (!current || current.time!==group) result.push({...b,time:group});
    else {
      current.high=Math.max(current.high,b.high);current.low=Math.min(current.low,b.low);
      current.close=b.close;current.volume+=b.volume;
    }
  }
  return result;
}
function session(raw) {
  if (!raw) return 'unknown';
  const now=Date.now(), today=midnight(now);
  let expected=today;
  const weekday=t=>new Date(t+8*hour).getUTCDay();
  if ([0,6].includes(weekday(today)) || now<today+9.5*hour) {
    do {expected-=day;} while ([0,6].includes(weekday(expected)));
  }
  if (expected!==raw.tradeDay) return 'unknown';
  if (now>=raw.tradeDay+15*hour) return raw.asOf>=raw.tradeDay+15*hour-2*minute?'closed':'unknown';
  if (now>=today+11.5*hour && now<today+13*hour) return raw.asOf>=today+11.5*hour-2*minute?'break':'unknown';
  return now-raw.asOf<=45*minute?'open':'unknown';
}
function remote() {
  let url;
  if (globalThis.FUTURES_DATA_URL) url=new URL(globalThis.FUTURES_DATA_URL,localRoot);
  else {
    const equity=new URL(globalThis.EQUITY_DATA_URL || 'https://raw.githubusercontent.com/Ethan-chunqi/kline-replay-lab/market-data/quotes/',localRoot);
    if (!equity.pathname.endsWith('/')) equity.pathname+='/';
    url=new URL('futures/',equity);
  }
  if (!url.pathname.endsWith('/')) url.pathname+='/';
  return url;
}
async function get(url,signal) {
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,8000);
  try {
    const response=await fetch(url,{signal:controller.signal,credentials:'omit',cache:'no-cache'});
    if (!response.ok) throw Error('合约快照不可用');
    return await response.json();
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function compose(p,raw,frame) {
  const state=session(raw);
  const cycle=raw?{symbol:p.symbol,sourceId:raw.sourceId,contract:raw.contract,high:raw.high,low:raw.low,asOf:raw.asOf,status:'verified'}:null;
  return {...p,interval:frame,status:raw?'snapshot':'loading',error:'',priceUnit:'点',volumeUnit:'手',asOf:raw?.asOf??null,
    source:raw?.source || '',sourceId:raw?.sourceId||'',price:raw?.price??null,contract:raw?.contract||'',
    dayHigh:raw?.dayHigh??null,dayLow:raw?.dayLow??null,tradeDay:raw?.tradeDay??null,generatedAt:raw?.generatedAt??null,
    prevClose:raw?.prevSettlement??null,prevSettlement:raw?.prevSettlement??null,settlement:raw?.settlement??null,
    marginRate:raw?.marginRate??null,marginRateLong:raw?.marginRateLong??null,marginRateShort:raw?.marginRateShort??null,
    marginAsOf:raw?.marginAsOf??null,marginSourceUrl:raw?.marginSourceUrl||'',quoteUrl:raw?.quoteUrl||'',
    expiryDate:raw?.expiryDate||'',listingDate:raw?.listingDate||'',mainSourceUrl:raw?.mainSourceUrl||'',
    officialSourceUrl:raw?.officialSourceUrl||'',officialCloseVerified:!!raw?.officialCloseVerified,
    executionConfirmedAt:raw?.executionConfirmedAt,sessionEnd:raw?.tradeDay ? raw.tradeDay+15*hour : null,
    volume:raw?.volume??null,openInterest:raw?.openInterest??null,barSource:frame==='1m'?'新浪期货':raw?.barSource||'',dailySource:raw?.dailySource||'',
    session:state,sessionLabel:({closed:'已收盘',open:'盘中 · 延时报价',break:'午间休市',unknown:'历史报价 · 待更新'})[state],
    high:raw?.high??null,low:raw?.low??null,cycle,historyStart:raw?.historyStart??null,
    candles:raw?aggregate(frame==='1m'?(validRows(raw.minuteBars)?raw.minuteBars:[]):frame==='1d'?raw.days:raw.intraday,frames.get(frame)):[],
    sessionCandles:raw?raw.intraday.filter(r=>r[0]*1000>=raw.tradeDay).map(candle):[]};
}
async function quoteTick(raw,signal) {
  const now=Date.now(),d=midnight(now);
  // A new session may have rolled to another delivery month. Its first snapshot must re-establish the main-month identity.
  if (d!==raw.tradeDay || now<d+9.5*hour || now>d+15*hour+15*minute ||
      (now>d+11.5*hour+15*minute && now<d+13*hour))return null;
  const c=raw.contract, query=new URLSearchParams({orderBy:'',sort:'',pageSize:'999',pageIndex:'0',specificContract:'true',
    platform:'zbPC',field:'name,p,vol,ccl,o,h,l,zjsj,dm,sc,uid,jysj'});
  const result=await get('https://futsseapi.eastmoney.com/list/custom/CFFEX_'+c+'?'+query,signal);
  const q=result.list?.[0];
  if (!q || q.dm!==c || q.uid!=='CFFEX|'+c || +q.sc!==220 || +q.zjsj!==raw.prevSettlement ||
      !(q.vol>=raw.volume && q.l>0 && q.l<=q.p && q.h>=q.p)) return null;
  const stamp=String(q.jysj).padStart(6,'0');
  if (!/^\d{6}$/.test(stamp))return null;
  const t=Math.min(d+15*hour,d+(+stamp.slice(0,2))*hour+(+stamp.slice(2,4))*minute+(+stamp.slice(4))*1000);
  if (t<=raw.asOf || t>now+minute || now-t>45*minute)return null;
  let high=raw.high,low=raw.low,uncertain=raw.uncertainLow,candidate=low||raw.confirmedLowCandidate;
  const at=(price)=>({price,time:t,precision:'quote',precisionMs:1000});
  const daily=(price)=>({price,time:d,precision:'day',precisionMs:day});
  if (q.h>high.price) {
    high=daily(q.h);candidate=at(q.p);uncertain=daily(q.l);
    if (q.o===q.h) candidate=daily(q.l);
  } else {
    if (!candidate || q.p<candidate.price)candidate=at(q.p);
    if ((high.time+high.precisionMs<=d || q.l<raw.dayLow) && q.l<candidate.price) candidate=daily(q.l);
  }
  if (uncertain && candidate.price<=uncertain.price)uncertain=null;
  low=uncertain?null:candidate;
  const days=raw.days.slice(),last=days.at(-1);
  if (last[0]*1000===d)days[days.length-1]=[last[0],+q.o,+q.h,+q.l,+q.p,+q.vol];
  return {...raw,price:+q.p,asOf:t,dayHigh:+q.h,dayLow:+q.l,volume:+q.vol,openInterest:+q.ccl,
    generatedAt:now,officialCloseVerified:false,settlement:null,days,high,low,uncertainLow:uncertain,confirmedLowCandidate:uncertain?candidate:null};
}

export function startIndexFutureFeed(onUpdate,symbol,frame='15m') {
  const product=products.get(symbol);
  if (!product || !frames.has(frame))throw new RangeError('不支持的股指期货或周期');
  const controller=new AbortController(), signal=controller.signal;
  let raw=cache.get(symbol),busy=false,lastSession=session(raw);
  function accept(next,online=false) {
    if (signal.aborted || !valid(next,product))return;
    if(raw?.contract===next.contract && !validRows(raw.minuteBars) && validRows(next.minuteBars) && raw.asOf>=next.asOf){
      raw={...raw,minuteBars:next.minuteBars};cache.set(symbol,raw);onUpdate(compose(product,raw,frame));
    }
    if (raw && (next.asOf<raw.asOf || (next.asOf===raw.asOf && next.generatedAt<=raw.generatedAt &&
        (!online || next.generatedAt<raw.generatedAt || (raw.executionConfirmedAt && Date.now()-raw.executionConfirmedAt<30000)))))return;
    raw={...next,executionConfirmedAt:online?Date.now():null};cache.set(symbol,raw);lastSession=session(raw);onUpdate(compose(product,raw,frame));
  }
  async function refresh() {
    if (busy || signal.aborted)return;
    busy=true;
    try {
      const roots=raw?[remote()]:[localRoot,remote()];
      await Promise.allSettled(roots.map(async root=>accept(await get(new URL('data/'+symbol+'.json',root),signal),root.href!==localRoot.href)));
      if (raw && !signal.aborted) {try {const q=await quoteTick(raw,signal);if(q)accept(q,true);}catch{}}
      if (signal.aborted)return;
      if (!raw)onUpdate({...compose(product,null,frame),status:'offline',error:'暂时无法取得股指期货报价'});
      else if (session(raw)!==lastSession){lastSession=session(raw);onUpdate(compose(product,raw,frame));}
    } finally {busy=false;}
  }
  onUpdate(compose(product,raw,frame));void refresh();
  const resume=()=>{if(!document.hidden)void refresh();};
  const timer=setInterval(resume,45_000);
  window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  return ()=>{controller.abort();clearInterval(timer);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
}

export async function loadFutureWindow(symbol,frame,pointTime,signal) {
  const p=products.get(symbol);
  if (!p || !frames.has(frame) || !Number.isFinite(pointTime))return [];
  let raw=cache.get(symbol);
  if (!raw) {
    for (const root of [localRoot,remote()]) {
      try {const obj=await get(new URL('data/'+symbol+'.json',root),signal);if(valid(obj,p)){raw=obj;break;}}catch{if(signal?.aborted)return [];}
    }
  }
  if (!raw || signal?.aborted)return [];
  const rows=aggregate(frame==='1m'?(validRows(raw.minuteBars)?raw.minuteBars:[]):frame==='1d'?raw.days:raw.intraday,frames.get(frame));
  const idx=frame==='1d'?rows.findIndex(r=>cnDate(r.time)===cnDate(pointTime)):
    rows.findIndex(r=>r.time<=pointTime && r.time+frames.get(frame)*minute>pointTime);
  if (idx<0)return [];
  return rows.slice(Math.max(0,idx-55),idx+56);
}

export function captureFutureFrame(snapshot,frame) {
  const product=products.get(snapshot.symbol),raw=cache.get(snapshot.symbol);
  if(!product || !raw || !frames.has(frame) || raw.asOf!==snapshot.asOf || raw.generatedAt!==snapshot.generatedAt ||
     raw.contract!==snapshot.contract || raw.sourceId!==snapshot.sourceId)return null;
  return {candles:compose(product,raw,frame).candles,sourceId:raw.sourceId,barSource:raw.barSource};
}
