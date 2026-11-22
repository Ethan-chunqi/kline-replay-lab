// A standalone P&L card, rendered from the position snapshot frozen by the share dialog.
import {drawText,measureText} from './share-poster-type.js?v=20261122-editorial';

const W=1080,H=1350,L=72,R=W-L,span=R-L;
const locales={zh:'zh-CN',en:'en-GB',ja:'ja-JP',ru:'ru-RU',ko:'ko-KR'};
const keys=['long','short','savings','roi','pnl','interest','buy','sell','customBuy','customSell','current','capital','margin','notional','buyTime','sellTime','start','end','balance','rate','sim','savingSim','asOf','mark'];
const copy={
  zh:['做多','做空','理财','本金收益率','未实现盈亏','累计利息','低点买入价','高点卖出价','自定义买入价','自定义卖出价','当前价格','本金','开仓保证金','开仓金额','买入时间','卖出时间','起息时间','计息截至','当前本息','年化利率','模拟持仓','模拟理财','报价时间','标记价格'],
  en:['Long','Short','Savings','Return on capital','Unrealized P&L','Interest earned','Buy at cycle low','Sell at cycle high','Custom buy price','Custom sell price','Current price','Capital','Opening margin','Entry notional','Buy time','Sell time','Interest start','Interest as of','Current balance','Annual rate','Simulated position','Simulated savings','Quote as of','Mark price'],
  ja:['ロング','ショート','資産運用','元本収益率','含み損益','累計利息','安値での買値','高値での売値','指定買値','指定売値','現在値','元本','当初証拠金','建玉金額','買付日時','売付日時','利息の起算日','利息計算時点','元利合計','年利','模擬ポジション','模擬資産運用','価格の時刻','マーク価格'],
  ru:['Лонг','Шорт','Сбережения','Доходность капитала','Нереализованный P&L','Процентный доход','Покупка на минимуме','Продажа на максимуме','Своя цена покупки','Своя цена продажи','Текущая цена','Капитал','Начальная маржа','Объём при входе','Время покупки','Время продажи','Начало начисления','Проценты на','Текущий баланс','Годовая ставка','Симуляция позиции','Симуляция вклада','Время котировки','Цена маркировки'],
  ko:['롱','숏','자산 관리','원금 수익률','미실현 손익','누적 이자','저점 매수가','고점 매도가','지정 매수가','지정 매도가','현재가','원금','개시 증거금','진입 금액','매수 시각','매도 시각','이자 시작일','이자 기준 시각','현재 원리금','연 수익률','모의 포지션','모의 자산 관리','시세 시각','표시 가격'],
};
const themes={
  dark:{top:'#11181f',end:'#17252c',paper:'#131b20',footer:'#10171c',ink:'#f3f4ed',secondary:'#c1cbc8',muted:'#a7b5b3',rule:'#39474b',gain:'#9af4ca',loss:'#ff9ba8',fixed:'#f3ce88',tag:'#24343a'},
  light:{top:'#f7f8f3',end:'#e6eee9',paper:'#fffdf7',footer:'#eff2ea',ink:'#122c2c',secondary:'#364e4b',muted:'#546b65',rule:'#c6d1c9',gain:'#086341',loss:'#a52e48',fixed:'#886117',tag:'#dce7df'},
};
let ownerImage;
function avatar() {
  if(!ownerImage) {
    ownerImage=new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);img.onerror=reject;
      img.src=new URL('./brand/liushayu-avatar.jpg',import.meta.url).href;
    });
    ownerImage.catch(()=>{ownerImage=null;});
  }
  return ownerImage;
}
function text(ctx,value,x,y,w,size,ink,weight=500,align='left') {
  return drawText(ctx,value,x,y,w,size,ink,{weight,align,min:Math.min(size,22)});
}
function hairline(ctx,y,color) {
  ctx.fillStyle=color;ctx.fillRect(L,y,span,1.5);
}
function signature(ctx,img,c,t,saving) {
  let x=L;
  if(img){
    const size=65,source=Math.min(img.naturalWidth,img.naturalHeight);
    ctx.save();ctx.beginPath();ctx.arc(x+size/2,77+size/2,size/2,0,Math.PI*2);ctx.clip();
    ctx.drawImage(img,(img.naturalWidth-source)/2,(img.naturalHeight-source)/2,source,source,x,77,size,size);ctx.restore();
    x+=size+19;
  }
  text(ctx,'刘鲨鱼',x,72,300,39,c.ink,675);
  text(ctx,'@LiuShaYu2026',x,119,310,24,c.muted,535);
  text(ctx,saving?t.savingSim:t.sim,R,94,span*.40,30,c.secondary,540,'right');
}
function direction(ctx,model,t,c,saving,short,y) {
  const label=saving?t.rate:short?t.short:t.long;
  const fact=saving?model.annualRateText:(model.lotsText||model.leverageText);
  const tint=saving?c.fixed:model.sideColor?'color-mix(in srgb,'+model.sideColor+' 62%, '+c.ink+')':short?c.loss:c.gain;
  const w=Math.min(400,measureText(ctx,label,33,620)+44);
  ctx.beginPath();ctx.roundRect(L,y,w,54,9);ctx.fillStyle=c.tag;ctx.fill();
  text(ctx,label,L+w/2,y+7,w-22,33,tint,635,'center');
  const factWidth=fact?Math.min(span*.32,measureText(ctx,fact,37,610)+4):0;
  if(fact)text(ctx,fact,L+w+20,y+4,factWidth,37,c.ink,610);
  if(!saving && model.market)text(ctx,model.market,R,y+10,span-w-factWidth-65,30,c.secondary,520,'right');
}
function hero(ctx,model,t,c,saving,short) {
  text(ctx,saving?t.savings:model.symbol,L-2,208,span+2,90,c.ink,685);
  direction(ctx,model,t,c,saving,short,325);
  const tone=model.pnl>0?c.gain:model.pnl<0?c.loss:c.ink;
  text(ctx,t.roi,L,443,span,37,c.secondary,500);
  ctx.save();ctx.letterSpacing='-6px';
  text(ctx,model.roiText,L-8,482,span+8,174,tone,655);ctx.restore();
  const title=saving?t.interest:t.pnl;
  const titleWidth=Math.min(span*.37,measureText(ctx,title,32,520)+3);
  text(ctx,title,L,695,titleWidth,32,c.secondary,520);
  text(ctx,model.pnlText,L+titleWidth+23,680,span-titleWidth-23,61,c.ink,620);
}
function pair(ctx,label,value,x,y,width,c) {
  text(ctx,label,x,y,width,30,c.muted,515);
  text(ctx,value,x,y+42,width,49,c.ink,605);
}
function ledger(ctx,label,value,y,c) {
  if(!value)return;
  const labelWidth=Math.min(span*.4,measureText(ctx,label,28,520)+4);
  text(ctx,label,L,y,labelWidth,28,c.muted,520);
  text(ctx,value,R,y-3,span-labelWidth-27,33,c.ink,560,'right');
}
function asOfSavings(model,lang) {
  if(!Number.isFinite(model.asOf))return '';
  return new Intl.DateTimeFormat(locales[lang],{
    timeZone:model.timeZone||'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset',
  }).format(model.asOf);
}

export async function renderTradeCard(model) {
  const lang=Object.hasOwn(copy,model.lang)?model.lang:'zh';
  const t=Object.fromEntries(keys.map((key,i)=>[key,copy[lang][i]]));
  const c=themes[model.theme]||themes.dark,saving=['savings','bank'].includes(model.side),short=model.side==='short';
  const [img]=await Promise.all([avatar().catch(()=>null),document.fonts?.load('650 64px Geist')]);
  const canvas=document.createElement('canvas');
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Canvas unavailable');

  ctx.fillStyle=c.paper;ctx.fillRect(0,0,W,H);
  const ground=ctx.createLinearGradient(110,650,W,80);
  ground.addColorStop(0,c.top);ground.addColorStop(1,c.end);
  ctx.fillStyle=ground;ctx.fillRect(0,0,W,790);
  signature(ctx,img,c,t,saving);
  hairline(ctx,175,c.rule);
  hero(ctx,model,t,c,saving,short);
  const col=(span-58)/2,right=R-col;
  if(saving) {
    pair(ctx,t.capital,model.capitalText,L,851,col,c);
    pair(ctx,t.balance,model.balanceText,right,851,col,c);
    if(model.entryTimeText)ledger(ctx,t.start,model.entryTimeText,1066,c);
  } else {
    const entry=short?(model.entryKind==='custom'?t.customSell:t.sell):(model.entryKind==='custom'?t.customBuy:t.buy);
    pair(ctx,entry,model.entryPriceText,L,825,col,c);
    pair(ctx,t.current,model.priceText,right,825,col,c);
    pair(ctx,model.lotsText?t.margin:t.capital,model.capitalText,L,972,col,c);
    pair(ctx,t.notional,model.entryNotionalText,right,972,col,c);
    if(model.entryTimeText)ledger(ctx,short?t.sellTime:t.buyTime,model.entryTimeText,1108,c);
    if(model.markPriceText && model.markPriceText!==model.priceText)ledger(ctx,model.markLabel||t.mark,model.markPriceText,1162,c);
  }
  ctx.fillStyle=c.footer;ctx.fillRect(0,1241,W,H-1241);
  hairline(ctx,1241,c.rule);
  const time=saving?asOfSavings(model,lang):model.asOfText;
  if(time)ledger(ctx,saving?t.end:t.asOf,time,1278,c);
  return canvas;
}
