// A snapshot is drawn locally so the exported numbers and artwork match the selected trade.
import {layoutShareChart} from './share-chart.js?v=20261122-two-cards';
import {drawText,wrapText,measureText,rule} from './share-poster-type.js?v=20261122-editorial';

const width=1080,margin=58,inner=width-margin*2;
const langs={zh:'zh-CN',en:'en-GB',ja:'ja-JP',ru:'ru-RU',ko:'ko-KR'};
const keys=['position','long','short','savings','roi','pnl','interest','capital','notional','buy','sell','customBuy','customSell','current','buyTime','sellTime','low','lowTime','margin','lots','rate','start','tradeDetails','savingDetails','power','single','bundle','time','scan','sim'];
const copy={
 zh:['你的持仓','做多','做空','理财','本金收益率','未实现盈亏','累计利息','本金','开仓金额','买入价（周期低点）','卖出价（周期高点）','自定义买入价','自定义卖出价','当前价格','买入时间','卖出时间','周期低点','低点时间','开仓保证金','手数','年化利率','起息时间','成交记录','理财明细','购买力换算','单一服务','配套服务','数据时间','扫码查看行情','模拟结果'],
 en:['Your positions','Long','Short','Savings','Return on capital','Unrealized P&L','Interest earned','Capital','Entry notional','Buy price · cycle low','Sell price · cycle high','Custom buy price','Custom sell price','Current price','Buy time','Sell time','Cycle low','Time of low','Opening margin','Lots','Annual rate','Interest start','Trade details','Savings details','Purchasing power','Single item','Bundle','Quote as of','Scan for the market','Simulation results'],
 ja:['あなたのポジション','ロング','ショート','資産運用','元本収益率','含み損益','累計利息','元本','建玉金額','買値（サイクル安値）','売値（サイクル高値）','指定買値','指定売値','現在値','買付日時','売付日時','サイクル安値','安値の日時','当初証拠金','取引枚数','年利','利息の起算日','取引明細','運用明細','購買力換算','単品','組み合わせ','価格の日時','相場をチェック','シミュレーション結果'],
 ru:['Ваши позиции','Лонг','Шорт','Сбережения','Доходность капитала','Нереализованный результат','Начисленные проценты','Капитал','Объём при входе','Цена покупки · минимум','Цена продажи · максимум','Своя цена покупки','Своя цена продажи','Текущая цена','Время покупки','Время продажи','Минимум цикла','Время минимума','Начальная маржа','Лоты','Годовая ставка','Начало начисления','Детали позиции','Детали вклада','Покупательная способность','Один вариант','Набор','Время котировки','Сканируйте для котировок','Результат моделирования'],
 ko:['내 포지션','롱','숏','자산 관리','원금 수익률','미실현 손익','누적 이자','원금','진입 금액','매수가 · 주기 저점','매도가 · 주기 고점','지정 매수가','지정 매도가','현재가','매수 시각','매도 시각','주기 저점','저점 시각','개시 증거금','계약 수','연 수익률','이자 시작일','포지션 상세','운용 상세','구매력 환산','단일','패키지','시세 시각','시세 확인하기','모의 결과'],
};
const palettes={
 dark:{page:'#10191e',panel:'#17242a',ink:'#f2f5ef',soft:'#cdd7d5',muted:'#a0b2b3',rule:'#324247',accent:'#f2d396',up:'#74e2b1',down:'#ff9391',ticket:'#213838'},
 light:{page:'#f6f6ef',panel:'#edefe7',ink:'#112b2d',soft:'#354f50',muted:'#586b69',rule:'#c5cfca',accent:'#80501d',up:'#08784f',down:'#a93f4c',ticket:'#e7ede0'},
};
const assets=new Map();
function imageAt(path) {
  if(!assets.has(path)){
    const pending=new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Poster artwork unavailable'));
      img.src=new URL(path,import.meta.url).href;
    });
    assets.set(path,pending);pending.catch(()=>assets.delete(path));
  }
  return assets.get(path);
}
function rounded(ctx,x,y,w,h,r,color) {
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=color;ctx.fill();
}
function cover(ctx,img,x,y,w,h,r=0) {
  const s=Math.max(w/img.width,h/img.height),sw=w/s,sh=h/s;
  ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.clip();
  ctx.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,x,y,w,h);ctx.restore();
}
function hero(ctx,model,words,avatar,shark,saving,short,height) {
  const navy='#03151c',white='#f1f7f1',sub='#bdcecd',mint='#a0eece',coral='#ffacaa';
  ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
  ctx.fillStyle=navy;ctx.fillRect(0,0,width,height);
  if(shark){
    const w=756,h=w*shark.height/shark.width;
    ctx.drawImage(shark,width-w,-22,w,h);
    const scrim=ctx.createLinearGradient(269,0,602,0);
    scrim.addColorStop(0,navy);scrim.addColorStop(.49,'rgba(3,21,28,.90)');scrim.addColorStop(1,'rgba(3,21,28,0)');
    ctx.fillStyle=scrim;ctx.fillRect(0,0,603,height);
  }
  const bottom=ctx.createLinearGradient(0,height-112,0,height);
  bottom.addColorStop(0,'rgba(3,21,28,0)');bottom.addColorStop(1,'rgba(3,21,28,.88)');
  ctx.fillStyle=bottom;ctx.fillRect(0,height-112,width,112);
  cover(ctx,avatar,margin,33,57,57,29);
  drawText(ctx,'刘鲨鱼',margin+70,29,210,30,white,{weight:685});
  drawText(ctx,'BULLS & BEARS',margin+71,67,235,17,'#b5ccc7',{weight:560});
  drawText(ctx,words.position,width-margin,43,315,25,sub,{align:'right',weight:520});
  drawText(ctx,model.symbol,margin,113,inner,62,white,{weight:710});
  const side=saving?words.savings:short?words.short:words.long;
  const sideInk=saving?'#f3d491':model.sideColor?'color-mix(in srgb,'+model.sideColor+' 60%, white)':short?coral:mint;
  const sw=measureText(ctx,side,25,660)+27;
  rounded(ctx,margin,185,sw,40,7,'#172d32');
  drawText(ctx,side,margin+sw/2,191,sw-14,25,sideInk,{weight:660,align:'center'});
  const exposure=saving?words.rate+' '+(model.annualRateText||'3%'):model.lotsText?words.lots+' '+model.lotsText:model.leverageText;
  drawText(ctx,[exposure,model.market].filter(Boolean).join('   ·   '),margin+sw+15,191,inner-sw-15,25,sub,{weight:520});
  drawText(ctx,words.roi,margin,254,610,27,'#c3d4d0',{weight:505});
  const profit=model.pnl>0?mint:model.pnl<0?coral:white;
  ctx.save();ctx.letterSpacing='-3px';
  drawText(ctx,model.roiText,margin-4,283,646,144,profit,{weight:735,min:59});ctx.restore();
  const label=saving?words.interest:words.pnl;
  const labelW=drawText(ctx,label,margin,437,330,25,sub,{weight:510});
  drawText(ctx,model.pnlText,margin+labelW+19,427,inner-labelW-24,40,white,{weight:615});
  ctx.restore();
}
const priceBandHeight=178;
function pricePair(ctx,model,words,c,short,top) {
  const isCustom=model.entryKind==='custom';
  const title=short?(isCustom?words.customSell:words.sell):(isCustom?words.customBuy:words.buy);
  ctx.fillStyle=c.panel;ctx.fillRect(0,top,width,priceBandHeight);
  const col=(inner-90)/2;
  for(const [x,label,price] of [[margin,title,model.entryPriceText],[width-margin-col,words.current,model.priceText]]) {
    drawText(ctx,label,x,top+34,col,32,c.muted,{weight:480});
    const parts=String(price).match(/^(.*) ([^\s]+)$/u);
    const amount=parts?parts[1]:price,unit=parts?parts[2]:'';
    const unitWidth=unit?measureText(ctx,unit,29,510)+13:0;
    const fontSize=Math.min(54,54*(col-unitWidth)/Math.max(1,measureText(ctx,amount,54,625)));
    const numberWidth=drawText(ctx,amount,x,top+91+(54-fontSize),col-unitWidth,fontSize,c.ink,{weight:625});
    if(unit)drawText(ctx,unit,x+numberWidth+13,top+113,unitWidth,29,c.muted,{weight:510});
  }
  ctx.save();ctx.translate(width/2-20,top+115);ctx.strokeStyle=c.muted;ctx.lineWidth=2.1;ctx.beginPath();
  ctx.moveTo(0,0);ctx.lineTo(37,0);ctx.moveTo(29,-8);ctx.lineTo(37,0);ctx.lineTo(29,8);ctx.stroke();ctx.restore();
}
function recordFields(model,t,saving,short) {
  if(saving)return [[t.capital,model.capitalText],[t.start,model.entryTimeText],[t.low,model.lowPriceText],[t.lowTime,model.lowTimeText]];
  const rows=[[model.lotsText?t.margin:t.capital,model.capitalText],[t.notional,model.entryNotionalText]];
  if(model.entryTimeText)rows.push([short?t.sellTime:t.buyTime,model.entryTimeText]);
  if(model.markPriceText && model.markPriceText!==model.priceText)rows.push([model.markLabel,model.markPriceText]);
  if(short || model.entryKind==='custom'){
    if(model.entryPriceText!==model.lowPriceText)rows.push([t.low,model.lowPriceText]);
    if(model.entryTimeText!==model.lowTimeText)rows.push([t.lowTime,model.lowTimeText]);
  }
  return rows;
}
function layoutRecords(ctx,fields) {
  const rows=fields.map(([label,value])=>{
    const labelWidth=measureText(ctx,label,31,465);
    const valueWidth=measureText(ctx,value,37,555);
    const stacked=labelWidth+36+valueWidth>inner;
    const lines=stacked?wrapText(ctx,value,inner,37,555):[value];
    return {label,lines,stacked,height:stacked?70+lines.length*50:83};
  });
  return {rows,height:107+rows.reduce((sum,row)=>sum+row.height,0)+42};
}
function drawRecords(ctx,layout,title,c,top) {
  rule(ctx,margin,top,inner,c.rule);
  drawText(ctx,title,margin,top+35,inner,40,c.ink,{weight:630});
  let y=top+107;
  for(const [i,row] of layout.rows.entries()) {
    if(i)rule(ctx,margin,y,inner,c.rule);
    drawText(ctx,row.label,margin,y+24,inner,31,c.muted,{weight:465});
    row.lines.forEach((line,n)=>{
      const x=row.stacked?margin:width-margin;
      drawText(ctx,line,x,row.stacked?y+67+n*50:y+20,inner,37,c.ink,{weight:555,align:row.stacked?'left':'right'});
    });
    y+=row.height;
  }
}
function measureServices(ctx,items,single) {
  const textWidth=single?inner-245:inner-152;
  return items.map(item=>{
    const size=single?35:29;
    const groups=single && measureText(ctx,item.title,size,620)>textWidth?item.title.split(/\s+(?=·\s)/):[item.title];
    const title=groups.flatMap(group=>wrapText(ctx,group,textWidth,size,620));
    return {title,height:single?Math.max(238,title.length*42+151):Math.max(115,title.length*36+75)};
  });
}
function drawServices(ctx,items,art,layout,t,c,single,y) {
  if(!items.length)return;
  const total=layout.reduce((h,e)=>h+e.height,0);
  ctx.fillStyle=c.ticket;ctx.fillRect(0,y,width,96+total);
  drawText(ctx,t.power,margin,y+31,inner*.6,32,c.ink,{weight:655});
  drawText(ctx,single?t.single:t.bundle,width-margin,y+39,inner*.34,23,c.muted,{align:'right'});
  y+=96;
  items.forEach((item,i)=>{
    const row=layout[i],h=single?198:90,w=single?211:90;
    if(art[i])cover(ctx,art[i],margin,y+1,w,h,9);
    const x=margin+w+(single?31:23),space=width-margin-x;
    row.title.forEach((line,n)=>drawText(ctx,line,x,y+2+n*(single?42:36),space,single?35:29,c.ink,{weight:620}));
    const valueTop=y+12+row.title.length*(single?42:36);
    drawText(ctx,item.quantityText,x,valueTop,single?space:space*.49,single?53:32,c.accent,{weight:665});
    if(item.amountText){
      if(single)drawText(ctx,item.amountText,x,valueTop+65,space,24,c.soft);
      else drawText(ctx,item.amountText,width-margin,valueTop+3,space*.5,27,c.soft,{align:'right'});
    }
    y+=row.height;
    if(i<items.length-1)rule(ctx,margin,y-11,inner,c.rule);
  });
}

export async function renderSharePoster(model) {
  const lang=Object.hasOwn(copy,model.lang)?model.lang:'zh';
  const t=Object.fromEntries(keys.map((key,i)=>[key,copy[lang][i]]));
  const saving=['savings','bank'].includes(model.side),short=model.side==='short',single=model.mode!=='bundle';
  const list=(model.services||[]).slice(0,5);
  const [avatar,shark,qr,art]=await Promise.all([
    imageAt('./brand/liushayu-avatar.jpg'),imageAt('./brand/share-shark.webp').catch(()=>null),
    model.qrImage||imageAt('./brand/share-qr.png'),
    Promise.all(list.map(s=>/^[a-z0-9-]+$/.test(s.id)?imageAt('./equivalents/art/'+s.id+'.webp'):null)),
    document.fonts?.load('650 36px Geist'),
  ]);
  const canvas=document.createElement('canvas');canvas.width=width;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw Error('Canvas unavailable');
  const c=palettes[model.theme]||palettes.dark,heroHeight=495;
  const chartTop=heroHeight+(saving?0:priceBandHeight)+52;
  const chart=layoutShareChart(ctx,saving?model:{...model,priceText:''},{
    x:margin,y:chartTop,width:inner,lang,locale:langs[lang],zone:model.timeZone||'Asia/Shanghai',colors:c});
  const records=layoutRecords(ctx,recordFields(model,t,saving,short));
  const services=measureServices(ctx,list,single);
  const recordTop=chartTop+chart.height+43;
  const serviceTop=recordTop+records.height;
  const footer=serviceTop+(list.length?96+services.reduce((h,r)=>h+r.height,0):0);
  canvas.height=Math.ceil(footer+190);
  ctx.fillStyle=c.page;ctx.fillRect(0,0,width,canvas.height);
  hero(ctx,model,t,avatar,shark,saving,short,heroHeight);
  if(!saving)pricePair(ctx,model,t,c,short,heroHeight);
  chart.draw(ctx);
  drawRecords(ctx,records,saving?t.savingDetails:t.tradeDetails,c,recordTop);
  drawServices(ctx,list,art,services,t,c,single,serviceTop);
  if(!list.length)rule(ctx,margin,footer,inner,c.rule);
  drawText(ctx,'@LiuShaYu2026',margin,footer+29,inner-180,37,c.ink,{weight:655});
  drawText(ctx,t.time+'  '+(model.asOfText||'—'),margin,footer+88,inner-178,23,c.soft);
  drawText(ctx,t.sim+'  ·  '+t.scan,margin,footer+130,inner-178,23,c.muted);
  const size=127,qx=width-margin-size,qy=footer+30;
  rounded(ctx,qx-5,qy-5,size+10,size+10,6,'#fff');
  ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,qx,qy,size,size);ctx.imageSmoothingEnabled=true;
  return canvas;
}
