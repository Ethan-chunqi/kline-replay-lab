// The compact trade card draws the same frozen snapshot as the detailed poster.
import {drawText,measureText} from './share-poster-type.js?v=20261122-editorial';

const W=1080,H=1350,L=66,R=W-L,span=R-L;
const locales={zh:'zh-CN',en:'en-GB',ja:'ja-JP',ru:'ru-RU',ko:'ko-KR'};
const keys=['long','short','savings','roi','pnl','interest','buy','sell','customBuy','customSell','current','capital','margin','notional','buyTime','sellTime','start','end','balance','rate','candles','reference','fold','low','high','worth','bundle','sim','asOf','mark'];
const copy={
  zh:['做多','做空','理财','本金收益率','未实现盈亏','累计利息','低点买入价','高点卖出价','自定义买入价','自定义卖出价','当前价格','本金','开仓保证金','开仓金额','买入时间','卖出时间','起息时间','计息截至','当前本息','年化利率','K 线','行情对照','中段已折叠','低点反弹','高点回撤','盈亏购买力','配套服务','模拟持仓','报价时间','标记价格'],
  en:['Long','Short','Savings','Return on capital','Unrealized P&L','Interest earned','Buy at cycle low','Sell at cycle high','Custom buy price','Custom sell price','Current price','Capital','Opening margin','Entry notional','Bought at','Sold at','Interest start','Interest as of','Current balance','Annual rate','Candles','Market reference','Middle period folded','Rebound from low','Drawdown from high','Purchasing power','Bundle','Simulated position','Quote as of','Mark price'],
  ja:['ロング','ショート','資産運用','元本収益率','含み損益','累計利息','安値での買値','高値での売値','指定買値','指定売値','現在値','元本','当初証拠金','建玉金額','買付日時','売付日時','利息の起算日','利息計算時点','元利合計','年利','ローソク足','参考相場','中間の期間を省略','安値からの反発','高値からの下落','購買力換算','組み合わせ','シミュレーション','価格の時刻','マーク価格'],
  ru:['Лонг','Шорт','Сбережения','Доходность капитала','Нереализованная прибыль / убыток','Процентный доход','Покупка на минимуме','Продажа на максимуме','Своя цена покупки','Своя цена продажи','Текущая цена','Капитал','Начальная маржа','Объём при входе','Время покупки','Время продажи','Начало начисления','Проценты на','Текущий баланс','Годовая ставка','Свечи','Рыночный ориентир','Средний период свёрнут','Отскок от минимума','Снижение от максимума','Покупательная способность','Набор услуг','Симуляция позиции','Время котировки','Цена маркировки'],
  ko:['롱','숏','자산 관리','원금 수익률','미실현 손익','누적 이자','저점 매수가','고점 매도가','지정 매수가','지정 매도가','현재가','원금','개시 증거금','진입 금액','매수 시각','매도 시각','이자 시작일','이자 기준 시각','현재 원리금','연 수익률','캔들','시장 참고','중간 기간 생략','저점 대비 반등','고점 대비 하락','구매력 환산','패키지','모의 포지션','시세 시각','표시 가격'],
};
const themes={
  dark:{hero:'#0d2427',fade:'#06161b',page:'#102024',panel:'#193033',ink:'#f1f5ec',sub:'#b7c8c1',dim:'#99afa7',line:'#34494a',gain:'#9aefc4',loss:'#ffa4a5',gold:'#e8cd90',logo:'#123d37',up:'#78c7a6',down:'#d58186',etch:'#8dc9b6'},
  light:{hero:'#edf1e4',fade:'#dce7de',page:'#f9f9f1',panel:'#e8eddf',ink:'#122e2c',sub:'#3c5650',dim:'#516a61',line:'#c5d0c5',gain:'#126344',loss:'#a03349',gold:'#815a21',logo:'#c5e5ce',up:'#227a58',down:'#b24d60',etch:'#668e79'},
};

const images=new Map();
function loadImage(asset) {
  if(!images.has(asset)) {
    const task=new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=reject;
      img.src=new URL(asset,import.meta.url).href;
    });
    images.set(asset,task);
    task.catch(()=>images.delete(asset));
  }
  return images.get(asset);
}
function cover(ctx,img,x,y,w,h,r) {
  const scale=Math.max(w/img.naturalWidth,h/img.naturalHeight);
  const sw=w/scale,sh=h/scale;
  ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.clip();
  ctx.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)/2,sw,sh,x,y,w,h);
  ctx.restore();
}
function text(ctx,value,x,y,w,size,ink,weight=500,align='left') {
  return drawText(ctx,value,x,y,w,size,ink,{weight,align,min:Math.min(size,22)});
}
function line(ctx,x1,y1,x2,y2,color) {
  ctx.strokeStyle=color;ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
}
// Concentric etched dorsal fins form an original watermark. Keep the type area quiet.
function engraving(ctx,c) {
  ctx.save();ctx.beginPath();ctx.rect(0,0,W,646);ctx.clip();
  ctx.translate(912,403);ctx.rotate(-.17);
  ctx.strokeStyle=c.etch;ctx.lineWidth=1.45;
  for(let i=0;i<29;i++) {
    ctx.save();
    const scale=.31+i*.046;
    ctx.scale(scale,scale);
    ctx.globalAlpha=.48-i*.009;
    ctx.beginPath();ctx.moveTo(-198,89);
    ctx.bezierCurveTo(-96,55,8,-56,72,-186);
    ctx.bezierCurveTo(103,-151,84,-83,82,-31);
    ctx.bezierCurveTo(79,48,129,74,190,89);
    ctx.bezierCurveTo(88,122,-63,108,-198,89);
    ctx.closePath();ctx.stroke();ctx.restore();
  }
  ctx.restore();
}
function badge(ctx,value,x,y,color,background) {
  const w=Math.min(292,Math.ceil(measureText(ctx,value,30,650))+44);
  ctx.beginPath();ctx.roundRect(x,y,w,52,11);ctx.fillStyle=background;ctx.fill();
  text(ctx,value,x+w/2,y+8,w-20,30,color,660,'center');
  return w;
}
function amountLine(ctx,label,value,y,c) {
  const labelWidth=Math.min(310,measureText(ctx,label,27,530));
  text(ctx,label,L,y+9,labelWidth+1,27,c.sub,530);
  text(ctx,value,L+labelWidth+22,y,span-labelWidth-22,43,c.ink,630);
}
function pair(ctx,label,value,x,y,w,c) {
  text(ctx,label,x,y,w,25,c.dim,560);
  text(ctx,value,x,y+38,w,41,c.ink,640);
}
function ledgerLine(ctx,label,value,y,c) {
  const width=Math.min(span*.45,measureText(ctx,label,25,520)+5);
  text(ctx,label,L,y,width,25,c.dim,520);
  text(ctx,value,R,y-3,span-width-30,29,c.ink,590,'right');
}
function sampleRows(input,cutoff) {
  const valid=new Map();
  for(const b of input||[]) {
    if(!b || ![b.time,b.open,b.close,b.high,b.low].every(Number.isFinite) ||
       b.time>cutoff || b.low>Math.min(b.open,b.close) || b.high<Math.max(b.open,b.close))continue;
    valid.set(b.time,b);
  }
  return [...valid.values()].sort((a,b)=>a.time-b.time);
}
function miniChart(ctx,model,t,c,saving,short) {
  const rows=sampleRows(model.bars,model.chartAsOf??model.currentTime??Infinity);
  if(!rows.length)return;
  const active=(model.moves||[]).find(m=>m.kind===(short?'high':'low'));
  const breakIndex=rows.findIndex(b=>b.time===model.breakAfter)+1;
  const hasGap=breakIndex>0 && breakIndex<rows.length;
  const heading=[saving?t.reference:null,saving?model.symbol:null,model.interval,t.candles].filter(Boolean).join(' · ');
  const detail=saving?'':active?.percentText?[short?t.high:t.low,active.percentText].join('  '):'';
  const label=[hasGap?t.fold:null,detail].filter(Boolean).join('  ·  ');
  text(ctx,heading,L,794,label?span*.48:span,24,c.sub,580);
  if(label)text(ctx,label,R,794,span*.5,24,c.sub,560,'right');

  const y=839,height=101,bottom=y+height,width=span-4;
  const endpoint=Number.isFinite(model.currentPrice) && Number.isFinite(model.currentTime)?model.currentPrice:null;
  const anchor=saving||!active||endpoint===null?-1:rows.findIndex(b=>b.time===model.extremeTimes?.[active.kind] && b[active.kind]===active.price);
  const min=Math.min(...rows.map(b=>b.low),anchor<0?Infinity:endpoint),max=Math.max(...rows.map(b=>b.high),anchor<0?-Infinity:endpoint);
  const padding=Math.max((max-min)*.05,Math.abs(max)*1e-8,1e-12);
  const py=price=>y+(max+padding-price)/(max-min+2*padding)*height;
  const gap=hasGap?24:0,step=(width-gap)/rows.length;
  const px=i=>L+2+step*(i+.5)+(hasGap && i>=breakIndex?gap:0);
  ctx.save();
  ctx.strokeStyle=c.line;ctx.setLineDash([2,7]);
  for(const p of [y+height*.25,y+height*.75]){ctx.beginPath();ctx.moveTo(L,p);ctx.lineTo(R,p);ctx.stroke();}
  ctx.setLineDash([]);
  const extremes=Object.entries(model.extremeTimes||{}).map(([kind,time])=>({kind,time,price:model.moves?.find(move=>move.kind===kind)?.price}));
  for(const [i,b] of rows.entries()) {
    const mark=extremes.some(e=>e.time===b.time && (e.price===undefined || e.price===b[e.kind]));
    const tone=mark?'#ffd83d':b.close>=b.open?c.up:c.down;
    ctx.strokeStyle=mark?c.gold:tone;ctx.fillStyle=tone;ctx.lineWidth=mark?2.4:Math.min(2,step*.56);
    const x=px(i),body=Math.min(step*.69,16);
    ctx.beginPath();ctx.moveTo(x,py(b.high));ctx.lineTo(x,py(b.low));ctx.stroke();
    ctx.fillRect(x-body/2,Math.min(py(b.open),py(b.close)),body,Math.max(Math.min(1.6,body),Math.abs(py(b.open)-py(b.close))));
  }
  if(anchor>=0) {
    const x1=px(anchor),y1=py(active.price),x2=model.currentTime>rows.at(-1).time?R:px(rows.length-1),y2=py(endpoint);
    const tint=short?c.loss:c.gain;
    ctx.lineWidth=3;ctx.strokeStyle=tint;ctx.globalAlpha=.72;
    if(short)ctx.setLineDash([7,5]);
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    ctx.setLineDash([]);ctx.globalAlpha=1;
    for(const [x,v,color] of [[x1,y1,'#ffdb4b'],[x2,y2,tint]]) {
      ctx.beginPath();ctx.arc(x,v,4.0,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
    }
  }
  if(hasGap){
    const x=(px(breakIndex-1)+px(breakIndex))/2;
    ctx.setLineDash([3,5]);ctx.strokeStyle=c.dim;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,bottom-8);ctx.stroke();ctx.setLineDash([]);
    for(const dx of [-4,3])line(ctx,x+dx,bottom,x+dx+4,bottom-7,c.dim);
  }
  ctx.restore();
}
// Prefer the catalog’s own phrase separators. Otherwise balance whole words, so
// narrow quantities never leave a lone character on the second line.
function serviceLines(ctx,title,width,lang) {
  const s=String(title||'').trim();
  if(measureText(ctx,s,29,620)<=width)return [s];
  const dividers=[...s.matchAll(/\s+(?=[·｜|]\s*)/gu)].map(m=>m.index);
  const boundaries=typeof Intl.Segmenter==='function'
    ?[...new Intl.Segmenter(locales[lang],{granularity:'word'}).segment(s)].map(e=>e.index)
    :[...s.matchAll(/\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)].map(m=>m.index);
  let best=null,score=Infinity;
  for(const i of [...new Set([...dividers,...boundaries])]) {
    const a=s.slice(0,i).trimEnd(),b=s.slice(i).trimStart();
    if(!a||!b||/^[.,:;，。：；、）)〉》]/u.test(b)||/[（(〈《]$/u.test(a))continue;
    const aw=measureText(ctx,a,29,620),bw=measureText(ctx,b,29,620);
    const cost=Math.max(0,aw-width,bw-width)*4 + Math.abs(aw-bw)*.3 - (dividers.includes(i)?width*.50:0);
    if(cost<score){best=[a,b];score=cost;}
  }
  return best||[s];
}
function service(ctx,model,item,art,qr,t,c) {
  const y=1158;
  ctx.fillStyle=c.panel;ctx.fillRect(0,y,W,123);
  let left=L;
  if(item && art){cover(ctx,art,L,y+18,87,87,12);left+=108;}
  const max=R-132-left;
  if(item){
    const bundle=model.mode==='bundle';
    const heading=[t.worth,bundle?t.bundle+' · '+model.services.length:null].filter(Boolean).join('   /   ');
    const amount=item.amountText;
    const amountRoom=amount?Math.min(max*.54,measureText(ctx,amount,21,560)+4):0;
    text(ctx,heading,left,y+19,max-amountRoom-(amount?15:0),22,c.dim,550);
    if(amount)text(ctx,amount,R-132,y+19,amountRoom,21,c.sub,560,'right');
    const quantityWidth=Math.min(max*.36,measureText(ctx,item.quantityText||'',34,650)+3);
    const quantity=item.quantityText;
    const quantitySpace=quantity?quantityWidth+22:0;
    const titleRoom=max-quantitySpace;
    const lines=serviceLines(ctx,item.title,titleRoom,Object.hasOwn(copy,model.lang)?model.lang:'zh');
    if(lines.length<=1)text(ctx,item.title,left,y+55,titleRoom,33,c.ink,620);
    else {
      text(ctx,lines[0],left,y+48,titleRoom,29,c.ink,620);
      text(ctx,lines[1],left,y+80,titleRoom,29,c.ink,620);
    }
    if(quantity)text(ctx,quantity,R-132,y+55,quantityWidth,34,c.gold,650,'right');
  } else {
    text(ctx,'Bulls & Bears',L,y+19,max,36,c.ink,670);
    text(ctx,'@LiuShaYu2026',L,y+65,max,25,c.sub,520);
  }
  if(qr) {
    const size=94,x=R-size,top=y+15;
    ctx.fillStyle='#fff';ctx.fillRect(x-3,top-3,size+6,size+6);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,x,top,size,size);ctx.imageSmoothingEnabled=true;
  }
  if(model.asOfText && !['savings','bank'].includes(model.side)) {
    text(ctx,t.asOf,L,1290,span*.63,19,c.dim,520);
    text(ctx,model.asOfText,L,1314,span*.63,24,c.sub,560);
    text(ctx,t.sim,R,1290,span*.34,19,c.dim,520,'right');
    text(ctx,'@LiuShaYu2026',R,1314,span*.34,24,c.sub,590,'right');
  } else {
    text(ctx,t.sim,L,1300,span*.45,22,c.dim,530);
    text(ctx,'@LiuShaYu2026',R,1298,span*.52,25,c.sub,600,'right');
  }
}

export async function renderTradeCard(model) {
  const lang=Object.hasOwn(copy,model.lang)?model.lang:'zh';
  const t=Object.fromEntries(keys.map((key,i)=>[key,copy[lang][i]]));
  const c=themes[model.theme]||themes.dark,saving=['savings','bank'].includes(model.side),short=model.side==='short';
  const item=model.services?.[0];
  const [avatar,art,qr]=await Promise.all([
    loadImage('./brand/liushayu-avatar.jpg').catch(()=>null),
    item && /^[\w-]+$/.test(item.id)?loadImage('./equivalents/art/'+item.id+'.webp').catch(()=>null):null,
    model.qrImage || loadImage('./brand/share-qr.png').catch(()=>null),document.fonts?.load('680 32px Geist'),
  ]);
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Canvas unavailable');
  ctx.fillStyle=c.page;ctx.fillRect(0,0,W,H);
  const gradient=ctx.createLinearGradient(0,40,W,550);
  gradient.addColorStop(0,c.fade);gradient.addColorStop(1,c.hero);
  ctx.fillStyle=gradient;ctx.fillRect(0,0,W,646);
  engraving(ctx,c);
  // A clean masthead and broad figure column keep the numbers visible over the engraving.
  if(avatar)cover(ctx,avatar,L,45,49,49,25);
  text(ctx,'刘鲨鱼',avatar?L+66:L,47,260,34,c.ink,690);
  ctx.save();ctx.letterSpacing='3px';text(ctx,'BULLS & BEARS',R,58,410,24,c.sub,610,'right');ctx.restore();
  line(ctx,L,122,R,122,c.line);
  text(ctx,saving?t.savings:model.symbol,L,160,span,76,c.ink,675);
  const side=saving?t.rate:short?t.short:t.long;
  const fact=saving?model.annualRateText:(model.lotsText||model.leverageText);
  const sideColor=saving?c.gold:model.sideColor?'color-mix(in srgb,'+model.sideColor+' 64%, '+c.ink+')':short?c.loss:c.gain;
  const badgeFill=model.theme==='light'?'rgba(35,79,61,.09)':'rgba(178,222,201,.10)';
  const flag=badge(ctx,side,L,265,sideColor,badgeFill);
  const factWidth=fact?Math.min(300,measureText(ctx,fact,34,625)+3):0;
  if(fact)text(ctx,fact,L+flag+18,271,factWidth,34,c.ink,625);
  if(!saving && model.market)text(ctx,model.market,R,275,span-flag-factWidth-70,27,c.sub,555,'right');
  const outcome=model.pnl>0?c.gain:model.pnl<0?c.loss:c.ink;
  text(ctx,t.roi,L,366,span,31,c.sub,510);
  ctx.save();ctx.letterSpacing='-5px';
  text(ctx,model.roiText,L-6,399,span,153,outcome,660);ctx.restore();
  amountLine(ctx,saving?t.interest:t.pnl,model.pnlText,568,c);
  line(ctx,L,646,R,646,c.line);

  const col=(span-109)/2,right=R-col;
  const entryLabel=short?(model.entryKind==='custom'?t.customSell:t.sell):(model.entryKind==='custom'?t.customBuy:t.buy);
  pair(ctx,saving?t.capital:entryLabel,saving?model.capitalText:model.entryPriceText,L,679,col,c);
  pair(ctx,saving?t.balance:t.current,saving?model.balanceText:model.priceText,right,679,col,c);
  line(ctx,W/2-22,738,W/2+22,738,c.dim);line(ctx,W/2+12,729,W/2+22,738,c.dim);line(ctx,W/2+12,747,W/2+22,738,c.dim);
  miniChart(ctx,model,t,c,saving,short);
  line(ctx,L,965,R,965,c.line);
  if(saving) {
    if(model.entryTimeText)ledgerLine(ctx,t.start,model.entryTimeText,1001,c);
    if(Number.isFinite(model.asOf)){
      const date=new Intl.DateTimeFormat(locales[lang],{timeZone:model.timeZone||'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'}).format(model.asOf);
      ledgerLine(ctx,t.end,date,1080,c);
    }
  } else {
    pair(ctx,model.lotsText?t.margin:t.capital,model.capitalText,L,984,col,c);
    pair(ctx,t.notional,model.entryNotionalText,right,984,col,c);
    if(model.entryTimeText)ledgerLine(ctx,short?t.sellTime:t.buyTime,model.entryTimeText,1075,c);
    if(model.markPriceText && model.markPriceText!==model.priceText)ledgerLine(ctx,model.markLabel||t.mark,model.markPriceText,1116,c);
  }
  service(ctx,model,item,art,qr,t,c);
  return canvas;
}
