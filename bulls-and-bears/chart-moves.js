import {drawMoveTrail,moveTrailColor} from './move-trails.js?v=20261122-trails';

export function movesForInterval(moves,interval) {
  return interval==='1d'?moves:moves.filter(move=>move.kind==='low');
}

// A move joins the certified extreme to the timestamped quote. When available
// candles cover only part of that span, draw only that part of the line.
const labels={
  zh:['低点反弹','高点回撤','成交量'], en:['From low','From high','Vol.'],
  ja:['安値から','高値から','出来高'], ru:['От минимума','От максимума','Объём'],
  ko:['저점 대비','고점 대비','거래량'],
};
function indexAt(rows,time,width) {
  let a=0,b=rows.length;
  while(a<b) {
    const m=Math.floor((a+b)/2);
    if(rows[m].epoch<=time)a=m+1;else b=m;
  }
  const i=Math.max(0,a-1), next=rows[i+1];
  if(!next || time<rows[i].epoch+width)return i;
  // Do not pretend a missing candle exists. Times between two loaded bars
  // retain their relative positions on that compressed trading-time axis.
  return i+(time-rows[i].epoch)/(next.epoch-rows[i].epoch);
}

export function moveSpan(rows,move,quote,width,endOnLast,matchIndex) {
  const first=rows[0],last=rows.at(-1);
  if(!first || !Number.isFinite(move.price) || !Number.isSafeInteger(move.time) ||
     !Number.isSafeInteger(quote.time) || !Number.isFinite(quote.price) ||
     move.time>quote.time || quote.time<first.epoch || move.time>last.epoch && !endOnLast)return null;
  // A coarse, date-only high/low can be plotted by date; the existing gold
  // marker remains exclusive to a proven, price-matching candle.
  const lower=Math.max(first.epoch,move.time), upper=Math.min(quote.time,endOnLast?quote.time:last.epoch);
  if(lower>upper)return null;
  const duration=quote.time-move.time;
  const priceAt=t=>duration>0 ? move.price+(quote.price-move.price)*(t-move.time)/duration : quote.price;
  return {
    start: {index:matchIndex>=0?matchIndex:indexAt(rows,lower,width),price:priceAt(lower)},
    end: {index:endOnLast?rows.length-1:indexAt(rows,upper,width),price:priceAt(upper)},
    actualEnd:upper===quote.time,
  };
}

// Clip against all four edges so off-screen anchors keep their true angle.
export function clipSegment(x0,y0,x1,y1,w,h) {
  if(![x0,y0,x1,y1].every(Number.isFinite))return null;
  const dx=x1-x0,dy=y1-y0;
  let lo=0,hi=1;
  for(const [p,q] of [[-dx,x0],[dx,w-x0],[-dy,y0],[dy,h-y0]]) {
    if(p===0){if(q<0)return null;continue;}
    const t=q/p;
    if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
    if(lo>hi)return null;
  }
  return [x0+dx*lo,y0+dy*lo,x0+dx*hi,y0+dy*hi];
}

function fitText(ctx,value,max) {
  if(ctx.measureText(value).width<=max)return value;
  let end=value.length;
  while(end && ctx.measureText(value.slice(0,end)+'…').width>max)end--;
  return value.slice(0,end)+'…';
}

function paintLabel(ctx,size,{segment,move,color},theme,locale,occupied) {
  const [x0,y0,x1,y1]=segment;
  const compact=size.width<430, words=labels[locale]||labels.en;
  const font='system-ui, sans-serif';
  const head=words[move.kind==='low'?0:1]+'  '+move.percentText;
  const meta=[move.durationText,move.volumeText && (words[2]+' '+move.volumeText)].filter(Boolean);
  const textWidth=Math.max(10,Math.min(compact?158:238,size.width-18));
  ctx.font='600 11px '+font;
  const title=fitText(ctx,head,textWidth);
  const headWidth=ctx.measureText(title).width;
  ctx.font='10px '+font;
  const lines=(compact?meta:[meta.join(' · ')]).filter(Boolean).map(t=>fitText(ctx,t,textWidth));
  const w=Math.min(size.width-4,Math.ceil(Math.max(headWidth,...lines.map(t=>ctx.measureText(t).width)))+12);
  const h=18+lines.length*13;
  const x=Math.max(2,Math.min(size.width-w-2,x0+(x1-x0)*(move.kind==='low'?.18:.48)-w/3));
  const lineY=y0+(y1-y0)*(move.kind==='low'?.18:.48);
  const bound=y=>Math.max(2,Math.min(size.height-h-2,y));
  let y=bound(move.kind==='low'?lineY+6:lineY-h-6);
  if(occupied && x<occupied.x+occupied.w+3 && x+w>occupied.x-3 && y<occupied.y+occupied.h+3 && y+h>occupied.y-3){
    const below=occupied.y+occupied.h+3,above=occupied.y-h-3;
    y=bound(below+h<=size.height-2?below:above);
  }
  ctx.fillStyle=theme==='light'?'rgba(255,255,255,.94)':'rgba(24,26,32,.93)';
  ctx.beginPath();ctx.roundRect(x,y,w,h,4);ctx.fill();
  ctx.fillStyle=color;ctx.fillRect(x,y+3,2,h-6);
  ctx.font='600 11px '+font;ctx.fillText(title,x+6,y+13);
  ctx.fillStyle=theme==='light'?'#3e4a5b':'#c9d0dc';
  ctx.font='10px '+font;lines.forEach((s,i)=>ctx.fillText(s,x+6,y+26+i*13));
  return {x,y,w,h};
}

export function drawMoves({ctx,size,rows,matches,view,currentOnLast,width,scale,series,phase=null}) {
  if(!rows.length || !view.moves?.length || size.width<55 || size.height<50)return false;
  const quote={time:view.currentTime,price:view.currentPrice};
  const visible=[];
  ctx.save();ctx.beginPath();ctx.rect(0,0,size.width,size.height);ctx.clip();
  for(const move of movesForInterval(view.moves,view.interval)) {
    if(move.kind!=='low' && move.kind!=='high')continue;
    const span=moveSpan(rows,move,quote,width,currentOnLast,matches[move.kind]);
    if(!span)continue;
    const x0=scale.logicalToCoordinate(span.start.index),y0=series.priceToCoordinate(span.start.price);
    const x1=scale.logicalToCoordinate(span.end.index),y1=series.priceToCoordinate(span.end.price);
    const segment=clipSegment(x0,y0,x1,y1,size.width,size.height);
    if(!segment)continue;
    const color=moveTrailColor(move.kind,view.theme);
    const offsetPhase=phase==null?null:(phase+(move.kind==='high'?.26:0))%1;
    drawMoveTrail(ctx,{segment,kind:move.kind,theme:view.theme,phase:offsetPhase,compact:size.width<430});
    if(span.actualEnd && x1>=0 && x1<=size.width && y1>=0 && y1<=size.height){
      ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.fillStyle=view.theme==='light'?'#fff':'#181a20';
      ctx.beginPath();ctx.arc(x1,y1,3.1,0,2*Math.PI);ctx.fill();ctx.stroke();
    }
    visible.push({segment,move,color});
  }
  let occupied;
  for(const item of visible)occupied=paintLabel(ctx,size,item,view.theme,view.locale,occupied);
  ctx.restore();
  return visible.some(({segment:[x0,y0,x1,y1]})=>Math.hypot(x1-x0,y1-y0)>32);
}
