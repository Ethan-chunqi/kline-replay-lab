import {drawMoveTrail,moveTrailColor} from './move-trails.js?v=20261122-editorial';
import {drawText,wrapText,measureText,rule} from './share-poster-type.js?v=20261122-editorial';

const words={
  zh:['K 线','报价','低点 → 当前','高点 → 当前','区间成交量','图外时点','中间时段已折叠'],
  en:['Candles','Quote','Low → current','High → current','Interval volume','Outside chart range','Intervening dates are folded'],
  ja:['ローソク足','価格','安値 → 現在','高値 → 現在','区間出来高','表示範囲外','途中の期間を省略'],
  ru:['Свечи','Котировка','От минимума','От максимума','Объём за период','Вне диапазона','Средняя часть периода свёрнута'],
  ko:['캔들','시세','저점 → 현재','고점 → 현재','구간 거래량','차트 범위 밖','중간 기간 생략'],
};
const statWords={
  zh:['区间','价格涨跌','统计至'],
  en:['Interval','Price change','Volume through'],
  ja:['区間','価格変動','集計終了'],
  ru:['Интервал','Изменение цены','Данные по'],
  ko:['구간','가격 변동','집계 시각'],
};

function cutoffValue(move,locale,zone) {
  if(!Number.isFinite(move.volumeTo))return '';
  const stamp=new Date(epoch(move.volumeTo));
  const date=new Intl.DateTimeFormat(locale,{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(stamp);
  const clock=new Intl.DateTimeFormat(locale,{timeZone:zone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(stamp);
  const offset=new Intl.DateTimeFormat('en',{timeZone:zone,timeZoneName:'shortOffset'}).formatToParts(stamp)
    .find(part=>part.type==='timeZoneName')?.value;
  return [date,clock,offset].filter(Boolean).join('  ');
}

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
  const axis=Math.min(200,Math.max(68,...ticks.map(v=>measureText(ctx,numbers.format(v),25)+18)));
  const right=width-axis-8;
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
    drawText(ctx,numbers.format(value),width,py-14,axis,25,colors.muted,{align:'right'});
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
  drawText(ctx,firstDay,start,293,right*.46,25,colors.muted);
  if(bars.length>1)drawText(ctx,lastDay,right,293,right*.46,25,colors.muted,{align:'right'});
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
  const statTop=347+gapLines.length*28;
  const headings=statWords[lang]||statWords.en;
  const columns={label:0,change:0,volume:0};
  const rows=moves.map(move=>({
    move,label:copy[move.kind==='low'?2:3],cutoff:cutoffValue(move,locale,zone),basis:move.volumeBasis||'',
  }));
  const hasVolume=rows.some(row=>row.move.volumeText);
  const gap=30,keyWidth=32;
  columns.label=Math.max(measureText(ctx,headings[0],26),...rows.map(row=>keyWidth+measureText(ctx,row.label,31,575)));
  columns.change=Math.max(measureText(ctx,headings[1],26),...rows.map(row=>measureText(ctx,row.move.percentText,43,655)));
  columns.volume=hasVolume?Math.max(measureText(ctx,copy[4],26),...rows.map(row=>measureText(ctx,row.move.volumeText||'',33,580))):0;
  const inlineVolume=hasVolume && columns.label+columns.change+columns.volume+gap*2<=width;
  // Leave a clear gutter between each number column even for wide localised values.
  const changeEnd=inlineVolume?Math.min(width-columns.volume-gap,Math.max(width*.52,columns.label+gap+columns.change)):width;
  const changeWidth=Math.min(columns.change,changeEnd*.60);
  const labelWidth=changeEnd-changeWidth-gap;
  const volumeWidth=width-changeEnd-gap;
  const sharedCutoff=rows.length>1 && rows.every(row=>(row.cutoff||row.move.untilText)===(rows[0].cutoff||rows[0].move.untilText));
  const sharedBasis=rows.length>1 && rows.every(row=>row.basis===rows[0].basis);
  const paint=[];
  let bottom=statTop;
  const line=(top)=>paint.push(context=>rule(context,0,top,width,colors.rule));
  function label(value,left,top,space,size,ink,weight=500,align='left'){
    paint.push(context=>drawText(context,value,left,top,space,size,ink,{weight,align}));
  }
  function detail(title,value,ink=colors.soft) {
    if(!value)return;
    const titleWidth=title?measureText(ctx,title,26,500):0;
    const valueWidth=measureText(ctx,value,28,530);
    if(title && titleWidth+gap+valueWidth<=width){
      label(title,0,bottom+3,titleWidth+2,26,colors.muted);
      label(value,width,bottom,width-titleWidth-gap,28,ink,530,'right');
      bottom+=49;
      return;
    }
    if(title){label(title,0,bottom,width,26,colors.muted);bottom+=37;}
    const lines=wrapText(ctx,value,width,28,530);
    for(const valueLine of lines){
      label(valueLine,0,bottom,width,28,ink,530);
      bottom+=38;
    }
    bottom+=11;
  }
  function cutoff(row){
    // Older snapshots may only contain an already-localised annotation.
    if(row.cutoff)detail(headings[2],row.cutoff);
    else detail('',row.move.untilText);
  }
  if(rows.length){
    line(bottom);bottom+=23;
    label(headings[0],0,bottom,labelWidth,26,colors.muted);
    label(headings[1],changeEnd,bottom,changeWidth,26,colors.muted,500,'right');
    if(inlineVolume)label(copy[4],width,bottom,volumeWidth,26,colors.muted,500,'right');
    bottom+=48;
    rows.forEach((row,index)=>{
      const {move}=row,top=bottom,color=moveTrailColor(move.kind,theme);
      paint.push(context=>{
        context.save();context.strokeStyle=color;context.lineWidth=4;
        if(move.kind==='high')context.setLineDash([6,3]);
        context.beginPath();context.moveTo(0,top+24);context.lineTo(21,top+24);context.stroke();context.restore();
      });
      label(row.label,keyWidth,top+5,labelWidth-keyWidth,31,colors.ink,575);
      label(move.percentText,changeEnd,top-3,changeWidth,43,color,655,'right');
      if(inlineVolume && move.volumeText)label(move.volumeText,width,top+4,volumeWidth,33,colors.ink,580,'right');
      bottom+=62;
      if(!inlineVolume && move.volumeText)detail(copy[4],move.volumeText,colors.ink);
      if(!sharedCutoff)cutoff(row);
      if(!sharedBasis)detail('',row.basis);
      if(index<rows.length-1){line(bottom+1);bottom+=23;}
    });
    if(sharedCutoff)cutoff(rows[0]);
    if(sharedBasis)detail('',rows[0].basis);
  }
  const height=bottom+4;
  function draw(context) {
    context.save();context.translate(x,y);context.textBaseline='top';
    drawText(context,[model.interval,copy[0]].filter(Boolean).join(' · '),0,0,width*.48,38,colors.ink,{weight:680});
    if(model.priceText)drawText(context,copy[1]+'  '+model.priceText,width,6,width*.51,27,colors.soft,{weight:560,align:'right'});
    plot(context,model,bars,moves,{width,locale,zone,colors,theme,breakIndex,earlyTimes});
    gapLines.forEach((value,i)=>drawText(context,value,0,325+i*28,width,22,colors.muted));
    paint.forEach(drawLine=>drawLine(context));
    context.restore();
  }
  return {height,draw};
}
