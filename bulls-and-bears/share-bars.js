import {getCryptoBars,shareCycleBars,intervalMs} from './crypto-intervals.js?v=20261122-share';
import {captureEquityFrame,loadEquityWindow} from './equities/feed.js?v=20261122-trails';
import {captureFutureFrame} from './futures/feed.js?v=20261122-trails';
import {loadEquityYear} from './equities/year.js?v=20261122-market-v3';
import {loadFutureYear} from './futures/year.js?v=20261122-market-v3';

const quarter=intervalMs['15m'],day=intervalMs['1d'];
const maxQuarters=112,recentQuarters=54;

function lowBar(rows,point) {
  if(!point)return -1;
  const precision=point.precisionMs??(point.precision==='day'?day:1);
  return rows.findIndex(b=>b.low===point.price && (precision<=quarter
    ? b.time<=point.time && point.time+precision<=b.time+quarter
    : b.time>=point.time && b.time<point.time+precision));
}

function lowWindow(head,index,latest,levels) {
  if(index<0)return {bars:latest.slice(-recentQuarters)};
  const anchorTime=head[index].time;
  const precise=levels.low.precisionMs??(levels.low.precision==='day'?day:1);
  const barLevels=precise<=quarter?levels:{...levels,low:{...levels.low,time:anchorTime,precision:'15m',precisionMs:quarter}};
  const at=latest.findIndex(b=>b.time===anchorTime);
  if(at>=0 && latest.length-at<=maxQuarters) {
    const from=Math.max(0,latest.length-maxQuarters,Math.min(at-6,latest.length-40));
    return {bars:latest.slice(from),barLevels};
  }
  const earlier=head.slice(Math.max(0,index-6),index+18);
  const tail=latest.slice(-recentQuarters);
  if(earlier.at(-1).time>=tail[0].time)return {bars:tail,barLevels};
  return {bars:earlier.concat(tail),breakAfter:earlier.at(-1).time,barLevels};
}

function currentFrameId(source,frame) {
  return frame==='15m'||frame==='30m'||frame==='1h'
    ? source.intradaySourceId||source.sourceId:source.sourceId;
}

// The decision and market snapshot are captured synchronously before any
// network request. An archive is used only for candles already closed at that time.
export async function positionShareBars({side,source,asset,selected,chartBars=[],chartSourceId,levels,cryptoMarket,future}) {
  const frame=side==='long'?'15m':side==='short'?'1d':selected;
  const empty={bars:[],frame,sourceId:source?.sourceId};
  if(!source || !asset || source.symbol!==asset.symbol || !source.sourceId ||
     !Object.hasOwn(intervalMs,frame) || !Number.isSafeInteger(source.asOf))return empty;
  const frozen=rows=>(rows||[]).filter(b=>b.time<=source.asOf);
  const basisId=source.cycle?.sourceId||levels?.sourceId;
  const basis=levels?{...levels,sourceId:basisId}:null;
  if(side!=='short' && side!=='long' && chartBars.length) {
    return {bars:frozen(chartBars).slice(-112),frame,sourceId:chartSourceId||currentFrameId(source,frame),barLevels:basis};
  }
  let pack;
  if(cryptoMarket) {
    if(source.market!=='perpetual' || source.interval!=='15m')return empty;
    if(frame==='1d' && side==='short' && levels?.high)
      pack={candles:await shareCycleBars(source,levels.high.time).catch(()=>[]),sourceId:source.sourceId};
    if(!pack?.candles.length) {
      const current=await getCryptoBars(source,frame).catch(()=>null);
      if(current?.interval!==frame || current.sourceId!==source.sourceId)return empty;
      const candles=frame==='1m'?current.candles.filter(b=>b.time+intervalMs[frame]<=source.asOf):current.candles;
      pack={candles,sourceId:current.sourceId};
    }
  } else {
    pack=future?captureFutureFrame(source,frame):captureEquityFrame(source,frame);
    if(!pack && source.interval===frame)pack={candles:source.candles,sourceId:currentFrameId(source,frame)};
    if(!pack)return empty;
  }
  const bars=frozen(pack.candles);
  const result={frame,sourceId:pack.sourceId,barLevels:basis};
  if(!bars.length)return {...result,bars:[]};
  if(side==='short') {
    const high=basis?.high;
    if(!high || basis.sourceId!==pack.sourceId)return {...result,bars};
    const first=bars.findIndex(b=>b.time+day>high.time);
    if(bars[0].time>high.time+day && !cryptoMarket && !future) {
      const older=await loadEquityWindow(source.symbol,'1d',high.time,AbortSignal.timeout(6000)).catch(()=>[]);
      const index=older.findIndex(b=>b.high===high.price && b.time<=high.time+day && high.time<b.time+day);
      if(index>=0) {
        const left=older.slice(Math.max(0,index-2),index+27);
        if(left.at(-1).time<bars[0].time)return {...result,bars:left.concat(bars),breakAfter:left.at(-1).time};
      }
    }
    return {...result,bars:first<0?bars:bars.slice(Math.max(0,first-2))};
  }
  if(side!=='long')return {...result,bars:bars.slice(-112)};
  const point=basis?.low;
  if(!point || basis.sourceId!==pack.sourceId)return {...result,bars:bars.slice(-recentQuarters)};
  let head=bars,index=lowBar(head,point);
  if(index<0 && point.time<bars[0].time) {
    const signal=AbortSignal.timeout(6000);
    if(cryptoMarket) {
      const old=await getCryptoBars(source,'15m',{point,kind:'low',signal}).catch(()=>null);
      if(old?.interval==='15m' && old.sourceId===pack.sourceId)head=old.candles;
    } else {
      const captured={...source,interval:frame,sourceId:pack.sourceId,candles:bars,barSource:pack.barSource||source.barSource};
      const old=await (future?loadFutureYear(captured,frame,signal):loadEquityYear(captured,frame,signal)).catch(()=>null);
      if(old?.sourceId===pack.sourceId && (!future || old.contract===source.contract &&
        (old.source===captured.barSource || /新浪|Sina/i.test(old.source) && /新浪|Sina/i.test(captured.barSource))))head=old.candles;
    }
    head=head.filter(b=>b.time+quarter<=source.asOf);
    index=lowBar(head,point);
  }
  return {...result,...lowWindow(head,index,bars,basis)};
}
