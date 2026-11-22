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
  dark:{page:'#0d191c',hero:'#102024',wash:'#304047',paper:'#152427',ink:'#f3f4ed',muted:'#a9bcb9',sub:'#c8d3cd',line:'#34484b',gain:'#81efaa',loss:'#ff97a8',detail:'#e1e9e1',gold:'#f1c77f'},
  light:{page:'#f7f7f0',hero:'#e9eee5',wash:'#c8d4c8',paper:'#fffef8',ink:'#152c2b',muted:'#4e6662',sub:'#37544c',line:'#bfcec3',gain:'#095e42',loss:'#a22542',detail:'#283f3a',gold:'#805821'},
};
const scan={zh:'扫码查看行情',en:'Scan for market data',ja:'スキャンして相場を見る',ru:'Сканируйте, чтобы открыть котировки',ko:'스캔하여 시세 보기'};
const art=new Map();

function loadArt(file) {
  if(!art.has(file)){
    const promise=new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Artwork unavailable'));
      img.src=new URL('./brand/'+file,import.meta.url).href;
    });
    art.set(file,promise);
    promise.catch(()=>art.delete(file));
  }
  return art.get(file);
}
function text(ctx,value,x,y,w,size,ink,weight=500,align='left') {
  return drawText(ctx,value,x,y,w,size,ink,{weight,align,min:Math.min(size,22)});
}
function rule(ctx,x,y,w,color) {
  ctx.fillStyle=color;ctx.fillRect(x,y,w,1.5);
}

// Keep the currency next to the number while giving the two separate typographic weights.
function amount(ctx,value,x,y,width,size,unitSize,color,unitColor,weight=630) {
  const match=String(value||'—').match(/^(.*\d)\s+([^\s\d]+)$/u);
  if(!match)return text(ctx,value,x,y,width,size,color,weight);
  const [,digits,unit]=match;
  const numberW=measureText(ctx,digits,size,weight);
  const unitW=measureText(ctx,unit,unitSize,520);
  const gap=Math.ceil(unitSize*.36);
  const scale=Math.min(1,width/(numberW+unitW+gap));
  const n=text(ctx,digits,x,y+(1-scale)*size*.65,numberW*scale+.4,size*scale,color,weight);
  text(ctx,unit,x+n+gap*scale,y+(1-scale)*size*.65+(size-unitSize)*scale*.83,
    unitW*scale+.4,unitSize*scale,unitColor,520);
}
function ticketTime(stamp) {
  if(!stamp)return '';
  const [clock,...accuracy]=String(stamp).split(' · ');
  const zone=clock.match(/(?:GMT|UTC)[+−-]\d{1,2}(?::\d{2})?/u);
  if(!zone || zone.index+zone[0].length===clock.length)return stamp;
  const value=clock.replace(zone[0],'').replace(/\s+/g,' ').trim();
  return [value+'  '+zone[0],...accuracy].join(' · ');
}
function savingsQuote(model,lang) {
  if(!Number.isFinite(model.asOf))return '';
  return new Intl.DateTimeFormat(locales[lang],{
    timeZone:model.timeZone||'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset',
  }).format(model.asOf);
}
function heroArt(ctx,img,c,short) {
  const glow=ctx.createRadialGradient(887,272,20,887,272,433);
  glow.addColorStop(0,c.wash);glow.addColorStop(1,c.hero);
  ctx.fillStyle=glow;ctx.fillRect(0,0,W,747);
  if(!img)return;
  const size=short?426:380;
  ctx.save();ctx.globalAlpha=.88;
  ctx.drawImage(img,R-size+18,short?92:111,size,size);
  ctx.restore();
}
function author(ctx,img,c,status) {
  let x=L;
  if(img){
    const d=48,edge=Math.min(img.width,img.height);
    ctx.save();ctx.beginPath();ctx.arc(x+d/2,65+d/2,d/2,0,2*Math.PI);ctx.clip();
    ctx.drawImage(img,(img.width-edge)/2,(img.height-edge)/2,edge,edge,x,65,d,d);ctx.restore();x+=d+16;
  }
  text(ctx,'刘鲨鱼',x,68,236,35,c.ink,640);
  text(ctx,status,R,70,348,30,c.sub,520,'right');
}
function position(ctx,model,c,t,saving,short) {
  const name=saving?t.savings:model.symbol;
  text(ctx,name,L-2,173,623,78,c.ink,680);
  const side=saving?t.rate:short?t.short:t.long;
  const detail=saving?model.annualRateText:(model.lotsText||model.leverageText);
  const tint=saving?c.gold:model.sideColor?'color-mix(in srgb,'+model.sideColor+' 67%, '+c.ink+')':short?c.loss:c.gain;
  const sideW=text(ctx,side,L,284,300,40,tint,655);
  if(detail){
    const x=L+sideW+24;ctx.fillStyle=c.line;ctx.fillRect(x,291,2,31);
    text(ctx,detail,x+22,284,340,40,c.ink,555);
  }
  if(!saving && model.market)text(ctx,model.market,L,347,490,28,c.muted,490);
}
function result(ctx,model,c,t,saving) {
  const color=model.pnl>0?c.gain:model.pnl<0?c.loss:c.ink;
  text(ctx,saving?t.interest:t.pnl,L,438,540,32,c.sub,520);
  amount(ctx,model.pnlText,L-4,494,span+4,143,39,color,c.sub,670);
  const percent=text(ctx,model.roiText,L,657,span*.45,50,color,645);
  text(ctx,t.roi,L+percent+19,674,span-percent-22,27,c.muted,480);
}
function metric(ctx,label,value,x,y,w,c,major) {
  text(ctx,label,x,y,w,major?33:30,c.muted,490);
  amount(ctx,value,x,y+(major?49:46),w,major?55:41,major?27:24,major?c.ink:c.detail,c.muted,major?625:540);
}
function lineItem(ctx,label,value,y,c) {
  if(!value)return;
  const labelW=Math.min(span*.38,measureText(ctx,label,28,490)+3);
  text(ctx,label,L,y,labelW,28,c.muted,490);
  text(ctx,value,R,y-3,span-labelW-24,32,c.detail,535,'right');
}
export async function renderTradeCard(model) {
  const lang=Object.hasOwn(copy,model.lang)?model.lang:'zh';
  const t=Object.fromEntries(keys.map((k,i)=>[k,copy[lang][i]]));
  const c=themes[model.theme]||themes.dark,saving=['savings','bank'].includes(model.side),short=model.side==='short';
  const [avatar,sculpture,qr]=await Promise.all([
    loadArt('liushayu-avatar.jpg').catch(()=>null),
    saving?null:loadArt(short?'pnl-bear.webp':'pnl-bull.webp').catch(()=>null),
    loadArt('share-qr.png').catch(()=>null),
    document.fonts?.load('670 64px Geist'),
  ]);
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Canvas unavailable');
  ctx.fillStyle=c.page;ctx.fillRect(0,0,W,H);
  heroArt(ctx,sculpture,c,short);author(ctx,avatar,c,saving?t.savingSim:t.sim);
  position(ctx,model,c,t,saving,short);result(ctx,model,c,t,saving);
  const footerTop=1190;
  ctx.fillStyle=c.paper;ctx.fillRect(0,747,W,footerTop-747);
  const col=(span-56)/2,right=R-col;
  const entry=short?(model.entryKind==='custom'?t.customSell:t.sell):(model.entryKind==='custom'?t.customBuy:t.buy);
  metric(ctx,saving?t.capital:entry,saving?model.capitalText:model.entryPriceText,L,789,col,c,true);
  metric(ctx,saving?t.balance:t.current,saving?model.balanceText:model.priceText,right,789,col,c,true);
  rule(ctx,L,930,span,c.line);
  if(saving){
    lineItem(ctx,t.start,ticketTime(model.entryTimeText),991,c);
    lineItem(ctx,t.end,ticketTime(savingsQuote(model,lang)),1092,c);
  } else {
    metric(ctx,model.lotsText?t.margin:t.capital,model.capitalText,L,960,col,c,false);
    metric(ctx,t.notional,model.entryNotionalText,right,960,col,c,false);
    const mark=model.markPriceText && model.markPriceText!==model.priceText;
    lineItem(ctx,short?t.sellTime:t.buyTime,ticketTime(model.entryTimeText),mark?1066:1084,c);
    if(mark)lineItem(ctx,model.markLabel||t.mark,model.markPriceText,1106,c);
    lineItem(ctx,t.asOf,ticketTime(model.asOfText),mark?1146:1137,c);
  }
  text(ctx,'@LiuShaYu2026',L,1225,span-177,37,c.ink,630);
  if(qr){
    text(ctx,scan[lang],L,1288,span-177,27,c.muted,500);
    // Preserve the QR's quiet zone and square module edges in the downloadable PNG.
    const size=135;
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(qr,R-size,1203,size,size);
    ctx.imageSmoothingEnabled=true;
  }
  return canvas;
}
