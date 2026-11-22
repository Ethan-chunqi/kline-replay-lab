import {drawMoveTrail,drawRocketAt,moveTrailColor} from './move-trails.js?v=20261122-editorial';
import {drawText,measureText,rule} from './share-poster-type.js?v=20261122-editorial';

const W=1280,H=720,QUARTER=900000;
const language={
  zh:['15 分钟 · K 线','低点反弹','买入低点','现价','低点时间','报价时间','中间时段已折叠','低点在所示 K 线之前'],
  en:['15-minute candles','Rebound from low','Buy at low','Current','Time of low','Quote time','Intervening dates are folded','Low precedes the first candle'],
  ja:['15分足','安値からの反発','安値で買付','現在値','安値の時刻','価格の時刻','途中の期間を省略','安値は表示期間より前'],
  ru:['15-минутные свечи','Отскок от минимума','Покупка на минимуме','Сейчас','Время минимума','Время котировки','Средняя часть периода свёрнута','Минимум до первой свечи'],
  ko:['15분봉','저점 대비 반등','저점 매수','현재가','저점 시각','시세 시각','중간 기간 생략','저점은 첫 봉 이전'],
};
const localeIds={zh:'zh-CN',en:'en-US',ja:'ja-JP',ru:'ru-RU',ko:'ko-KR'};
const palette={
  dark:{page:'#09181e',second:'#10272a',ink:'#edf7f1',soft:'#bdd0ca',mute:'#92aaa7',grid:'#294145',gold:'#ffe040',goldEdge:'#fff3aa',up:'#50cf99',down:'#e57f83',dot:'#062b27'},
  light:{page:'#f7f8f3',second:'#edf3ed',ink:'#142d2e',soft:'#354e50',mute:'#526a68',grid:'#cbd8ce',gold:'#ffe139',goldEdge:'#8f6414',up:'#1b8a68',down:'#c9515b',dot:'#fff'},
};
const toMs=value=>Math.abs(value)<1e11?value*1000:value;
const clamp=n=>Math.max(0,Math.min(1,n));
const ease=n=>n*n*(3-2*n);

function layer(canvas) {
  const image=canvas.ownerDocument?.createElement('canvas')||new OffscreenCanvas(W,H);
  image.width=W;image.height=H;
  return image;
}

function pill(ctx,label,x,y,color,textColor,align,maxWidth=178) {
  const font=21,pad=12,h=37;
  const w=Math.min(maxWidth,Math.ceil(measureText(ctx,label,font,650))+2*pad);
  const left=align==='right'?x-w:x;
  ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(left,y,w,h,6);ctx.fill();
  drawText(ctx,label,left+w/2,y+6,w-2*pad,font,textColor,{weight:650,align:'center'});
}

// All frames share the immutable candles, market prices, axes and timestamps.
// Only the reveal mask and the graphic travelling between measured endpoints change.
export function createRocketScene(canvas,model) {
  const low=(model.moves||[]).find(m=>m.kind==='low');
  const now=toMs(model.currentTime??model.chartAsOf),price=model.currentPrice;
  if(!low || !Number.isFinite(now) || !Number.isFinite(price) ||
     !Number.isFinite(low.price) || !Number.isFinite(low.time) || toMs(low.time)>now)throw Error('Missing rebound endpoints');
  const rows=new Map();
  for(const bar of model.bars||[]) {
    const t=toMs(bar.time);
    if(![t,bar.open,bar.high,bar.low,bar.close].every(Number.isFinite) || t>now ||
       bar.low>Math.min(bar.open,bar.close) || bar.high<Math.max(bar.open,bar.close))continue;
    rows.set(t,{...bar,time:t});
  }
  const bars=[...rows.values()].sort((a,b)=>a.time-b.time);
  if(!bars.length)throw Error('Missing 15-minute candles');
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw Error('Canvas unavailable');

  const lang=Object.hasOwn(language,model.lang)?model.lang:'zh',loc=localeIds[lang],word=language[lang];
  const theme=model.theme==='light'?'light':'dark',c=palette[theme],trace=moveTrailColor('low',theme);
  const quotes=new Intl.NumberFormat(loc,{maximumFractionDigits:Math.max(0,Math.min(8,model.priceDigits??2))});
  const dates=new Intl.DateTimeFormat(loc,{timeZone:model.timeZone||'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const left=60,axisRight=W-60,chartTop=148,chartBottom=543,volBase=587;
  const highest=Math.max(price,low.price,...bars.map(b=>b.high)),lowest=Math.min(price,low.price,...bars.map(b=>b.low));
  const margin=Math.max((highest-lowest)*.055,Math.abs(price)*1e-7,1e-12);
  const maxP=highest+margin,minP=lowest-margin;
  const py=p=>chartTop+(maxP-p)/(maxP-minP)*(chartBottom-chartTop);
  const ticks=highest===lowest?[highest]:Array.from({length:4},(_,i)=>highest-(highest-lowest)*i/3);
  const axisSize=Math.min(165,Math.max(95,...ticks.map(n=>measureText(ctx,quotes.format(n),18)+24)));
  const chartRight=axisRight-axisSize,first=bars[0],last=bars.at(-1);
  const outside=toMs(low.time)<first.time;
  const breakAt=Number.isFinite(model.breakAfter)?bars.findIndex(b=>b.time===model.breakAfter)+1:0;
  const gap=breakAt>0 && breakAt<bars.length?40:0,openSpace=outside?76:0;
  const endsInLast=now>=last.time && now<last.time+QUARTER;
  const space=(chartRight-left-openSpace-gap)/(bars.length+(endsInLast?0:1));
  const cx=i=>left+openSpace+(i+.5)*space+(gap && i>=breakAt?gap:0);
  const quoteX=endsInLast?cx(bars.length-1):chartRight-2;
  const mark=bars.findIndex(b=>b.time===model.extremeTimes?.low && b.low===low.price);
  const lowTime=toMs(low.time);
  // When the supplied extreme has finer precision than its candle we can use
  // its matching wick. Otherwise place the timestamp by its real trading slot.
  const slot=bars.findIndex(b=>b.time<=lowTime && lowTime<b.time+QUARTER);
  let lowX=left+5;
  if(mark>=0)lowX=cx(mark);
  else if(slot>=0)lowX=cx(slot);
  else if(!outside) {
    const later=bars.findIndex(b=>b.time>lowTime);
    if(later>0) {
      const i=later-1;
      lowX=cx(i)+(cx(later)-cx(i))*(lowTime-bars[i].time)/(bars[later].time-bars[i].time);
    } else lowX=quoteX;
  }
  const lowY=py(low.price),quoteY=py(price),angle=Math.atan2(quoteY-lowY,quoteX-lowX);
  const trackLength=Math.hypot(quoteX-lowX,quoteY-lowY);
  const bg=layer(canvas),background=bg.getContext('2d'),candles=layer(canvas),candlesCtx=candles.getContext('2d');
  const backdrop=background.createLinearGradient(180,H,W,34);backdrop.addColorStop(0,c.page);backdrop.addColorStop(1,c.second);
  background.fillStyle=backdrop;background.fillRect(0,0,W,H);
  drawText(background,model.symbol||'',left,32,710,52,c.ink,{weight:740});
  drawText(background,[word[0],model.market].filter(Boolean).join('   /   '),left,94,835,22,c.soft,{weight:560});
  rule(background,left,130,axisRight-left,c.grid);
  for(const tick of ticks) {
    const y=py(tick);
    background.save();background.strokeStyle=c.grid;background.lineWidth=1.3;background.setLineDash([3,7]);
    background.beginPath();background.moveTo(left,y);background.lineTo(chartRight,y);background.stroke();background.restore();
    if(Math.abs(y-quoteY)>21)drawText(background,quotes.format(tick),axisRight,y-10,axisSize-5,18,c.mute,{align:'right'});
  }
  const size=Math.max(.65,Math.min(15,space*.68)),maxVol=Math.max(0,...bars.map(b=>b.volume||0));
  function candle(target,bar,i) {
    const x=cx(i),gold=i===mark;
    const color=gold?c.gold:bar.close>=bar.open?(model.chartUpColor||c.up):(model.chartDownColor||c.down);
    const top=Math.min(py(bar.open),py(bar.close)),h=Math.max(Math.min(size,2),Math.abs(py(bar.open)-py(bar.close)));
    target.save();
    if(gold){target.shadowColor='#ffe03a';target.shadowBlur=8;}
    target.strokeStyle=gold?c.goldEdge:color;target.lineWidth=gold?2.4:Math.min(2,space*.45);
    target.beginPath();target.moveTo(x,py(bar.high));target.lineTo(x,py(bar.low));target.stroke();
    target.fillStyle=color;target.fillRect(x-size/2,top,size,h);
    if(gold){target.lineWidth=1.25;target.strokeRect(x-size/2,top,size,h);}
    target.restore();
    if(bar.volume>0 && maxVol>0) {
      const height=27*bar.volume/maxVol;
      target.save();target.fillStyle=color;target.globalAlpha=.49;target.fillRect(x-size/2,volBase-height,size,height);target.restore();
    }
  }
  bars.forEach((bar,i)=>candle(candlesCtx,bar,i));
  const breaks=[];
  if(outside)breaks.push(left+openSpace-15);
  if(gap)breaks.push((cx(breakAt-1)+cx(breakAt))/2);
  for(const center of breaks) {
    background.strokeStyle=c.mute;background.lineWidth=2;background.beginPath();
    for(const d of [-3,4]){background.moveTo(center+d,volBase);background.lineTo(center+d+4,volBase-13);}
    background.stroke();
  }
  const firstStamp=dates.format(first.time),lastStamp=dates.format(last.time);
  drawText(background,firstStamp,left+openSpace,600,300,19,c.mute);
  if(bars.length>1)drawText(background,lastStamp,chartRight,600,300,19,c.mute,{align:'right'});
  if(outside||gap)drawText(background,[outside?word[7]:'',gap?word[6]:''].filter(Boolean).join(' · '),
    (left+chartRight)/2,600,460,18,c.soft,{align:'center'});
  rule(background,left,639,axisRight-left,c.grid);
  drawText(background,word[4],left,653,550,17,c.mute);
  drawText(background,model.lowTimeText||dates.format(lowTime),left,677,560,21,c.ink,{weight:560});
  drawText(background,word[5],axisRight,653,550,17,c.mute,{align:'right'});
  drawText(background,model.asOfText||dates.format(now),axisRight,677,560,21,c.ink,{weight:560,align:'right'});

  return function drawFrame(progress) {
    const p=clamp(Number.isFinite(progress)?progress:0),travel=ease(clamp((p-.10)/.73));
    const tipX=lowX+(quoteX-lowX)*travel,tipY=lowY+(quoteY-lowY)*travel;
    ctx.drawImage(bg,0,0);
    let count=0;
    while(count<bars.length && cx(count)<=tipX+.5)count++;
    if(count) {
      const edge=count===bars.length?W:Math.min(W,Math.ceil(cx(count-1)+size/2+2));
      ctx.drawImage(candles,0,0,edge,H,0,0,edge,H);
    }
    ctx.save();ctx.beginPath();ctx.rect(left-10,chartTop-10,chartRight-left+20,chartBottom-chartTop+23);ctx.clip();
    if(travel>0)drawMoveTrail(ctx,{segment:[lowX,lowY,tipX,tipY],kind:'low',theme,scale:1.55,craft:false});
    if(trackLength>22) {
      const scale=Math.min(2.35,Math.max(1,trackLength/225));
      // Hold the craft at the recorded current price. A gentle tail-off leaves
      // the destination and wick visible on the last held frame.
      const settle=ease(clamp((p-.83)/.11));
      ctx.globalAlpha=1-settle*.63;
      drawRocketAt(ctx,{x:tipX,y:tipY,angle,scale,pulse:Math.sin(p*53)});
      ctx.globalAlpha=1;
    }
    ctx.restore();
    if(mark>=0)candle(ctx,bars[mark],mark);
    ctx.fillStyle=c.gold;ctx.strokeStyle=c.dot;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(lowX,lowY,4.7,0,Math.PI*2);ctx.fill();ctx.stroke();
    const lowLabel=word[2]+'  '+(model.lowPriceText||quotes.format(low.price));
    const lowWidth=Math.min(300,measureText(ctx,lowLabel,19,600)+18);
    const labelX=Math.max(left,Math.min(chartRight-lowWidth,lowX-8));
    const labelY=Math.min(volBase-47,lowY+13);
    ctx.save();ctx.strokeStyle=c.goldEdge;ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(lowX,lowY+5);ctx.lineTo(lowX,labelY);ctx.stroke();ctx.restore();
    ctx.fillStyle=c.page;ctx.globalAlpha=.86;ctx.beginPath();ctx.roundRect(labelX,labelY,lowWidth,29,4);ctx.fill();ctx.globalAlpha=1;
    drawText(ctx,lowLabel,labelX+8,labelY+3,lowWidth-15,19,c.ink,{weight:600});
    const arrive=ease(clamp((p-.69)/.14));
    if(arrive>0) {
      ctx.save();ctx.globalAlpha=arrive;
      drawText(ctx,word[1],axisRight,25,375,21,c.soft,{align:'right',weight:560});
      drawText(ctx,low.percentText,axisRight,49,375,63,trace,{align:'right',weight:700});
      if(travel===1){
        ctx.strokeStyle=trace;ctx.lineWidth=1.3;ctx.setLineDash([3,4]);
        ctx.beginPath();ctx.moveTo(quoteX,quoteY);ctx.lineTo(axisRight-axisSize+8,quoteY);ctx.stroke();
        ctx.setLineDash([]);ctx.fillStyle=c.ink;ctx.beginPath();ctx.arc(quoteX,quoteY,4.8,0,Math.PI*2);ctx.fill();
        const quoteTag=quotes.format(price);
        pill(ctx,quoteTag,axisRight,quoteY-18,trace,c.dot,'right',axisSize+3);
        drawText(ctx,word[3],axisRight,quoteY+23,axisSize,16,c.soft,{align:'right'});
      }
      ctx.restore();
    }
  };
}
