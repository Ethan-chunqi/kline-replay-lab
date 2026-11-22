import {drawMoveTrail,moveTrailColor} from './move-trails.js?v=20261122-editorial';
import {drawText,wrapText,measureText,rule} from './share-poster-type.js?v=20261122-editorial';

const words={
  zh:['K 线','报价','低点 → 当前','高点 → 当前','区间成交量','图外时点','中间时段已折叠'],
  en:['Candles','Quote','Low → current','High → current','Interval volume','Outside chart range','Intervening dates are folded'],
  ja:['ローソク足','価格','安値 → 現在','高値 → 現在','区間出来高','表示範囲外','途中の期間を省略'],
  ru:['Свечи','Котировка','От минимума','От максимума','Объём за период','Вне диапазона','Средняя часть периода свёрнута'],
  ko:['캔들','시세','저점 → 현재','고점 → 현재','구간 거래량','차트 범위 밖','중간 기간 생략'],
};
const epoch=value=>Math.abs(value)<1e11?value*1000:value;

function candles(input) {
  const rows=new Map();
  for(const b of input||[]) {
    if(!b || ![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite) ||
       b.low>Math.min(b.open,b.close) || b.high<Math.max(b.open,b.close))continue;
    const time=epoch(b.time);
    rows.set(time,{...b,time});
  }
  return [...rows.values()].sort((a,b)=>a.time-b.time);
}

function dateLabels(first,last,locale,zone,daily) {
  const year=new Intl.DateTimeFormat('en',{year:'numeric',timeZone:zone});
  const dates=new Intl.DateTimeFormat(locale,{
    timeZone:zone,year:year.format(first)!==year.format(last)?'numeric':undefined,month:'2-digit',day:'2-digit',
    ...(daily?{}:{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),
  });
  return [dates.format(first),dates.format(last)];
}

function plot(ctx,model,bars,moves,{width,locale,zone,colors,theme,breakIndex,earlyTimes}) {
  const currentTime=epoch(model.currentTime??model.chartAsOf);
  const high=Math.max(...bars.map(b=>b.high),...moves.map(m=>m.price),moves.length?model.currentPrice:-Infinity);
  const low=Math.min(...bars.map(b=>b.low),...moves.map(m=>m.price),moves.length?model.currentPrice:Infinity);
  const padding=Math.max((high-low)*.06,Math.abs(high)*1e-7,1e-12);
  const ceiling=high+padding,floor=low-padding;
  const priceY=value=>54+(ceiling-value)/(ceiling-floor)*190;
  const digits=Math.max(0,Math.min(10,Number.isInteger(model.priceDigits)?model.priceDigits:2));
  const numbers=new Intl.NumberFormat(locale,{maximumFractionDigits:digits});
  const ticks=high===low?[high]:[high,(high+low)/2,low];
  const axis=Math.max(68,...ticks.map(v=>measureText(ctx,numbers.format(v),21)+16));
  const right=width-Math.min(185,axis)-8;
  const start=earlyTimes.length?earlyTimes.length*28+20:0;
  const gap=breakIndex>0?28:0;
  const slot=(right-start-gap)/(bars.length+1);
  const body=Math.min(17,slot*.72);
  const center=i=>start+(i+.5)*slot+(breakIndex>0 && i>=breakIndex?gap:0);
  const last=bars.at(-1);
  const volBase=281;
  for(const value of ticks) {
    const py=priceY(value);
    ctx.save();
    ctx.strokeStyle=colors.rule;ctx.lineWidth=1.3;ctx.setLineDash([3,5]);
    ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(right,py);ctx.stroke();ctx.restore();
    drawText(ctx,numbers.format(value),width,py-12,axis,21,colors.muted,{align:'right'});
  }

  const peakVolume=Math.max(0,...bars.map(b=>Number.isFinite(b.volume)?b.volume:0));
  const marked={},gold='#ffdf36';
  function candle(bar,index,highlight) {
    const cx=center(index);
    const color=highlight?gold:bar.close>=bar.open?(model.chartUpColor||colors.up):(model.chartDownColor||colors.down);
    ctx.save();
    if(highlight){ctx.shadowColor='#ffd72a';ctx.shadowBlur=7;}
    ctx.strokeStyle=highlight?(theme==='light'?'#936600':'#fff0aa'):color;
    ctx.lineWidth=highlight?2.5:Math.min(1.9,slot*.42);
    ctx.beginPath();ctx.moveTo(cx,priceY(bar.high));ctx.lineTo(cx,priceY(bar.low));ctx.stroke();
    const top=Math.min(priceY(bar.open),priceY(bar.close));
    const height=Math.max(Math.min(2,body),Math.abs(priceY(bar.close)-priceY(bar.open)));
    ctx.fillStyle=color;ctx.fillRect(cx-body/2,top,body,height);
    if(highlight){ctx.lineWidth=1;ctx.strokeRect(cx-body/2,top,body,height);}
    ctx.restore();
  }
  for(const [i,b] of bars.entries()) {
    const extremes=['low','high'].filter(kind=>{
      if(model.extremeTimes?.[kind]!==b.time)return false;
      const move=moves.find(m=>m.kind===kind);
      return !move || move.price===b[kind];
    });
    for(const kind of extremes)marked[kind]=i;
    if(!extremes.length)candle(b,i,false);
    if(peakVolume>0 && b.volume>0) {
      const h=23*b.volume/peakVolume;
      ctx.save();ctx.globalAlpha=.45;
      ctx.fillStyle=extremes.length?gold:b.close>=b.open?(model.chartUpColor||colors.up):(model.chartDownColor||colors.down);
      ctx.fillRect(center(i)-body/2,volBase-h,body,h);ctx.restore();
    }
  }
  // Linear interpolation between real candle openings retains a separate axis
  // slot for an earlier off-chart extreme and honours the explicit folded gap.
  function xAt(time) {
    if(time<bars[0].time)return 7+28*earlyTimes.indexOf(time);
    if(time>=last.time) {
      const x=center(bars.length-1);
      return currentTime>last.time?x+(right-x-2)*Math.min(1,(time-last.time)/(currentTime-last.time)):x;
    }
    const next=bars.findIndex(b=>b.time>=time);
    if(next===0 || time===bars[next].time)return center(next);
    const fraction=(time-bars[next-1].time)/(bars[next].time-bars[next-1].time);
    return center(next-1)+(center(next)-center(next-1))*fraction;
  }
  for(const m of moves) {
    const origin=marked[m.kind]===undefined?xAt(m.time):center(marked[m.kind]);
    const segment=[origin,priceY(m.price),xAt(currentTime),priceY(model.currentPrice)];
    ctx.save();ctx.beginPath();ctx.rect(-5,44,right+12,218);ctx.clip();
    drawMoveTrail(ctx,{segment,kind:m.kind,theme,scale:1.65,phase:null});
    if(marked[m.kind]===undefined) {
      ctx.fillStyle=moveTrailColor(m.kind,theme);
      ctx.beginPath();ctx.arc(segment[0],segment[1],3.8,0,2*Math.PI);ctx.fill();
    }
    ctx.restore();
  }
  // Redraw the gold wicks over a trajectory meeting them at the same price.
  for(const i of new Set(Object.values(marked)))candle(bars[i],i,true);
  if(moves.length) {
    ctx.fillStyle=colors.ink;ctx.strokeStyle=colors.page;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(xAt(currentTime),priceY(model.currentPrice),5.1,0,2*Math.PI);ctx.fill();ctx.stroke();
  }
  const breaks=[];
  if(start)breaks.push(start-10);
  if(gap)breaks.push((center(breakIndex-1)+center(breakIndex))/2);
  for(const x of breaks) {
    ctx.strokeStyle=colors.soft;ctx.lineWidth=2;ctx.beginPath();
    for(const d of [-4,2]) {ctx.moveTo(x+d-3,volBase);ctx.lineTo(x+d+3,volBase-13);}
    ctx.stroke();
  }
  const daily=model.side==='short' || last.time-bars[0].time>(bars.length-1)*12*3600000 && !gap && bars.length>1;
  const [firstDay,lastDay]=dateLabels(bars[0].time,last.time,locale,zone,daily);
  drawText(ctx,firstDay,start,293,right*.46,22,colors.muted);
  if(bars.length>1)drawText(ctx,lastDay,right,293,right*.46,22,colors.muted,{align:'right'});
}

export function layoutShareChart(ctx,model,{x=0,y=0,width,lang,locale,zone,colors}) {
  const bars=candles(model.bars);
  if(!bars.length)throw new Error('No candles available');
  const copy=words[lang]||words.en;
  const currentTime=epoch(model.currentTime??model.chartAsOf);
  const moves=Number.isFinite(model.currentPrice)&&Number.isFinite(currentTime)
    ?(model.moves||[]).filter(m=>(m.kind==='low'||m.kind==='high') && Number.isFinite(m.time) && Number.isFinite(m.price) && epoch(m.time)<=currentTime)
      .map(m=>({...m,time:epoch(m.time)})).sort((a,b)=>a.kind===b.kind?0:a.kind==='low'?-1:1)
    :[];
  const earlyTimes=[...new Set(moves.map(m=>m.time).filter(time=>time<bars[0].time))].sort((a,b)=>a-b);
  const breakIndex=Number.isFinite(model.breakAfter)?bars.findIndex(b=>b.time===model.breakAfter)+1:0;
  const theme=model.theme==='light'?'light':'dark';
  const gapNote=[earlyTimes.length?copy[5]:'',breakIndex?copy[6]:''].filter(Boolean).join(' · ');
  const gapLines=gapNote?wrapText(ctx,'//   '+gapNote,width,22):[];
  const statTop=339+gapLines.length*28;
  const gutter=40,cell=moves.length===2?(width-gutter)/2:width;
  const sharedKeys=moves.length===2?['untilText','volumeBasis'].filter(key=>moves[0][key]&&moves[0][key]===moves[1][key]):[];
  const localNotes=moves.map(m=>['untilText','volumeBasis'].filter(key=>m[key]&&!sharedKeys.includes(key))
    .flatMap(key=>wrapText(ctx,m[key],cell,22)));
  const commonNotes=sharedKeys.flatMap(key=>wrapText(ctx,moves[0][key],width,22));
  const stats=moves.map((m,i)=>({
    m,notes:localNotes[i],vol:m.volumeText?wrapText(ctx,copy[4]+'  '+m.volumeText,cell,25):[],
  }));
  const contentEnd=stats.length?statTop+Math.max(...stats.map(s=>65+s.vol.length*31+s.notes.length*28)):statTop-8;
  const height=contentEnd+commonNotes.length*28+8;
  function draw(context) {
    context.save();context.translate(x,y);context.textBaseline='top';
    drawText(context,[model.interval,copy[0]].filter(Boolean).join(' · '),0,0,width*.48,34,colors.ink,{weight:700});
    if(model.priceText)drawText(context,copy[1]+'  '+model.priceText,width,5,width*.51,25,colors.soft,{weight:570,align:'right'});
    plot(context,model,bars,moves,{width,locale,zone,colors,theme,breakIndex,earlyTimes});
    gapLines.forEach((line,i)=>drawText(context,line,0,325+i*28,width,22,colors.muted));
    if(stats.length)rule(context,0,statTop,width,colors.rule);
    stats.forEach(({m,vol,notes},i)=>{
      const left=i*(cell+gutter),color=moveTrailColor(m.kind,theme);
      // A solid or dashed key links the label to its trail without repeating the craft.
      context.save();context.strokeStyle=color;context.lineWidth=3.7;
      if(m.kind==='high')context.setLineDash([6,3]);
      context.beginPath();context.moveTo(left,statTop+38);context.lineTo(left+27,statTop+38);context.stroke();context.restore();
      drawText(context,copy[m.kind==='low'?2:3],left+37,statTop+20,cell*.60-37,27,colors.ink,{weight:600});
      drawText(context,m.percentText,left+cell,statTop+12,cell*.38,39,color,{weight:680,align:'right'});
      vol.forEach((line,n)=>drawText(context,line,left,statTop+65+n*31,cell,25,colors.soft,{weight:550}));
      notes.forEach((line,n)=>drawText(context,line,left,statTop+65+vol.length*31+n*28,cell,22,colors.muted));
    });
    commonNotes.forEach((line,n)=>drawText(context,line,0,contentEnd+n*28,width,22,colors.muted));
    context.restore();
  }
  return {height,draw};
}
