import {loadPeriodVolume} from './period-volume.js?v=20261122-share';

const locales={zh:'zh-CN',en:'en-GB',ja:'ja-JP',ru:'ru-RU',ko:'ko-KR'};
const formats=new Map();
function validAt(result,asOf) {
  return result && result.to<=asOf && asOf-result.to<=900000;
}
export function marketTime(point,lang,timeZone,t) {
  if(!Number.isFinite(point?.time))return '—';
  const precision=point.precisionMs??({day:86400000,minute:60000,quote:1000}[point.precision]??60000);
  const day=precision>=86400000;
  const granularity=day?'day':precision>=60000?'minute':precision>=1000?'second':'millisecond';
  const key=[lang,timeZone,granularity].join('/');
  if(!formats.has(key)){
    const options={timeZone,year:'numeric',month:'2-digit',day:'2-digit',timeZoneName:'shortOffset'};
    if(!day)Object.assign(options,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    if(precision<60000)options.second='2-digit';
    if(precision<1000)options.fractionalSecondDigits=3;
    formats.set(key,new Intl.DateTimeFormat(locales[lang],options));
  }
  const stamp=formats.get(key).format(point.time);
  if(day)return stamp+' · '+t(lang,'dailyPrecision');
  if(precision>=60000)return stamp+' · '+t(lang,'barPrecision',{count:precision/60000});
  return stamp;
}

export function createMoveVolumes(onChange) {
  const records=new Map();
  function update(quote,levels) {
    const entries={};
    for(const kind of ['low','high']) {
      const point=levels?.[kind];
      const key=point&&quote.sourceId && levels.sourceId===quote.sourceId && levels.symbol===quote.symbol
        ? [quote.symbol,quote.sourceId,point.time,point.price,point.precisionMs].join('/') : null;
      let record=records.get(kind);
      if(record?.key!==key){
        record?.controller.abort();records.delete(kind);record=null;
      }
      if(!key||!quote.asOf||point.time>quote.asOf)continue;
      if(!record){
        record={key,controller:new AbortController(),requested:0,retryAfter:0,result:null,promise:null};
        records.set(kind,record);
      }
      entries[kind]=record;
      const minute=Math.floor((quote.asOf+1)/60000);
      const skippedWindow=record.requested && minute-record.requested>=15;
      if(!record.promise && (skippedWindow||Date.now()>=record.retryAfter) && (record.requested!==minute||!validAt(record.result,quote.asOf))){
        record.requested=minute;
        const request={symbol:quote.symbol,sourceId:quote.sourceId,point,kind,asOf:quote.asOf,candles:quote.candles,signal:record.controller.signal};
        record.promise=loadPeriodVolume(request).then(result=>{
          if(validAt(result,quote.asOf) && Number.isFinite(result.volume) && result.from<=result.to) record.result=result;
          else if(!validAt(record.result,quote.asOf)) record.result=null;
        }).catch(()=>{}).finally(()=>{
          record.promise=null;record.retryAfter=Date.now()+(record.result?10000:30000);
          if(records.get(kind)===record)onChange();
        });
      }
    }
    return entries;
  }
  return {update};
}

export function describeMoves({levels,records,price,asOf,lang,timeZone,base},t,pending=true) {
  const moves=[];
  for(const kind of ['low','high']) {
    const point=levels?.[kind];
    if(!(point?.price>0 && point.time<=asOf && price>0))continue;
    const record=records[kind];
    const result=validAt(record?.result,asOf) ? record.result:null;
    const refined=result?.pointTime!=null?{time:result.pointTime,precisionMs:result.precisionMs??1}:point;
    const change=(price-point.price)/point.price*100;
    const digits=change && Math.abs(change)<.01?Math.min(12,Math.ceil(-Math.log10(Math.abs(change)))+1):2;
    const percentText=new Intl.NumberFormat(locales[lang],{style:'percent',signDisplay:'exceptZero',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(change/100);
    const volumeText=result?result.volume.toLocaleString(locales[lang],{maximumFractionDigits:4})+' '+base:base?t(lang,pending&&record?.promise?'volumeLoading':'incompleteVolume'):'';
    const timeText=marketTime(refined,lang,timeZone,t);
    const untilText=result?t(lang,'measuredUntil',{time:marketTime({time:result.to,precisionMs:1000},lang,timeZone,t)}):'';
    const volumeBasis=result?.fromMinute?t(lang,'moveFromMinute',{count:1}):'';
    moves.push({kind,price:point.price,time:refined.time,timeText,percentText,volumeText,untilText,volumeBasis,volume:result?.volume,volumeTo:result?.to});
  }
  return moves;
}
