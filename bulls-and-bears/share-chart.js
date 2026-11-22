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

const plotTop=78,plotBottom=423,volumeTop=439,volumeBottom=481,dateTop=496;

// Each displayed bar remains an individual source candle. Keep both cycle extrema and
// the latest market together, with an explicit break wherever the period is omitted.
function chartWindows(bars,model,moves) {
  const last=bars.length-1;
  const sourceCut=Number.isFinite(model.breakAfter)?bars.findIndex(b=>b.time===model.breakAfter):-1;
  let ranges=[[0,last]];
  if(model.side==='short' && bars.length>84) {
    ranges=[[last-33,last]];
    for(const move of moves) {
      let i=bars.findIndex(b=>b.time===model.extremeTimes?.[move.kind]);
      if(i<0 && move.time>=bars[0].time && move.time<bars[last].time+86400000){
        const next=bars.findIndex(b=>b.time>move.time);
        i=next<0?last:next-1;
      }
      if(i>=0){
        const first=Math.max(0,Math.min(last-21,i-8));
        ranges.push([first,first+21]);
      }
    }
    if(ranges.length===1 || moves.some(m=>m.time<bars[0].time))ranges.push([0,17]);
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const [from,to] of ranges){
    const previous=merged.at(-1);
    if(previous && from<=previous[1]+3)previous[1]=Math.max(previous[1],to);
    else merged.push([from,to]);
  }
  const windows=[];
  for(const [from,to] of merged){
    if(sourceCut>=from && sourceCut<to){
      windows.push(bars.slice(from,sourceCut+1),bars.slice(sourceCut+1,to+1));
    }else windows.push(bars.slice(from,to+1));
  }
  return windows;
}

function priceTicks(low,high,digits) {
  if(low===high)return [high];
  const target=(high-low)/3,step=10**Math.floor(Math.log10(target));
  const scale=[1,2,2.5,5,10].find(k=>k*step>=target)??10;
  const jump=Math.max(10**-digits,step*scale),first=Math.ceil(low/jump-1e-9)*jump;
  const ticks=[];
  for(let i=0;i<6;i++){
    const value=first+i*jump;
    if(value>high+jump*1e-8)break;
    ticks.push(Number(value.toFixed(digits)));
  }
  return ticks.length>=2?ticks:[low,high];
}

function plot(ctx,model,windows,moves,{width,locale,zone,colors,theme,earlyTimes}) {
  const bars=windows.flat(),last=bars.at(-1);
  const currentTime=epoch(model.currentTime??model.chartAsOf);
  const high=Math.max(...bars.map(b=>b.high),...moves.map(m=>m.price),moves.length?model.currentPrice:-Infinity);
  const low=Math.min(...bars.map(b=>b.low),...moves.map(m=>m.price),moves.length?model.currentPrice:Infinity);
  const pad=Math.max((high-low)*.078,Math.abs(high)*.000015,1e-12),ceiling=high+pad,floor=low-pad;
  const priceY=value=>plotTop+(ceiling-value)/(ceiling-floor)*(plotBottom-plotTop);
  const digits=Math.max(0,Math.min(10,Number.isInteger(model.priceDigits)?model.priceDigits:2));
  const number=new Intl.NumberFormat(locale,{maximumFractionDigits:digits});
  const ticks=priceTicks(low,high,digits);
  const axis=Math.min(width*.22,Math.max(65,...ticks.map(v=>measureText(ctx,number.format(v),25,480))))+20;
  const right=width-axis-9,start=earlyTimes.length?earlyTimes.length*22+24:6;
  const seam=windows.length>1?34:0;
  const slot=(right-start-seam*(windows.length-1))/(bars.length+1.15);
  const body=Math.min(20,slot*.70);
  const positions=[],panes=[];
  let left=start;
  for(const part of windows) {
    const edge=left+part.length*slot;
    panes.push({left,right:edge,part});
    for(let i=0;i<part.length;i++)positions.push(left+(i+.5)*slot);
    left=edge+seam;
  }
  const positive=model.chartUpColor||colors.up,negative=model.chartDownColor||colors.down;
  const ink=theme==='light'?'#314d46':'#bad0ca';
  const shade=ctx.createLinearGradient(0,plotTop,0,volumeBottom);
  shade.addColorStop(0,theme==='light'?'rgba(51,93,78,.028)':'rgba(85,151,135,.060)');
  shade.addColorStop(1,theme==='light'?'rgba(51,93,78,0)':'rgba(85,151,135,0)');
  ctx.fillStyle=shade;ctx.fillRect(0,plotTop,right,volumeBottom-plotTop);
  // Each grid rule stops at the break. The empty gutter is visible above price and volume.
  ctx.save();ctx.strokeStyle=colors.rule;ctx.lineWidth=1.3;ctx.globalAlpha=.72;
  for(const tick of ticks){
    const y=priceY(tick);
    ctx.beginPath();
    panes.forEach((p,i)=>{ctx.moveTo(i===0?0:p.left-2,y);ctx.lineTo(i===panes.length-1?right:p.right+2,y);});
    ctx.stroke();
  }
  ctx.restore();
  for(const tick of ticks)drawText(ctx,number.format(tick),width,priceY(tick)-15,axis-9,25,colors.muted,{align:'right',weight:480});
  ctx.save();ctx.globalAlpha=.72;rule(ctx,0,volumeBottom+2,right,colors.rule);ctx.restore();
  const peakVolume=Math.max(0,...bars.map(b=>Number.isFinite(b.volume)?b.volume:0));
  const marked={},gold='#ffdf36';
  function candle(bar,index,highlight) {
    const x=positions[index],color=highlight?gold:bar.close>=bar.open?positive:negative;
    const top=Math.min(priceY(bar.open),priceY(bar.close));
    const height=Math.max(2.1,Math.abs(priceY(bar.close)-priceY(bar.open)));
    ctx.save();ctx.strokeStyle=highlight?(theme==='light'?'#a07605':'#ffed86'):color;
    ctx.lineWidth=highlight?2.6:Math.max(1.35,Math.min(2,slot*.20));
    ctx.beginPath();ctx.moveTo(x,priceY(bar.high));ctx.lineTo(x,priceY(bar.low));ctx.stroke();
    if(highlight){ctx.shadowColor='#ffdc43';ctx.shadowBlur=5;}
    ctx.fillStyle=color;ctx.fillRect(x-body/2,top,body,height);
    if(highlight){ctx.shadowBlur=0;ctx.lineWidth=1.4;ctx.strokeRect(x-body/2,top,body,height);}
    ctx.restore();
  }
  for(const [i,b] of bars.entries()){
    const extremes=['low','high'].filter(kind=>{
      if(model.extremeTimes?.[kind]!==b.time)return false;
      const move=moves.find(m=>m.kind===kind);
      return !move || move.price===b[kind];
    });
    for(const kind of extremes)marked[kind]=i;
    if(!extremes.length)candle(b,i,false);
    if(peakVolume>0 && b.volume>0){
      const h=(volumeBottom-volumeTop)*b.volume/peakVolume;
      ctx.save();ctx.globalAlpha=extremes.length?.75:.50;
      ctx.fillStyle=extremes.length?gold:b.close>=b.open?positive:negative;
      ctx.fillRect(positions[i]-body/2,volumeBottom-h,body,h);ctx.restore();
    }
  }
  function xAt(time){
    if(time<bars[0].time)return 6+22*earlyTimes.indexOf(time);
    if(time>=last.time) {
      const x=positions.at(-1);
      return currentTime>last.time?x+(right-x-3)*Math.min(1,(time-last.time)/(currentTime-last.time)):x;
    }
    const next=bars.findIndex(b=>b.time>=time);
    if(next===0 || bars[next].time===time)return positions[next];
    return positions[next-1]+(positions[next]-positions[next-1])*(time-bars[next-1].time)/(bars[next].time-bars[next-1].time);
  }
  // Clip the guide through each plotted window, including its end points.
  // Never carry the stroke across the unplotted time gutter.
  for(const m of moves){
    const origin=marked[m.kind]===undefined?xAt(m.time):positions[marked[m.kind]];
    const segment=[origin,priceY(m.price),xAt(currentTime),priceY(model.currentPrice)];
    const targetX=segment[2],span=targetX-origin;
    let phase=null;
    if(panes.length>1 && span>85){
      // Select a visible section for the rocket or satellite. Its centre must
      // stay away from a folded date gutter even as the endpoint updates.
      const preferred=m.kind==='high'?.36:.68,wanted=origin+span*preferred;
      const fits=panes.map(p=>[Math.max(origin+34,p.left+22),Math.min(targetX-31,p.right-22)])
        .filter(([l,r])=>l<=r)
        .map(([l,r])=>Math.max(l,Math.min(r,wanted)));
      if(fits.length){
        const best=fits.reduce((a,b)=>Math.abs(a-wanted)<=Math.abs(b-wanted)?a:b);
        const factor=span/Math.hypot(span,segment[3]-segment[1]),scale=1.40;
        const inset=34*scale*factor,room=span-49*scale*factor;
        if(room>0)phase=Math.min(.92,Math.max(.08,(best-origin-inset)/room));
      }
    }
    ctx.save();ctx.beginPath();
    panes.forEach((p,i)=>{
      const l=i?p.left-4:-5,r=i===panes.length-1?right+6:p.right+4;
      ctx.rect(l,plotTop-8,r-l,plotBottom-plotTop+16);
    });
    ctx.clip();ctx.globalAlpha=.88;
    drawMoveTrail(ctx,{segment,kind:m.kind,theme,scale:1.40,phase});
    if(marked[m.kind]===undefined){
      ctx.fillStyle=moveTrailColor(m.kind,theme);ctx.beginPath();ctx.arc(origin,segment[1],3.6,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
  for(const i of new Set(Object.values(marked)))candle(bars[i],i,true);
  if(moves.length){
    ctx.fillStyle=colors.ink;ctx.strokeStyle=colors.page;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(xAt(currentTime),priceY(model.currentPrice),4.7,0,2*Math.PI);ctx.fill();ctx.stroke();
  }
  const breaks=panes.slice(1).map(p=>p.left-seam/2);
  if(earlyTimes.length)breaks.unshift(start-10);
  ctx.save();ctx.lineWidth=2.6;ctx.strokeStyle=ink;
  for(const x of breaks){
    for(const y of [volumeBottom+4,plotTop+9]){
      ctx.beginPath();
      for(const d of [-4,4]){ctx.moveTo(x+d-3,y);ctx.lineTo(x+d+3,y-10);}
      ctx.stroke();
    }
  }
  ctx.restore();
  const daily=model.side==='short' || bars.length>1 && windows.length===1 && last.time-bars[0].time>(bars.length-1)*12*3600000;
  const crossYear=new Intl.DateTimeFormat('en',{year:'numeric',timeZone:zone});
  const showYear=crossYear.format(bars[0].time)!==crossYear.format(last.time);
  const date=new Intl.DateTimeFormat(locale,{timeZone:zone,year:showYear?'numeric':undefined,month:'2-digit',day:'2-digit',...(daily?{}:{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})});
  if(panes.length===1){
    drawText(ctx,date.format(bars[0].time),start,dateTop,right*.47,25,colors.muted);
    if(bars.length>1)drawText(ctx,date.format(last.time),right,dateTop,right*.47,25,colors.muted,{align:'right'});
  }else{
    panes.forEach(p=>{
      const x=(p.left+p.right)/2,w=p.right-p.left+14;
      const dates=[date.format(p.part[0].time),date.format(p.part.at(-1).time)];
      drawText(ctx,dates[0],x,dateTop,w,24,colors.muted,{align:'center'});
      if(p.part.length>1)drawText(ctx,'→ '+dates[1],x,dateTop+31,w,24,colors.muted,{align:'center'});
    });
  }
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
  const windows=chartWindows(bars,model,moves);
  const folded=windows.length>1;
  const theme=model.theme==='light'?'light':'dark';
  const gapNote=[earlyTimes.length?copy[5]:'',folded?copy[6]:''].filter(Boolean).join(' · ');
  const gapLines=gapNote?wrapText(ctx,'//   '+gapNote,width,22):[];
  const notesTop=dateTop+(folded?74:45);
  const statTop=notesTop+gapLines.length*30+14;
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
    plot(context,model,windows,moves,{width,locale,zone,colors,theme,earlyTimes});
    gapLines.forEach((value,i)=>drawText(context,value,0,notesTop+i*30,width,23,colors.muted));
    paint.forEach(drawLine=>drawLine(context));
    context.restore();
  }
  return {height,draw};
}
