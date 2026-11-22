// Rasterize the captured position and OHLC data in the browser. Only first-party images are loaded.
const words = {
  zh: ['你的持仓','做多','做空','理财','未实现盈亏','累计利息','本金收益率','本金','杠杆','K 线','报价','周期低点','低点时间','开仓金额','参考开仓价','开仓基准','开仓时间','购买力换算','单一服务','配套服务','扫码查看行情','投入金额','起息时间','数据时间','年化利率'],
  en: ['Your positions','Long','Short','Savings','Unrealized P&L','Interest earned','Return on capital','Capital','Leverage','Candles','Quote','Cycle low','Time of low','Entry notional','Entry price','Entry basis','Entry time','Purchasing power','Single item','Bundle','Scan for the market','Amount invested','Interest start','Quote as of','Annual rate'],
  ja: ['あなたのポジション','ロング','ショート','資産運用','含み損益','累計利息','元本収益率','元本','レバレッジ','ローソク足','価格','サイクル安値','安値の日時','建玉金額','建値','建値の基準','建玉日時','購買力換算','単品','組み合わせ','相場をチェック','運用金額','利息の起算日','価格の日時','年利'],
  ru: ['Ваши позиции','Лонг','Шорт','Сбережения','Нереализованный результат','Начисленные проценты','Доходность капитала','Капитал','Плечо','Свечи','Котировка','Минимум цикла','Время минимума','Объём при входе','Цена входа','Основание входа','Время входа','Покупательная способность','Один вариант','Набор','Сканируйте для котировок','Начальная сумма','Начало начисления','Время котировки','Годовая ставка'],
  ko: ['내 포지션','롱','숏','자산 관리','미실현 손익','누적 이자','원금 수익률','원금','레버리지','캔들','시세','사이클 저점','저점 시각','진입 금액','진입 가격','진입 기준','진입 시각','구매력 환산','단일','패키지','시세 확인하기','투입 금액','이자 시작일','시세 시각','연 수익률'],
};
const fields=['positions','long','short','savings','pnl','interest','return','capital','leverage','candles','quote','low','lowTime','notional','entryPrice','basis','entryTime','power','single','bundle','scan','investment','interestStart','asOf','rate'];
const chartCopy={
  zh:['低点 → 当前','高点 → 当前','区间成交量','图外时点','每柱含 {n} 根 K 线，末柱可不足'],
  en:['Low → current','High → current','Interval volume','Outside chart range','{n} bars per candle, final group may be shorter'],
  ja:['安値 → 現在','高値 → 現在','区間出来高','表示範囲外','1本に最大{n}本を集約'],
  ru:['От минимума','От максимума','Объём за период','Вне диапазона','До {n} исходных свечей на столбец'],
  ko:['저점 → 현재','고점 → 현재','구간 거래량','차트 범위 밖','막대당 최대 {n}개 봉 집계'],
};
const locales={zh:'zh-CN',en:'en-US',ja:'ja-JP',ru:'ru-RU',ko:'ko-KR'};
const font='Geist,"PingFang SC","Hiragino Sans","Apple SD Gothic Neo","Microsoft YaHei",Arial,sans-serif';
const dark={page:'#082a31',panel:'#10353b',ink:'#f2f5eb',soft:'#bbcfca',muted:'#9fbeb7',rule:'#34575b',accent:'#ffdb85',up:'#77e0b7',down:'#ff98a4',swell:'#16434a'};
const light={page:'#f4f1e9',panel:'#fffdf7',ink:'#183639',soft:'#3e5c5a',muted:'#53706d',rule:'#c5d2c8',accent:'#8b5312',up:'#076943',down:'#ab3049',swell:'#dce6dc'};
const width=1080, margin=64, inner=width-2*margin;
const assetRoot=new URL('./',import.meta.url);
const imageCache=new Map();

function imageAt(path) {
  if(!imageCache.has(path)) {
    const loading=new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Poster image unavailable: '+path));
      img.src=new URL(path,assetRoot).href;
    });
    imageCache.set(path,loading);
    loading.catch(()=>imageCache.delete(path));
  }
  return imageCache.get(path);
}

function dateLabel(value,locale,zone,opts={}) {
  if(typeof value==='string') return value;
  if(!Number.isFinite(value)) return '—';
  const date=new Date(Math.abs(value)<1e11 ? value*1000 : value);
  if(Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale,{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',...opts}).format(date);
}

function toMs(time) {return Math.abs(time)<1e11?time*1000:time;}

function validatedCandles(input) {
  const unique=new Map();
  for (const b of input||[]) {
    if(!b || ![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite) ||
       b.low>Math.min(b.open,b.close) || b.high<Math.max(b.open,b.close)) continue;
    const time=toMs(b.time);
    unique.set(time,{...b,time});
  }
  return [...unique.values()].sort((a,b)=>a.time-b.time);
}

function pen(ctx,size,weight=500) {ctx.font=weight+' '+size+'px '+font;}
function text(ctx,content,x,y,w,size,ink,{weight=500,align='left',min=18}={}) {
  const value=String(content??'').trim()||'—';
  if(w<=0) return;
  pen(ctx,size,weight);
  const measured=ctx.measureText(value).width;
  if(measured>w){pen(ctx,Math.max(min,Math.floor(size*w/measured)),weight);}
  ctx.fillStyle=ink;ctx.textAlign=align;ctx.fillText(value,x,y,w);ctx.textAlign='left';
}

function lines(ctx,content,w,size,weight=500) {
  pen(ctx,size,weight);
  const value=String(content??'').trim()||'—';
  const tokens=value.match(/[A-Za-zА-Яа-яЁёÀ-ž0-9][A-Za-zА-Яа-яЁёÀ-ž0-9.,:+%/×–—-]*|\s+|[^\s]/gu)||[value];
  const result=[];
  let line='';
  for(const token of tokens) {
    if(line.trim() && ctx.measureText(line+token).width>w) {
      result.push(line.trim());line=token.trimStart();
    } else line+=token;
  }
  if(line.trim())result.push(line.trim());
  return result;
}

function rule(ctx,x,y,w,color) {ctx.fillStyle=color;ctx.fillRect(x,y,w,1.5);}
function rounded(ctx,x,y,w,h,r,fill) {
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
}
function cropped(ctx,img,x,y,size,r) {
  const sx=img.naturalWidth||img.width, sy=img.naturalHeight||img.height, src=Math.min(sx,sy);
  ctx.save();ctx.beginPath();ctx.roundRect(x,y,size,size,r);ctx.clip();
  ctx.drawImage(img,(sx-src)/2,(sy-src)/2,src,src,x,y,size,size);ctx.restore();
}

// A small, original contour illustration uses the same sea palette as the artwork on the site.
function swells(ctx,colors) {
  ctx.save();ctx.beginPath();ctx.rect(700,135,380,192);ctx.clip();ctx.strokeStyle=colors.swell;ctx.lineWidth=2;
  for(let i=0;i<7;i++){
    const y=169+12*i;
    ctx.beginPath();ctx.moveTo(718,y+69);
    ctx.bezierCurveTo(811,y+43,851,y+113,914,y+48);
    ctx.bezierCurveTo(945,y+14,984,y-17,999,y-20);
    ctx.bezierCurveTo(985,y+6,974,y+27,983,y+37);
    ctx.bezierCurveTo(999,y+50,1048,y+19,1090,y+26);ctx.stroke();
  }
  ctx.restore();
}

function groupCandles(bars,extremeTimes,moves) {
  const groupSize=Math.ceil(bars.length/112), groups=[];
  for(let i=0;i<bars.length;i+=groupSize) {
    const part=bars.slice(i,i+groupSize);
    const group={time:part[0].time,end:part.at(-1).time,open:part[0].open,close:part.at(-1).close,
      high:Math.max(...part.map(b=>b.high)),low:Math.min(...part.map(b=>b.low)),
      volume:part.reduce((sum,b)=>sum+(b.volume>0?b.volume:0),0)};
    group.extremes=moves.filter(({kind,price})=>group[kind]===price &&
      part.some(b=>b.time===extremeTimes?.[kind] && b[kind]===price)).map(m=>m.kind);
    groups.push(group);
  }
  return {groups,groupSize};
}

function chartModel(model,bars) {
  const currentTime=toMs(model.currentTime??model.chartAsOf);
  const moves=Number.isFinite(model.currentPrice)&&Number.isFinite(currentTime)?
    (model.moves||[]).filter(m=>['low','high'].includes(m.kind)&&Number.isFinite(m.price)&&Number.isFinite(m.time)&&toMs(m.time)<=currentTime)
      .map(m=>({...m,time:toMs(m.time)})).sort((a,b)=>a.kind==='low'?-1:1):[];
  const {groups,groupSize}=groupCandles(bars,model.extremeTimes,moves);
  const outside=moves.filter(m=>m.time<bars[0].time);
  const height=362+(groupSize>1||outside.length?33:0)+(moves.length?(moves.some(m=>m.volumeText)?122:92):0);
  return {groups,groupSize,moves,outside,currentTime,height};
}

function drawChart(ctx,model,chart,y,colors,t,lang,zone) {
  const {groups,groupSize,moves,outside,currentTime,height}=chart, locale=locales[lang], labels=chartCopy[lang];
  const x=margin,w=inner, inset=28;
  rounded(ctx,x,y,w,height,24,colors.panel);
  const chartName=[model.chartSymbol||model.symbol,model.interval,t.candles].filter(Boolean).join(' · ');
  text(ctx,chartName,x+inset,y+21,model.priceText?w-355:w-2*inset,31,colors.ink,{weight:650});
  if(model.priceText) text(ctx,t.quote+'  '+model.priceText,x+w-inset,y+25,300,23,colors.soft,{align:'right'});
  const plotLeft=x+inset,plotTop=y+78,plotBottom=y+256;
  let cap=Math.max(...groups.map(b=>b.high)),floor=Math.min(...groups.map(b=>b.low));
  if(moves.length) {
    cap=Math.max(cap,model.currentPrice,...moves.map(m=>m.price));
    floor=Math.min(floor,model.currentPrice,...moves.map(m=>m.price));
  }
  const pad=Math.max((cap-floor)*.06,Math.abs(cap)*1e-7,1e-12), bottom=floor-pad,top=cap+pad;
  const priceY=p=>plotTop+(top-p)/(top-bottom)*(plotBottom-plotTop);
  const digits=Number.isInteger(model.priceDigits)?Math.max(0,Math.min(10,model.priceDigits)):
    Math.max(0,Math.min(8,Math.ceil(-Math.log10((top-bottom)/4))+1));
  const numbers=new Intl.NumberFormat(locale,{maximumFractionDigits:digits});
  const ticks=[cap,(cap+floor)/2,floor], tickLabels=ticks.map(p=>numbers.format(p));
  pen(ctx,19,490);
  const axisWidth=Math.min(185,Math.max(70,...tickLabels.map(s=>ctx.measureText(s).width+12)));
  const plotRight=x+w-inset-axisWidth-8;
  ticks.forEach((p,i)=>{
    if(cap===floor && i!==1)return;
    const py=priceY(p);
    rule(ctx,plotLeft,py,plotRight-plotLeft,colors.rule);
    text(ctx,tickLabels[i],x+w-inset,py-10,axisWidth,19,colors.muted,{align:'right'});
  });
  // Trading time is indexed like a candle chart. An off-screen anchor gets its own
  // earlier event slot, with a marked axis break before the first actual candle.
  const earlierTimes=[...new Set(outside.map(m=>m.time))].sort((a,b)=>a-b);
  const skipWidth=earlierTimes.length?earlierTimes.length*34+28:0;
  const candleStart=plotLeft+skipWidth;
  const spacing=(plotRight-candleStart)/(groups.length+(moves.length?1:0));
  const candleX=i=>candleStart+(i+.5)*spacing;
  const last=groups.at(-1),bodyWidth=Math.min(17,Math.max(2,spacing*.65));
  function xAt(time) {
    if(time<groups[0].time)return plotLeft+17+34*earlierTimes.indexOf(time);
    if(time>=last.end) {
      const edge=candleX(groups.length-1);
      return currentTime>last.end?edge+(plotRight-4-edge)*Math.min(1,(time-last.end)/(currentTime-last.end)):edge;
    }
    const i=groups.findIndex(g=>time<=g.end);
    if(i<0)return candleX(groups.length-1);
    const group=groups[i];
    if(time>=group.time){
      const within=group.end>group.time?(time-group.time)/(group.end-group.time)-.5:0;
      return candleX(i)+within*Math.min(bodyWidth,spacing*.85);
    }
    const prev=groups[Math.max(0,i-1)];
    return candleX(Math.max(0,i-1))+spacing*(time-prev.end)/(group.time-prev.end);
  }
  const maxVol=Math.max(...groups.map(b=>b.volume));
  groups.forEach((b,i)=>{
    const cx=candleX(i), up=b.close>=b.open;
    const marked=b.extremes.length>0;
    const color=marked?'#ffeb34':up?(model.chartUpColor||colors.up):(model.chartDownColor||colors.down);
    const edge=colors===dark?'#fff7ab':'#976000';
    ctx.save();
    if(marked){ctx.shadowColor='#ffd000';ctx.shadowBlur=8;}
    ctx.strokeStyle=marked?edge:color;ctx.lineWidth=marked?3:1.8;
    ctx.beginPath();ctx.moveTo(cx,priceY(b.high));ctx.lineTo(cx,priceY(b.low));ctx.stroke();
    const bodyY=Math.min(priceY(b.open),priceY(b.close)), bodyHeight=Math.max(2.6,Math.abs(priceY(b.close)-priceY(b.open)));
    ctx.fillStyle=color;ctx.fillRect(cx-bodyWidth/2,bodyY,bodyWidth,bodyHeight);
    if(marked){ctx.lineWidth=1.2;ctx.strokeRect(cx-bodyWidth/2,bodyY,bodyWidth,bodyHeight);}
    ctx.restore();
    if(b.volume>0) {
      const barHeight=29*b.volume/maxVol;
      ctx.fillStyle=color;ctx.globalAlpha=.42;ctx.fillRect(cx-bodyWidth/2,y+295-barHeight,bodyWidth,barHeight);ctx.globalAlpha=1;
    }
  });
  if(skipWidth) {
    ctx.strokeStyle=colors.muted;ctx.lineWidth=2;
    ctx.beginPath();
    for(const offset of [0,7]) {ctx.moveTo(candleStart-17+offset,y+294);ctx.lineTo(candleStart-11+offset,y+277);}
    ctx.stroke();
  }
  const moveColors=colors===dark?{low:'#9edbff',high:'#ffcf7a'}:{low:'#176299',high:'#9a5612'};
  for(const move of moves) {
    const anchor=groups.findIndex(b=>b.extremes.includes(move.kind));
    const sx=anchor<0?xAt(move.time):candleX(anchor),sy=priceY(move.price),ex=xAt(currentTime),ey=priceY(model.currentPrice);
    ctx.save();
    ctx.lineWidth=3.2;ctx.strokeStyle=moveColors[move.kind];
    if(move.kind==='high')ctx.setLineDash([10,6]);
    ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=moveColors[move.kind];ctx.beginPath();ctx.arc(sx,sy,5.5,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
  if(moves.length) {
    ctx.fillStyle=colors.ink;ctx.strokeStyle=colors.panel;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(xAt(currentTime),priceY(model.currentPrice),6,0,Math.PI*2);ctx.fill();ctx.stroke();
  }
  const calendar=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
  const ymd=time=>{
    const parts=Object.fromEntries(calendar.formatToParts(time).map(p=>[p.type,p.value]));
    return [parts.year,parts.month,parts.day].join('/');
  };
  const crossYear=ymd(groups[0].time).slice(0,4)!==ymd(last.end).slice(0,4);
  const stamp=time=>crossYear?ymd(time):dateLabel(time,locale,zone,{year:undefined});
  text(ctx,stamp(groups[0].time),candleStart,y+309,335,19,colors.muted);
  if(groups.length>1)text(ctx,stamp(last.end),candleX(groups.length-1),y+309,335,19,colors.muted,{align:'right'});
  let below=y+351;
  if(groupSize>1||outside.length) {
    const notes=[outside.length?'//  '+labels[3]:null,groupSize>1?labels[4].replace('{n}',String(groupSize)):null].filter(Boolean);
    text(ctx,notes.join('   ·   '),plotLeft,below-6,w-2*inset,19,colors.soft);below+=33;
  }
  if(moves.length) {
    rule(ctx,plotLeft,below,w-2*inset,colors.rule);
    const column=(w-2*inset)/2;
    moves.forEach((m,i)=>{
      const pos=plotLeft+i*column, color=moveColors[m.kind], low=m.kind==='low';
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=3.2;if(!low)ctx.setLineDash([7,4]);
      ctx.beginPath();ctx.moveTo(pos,below+32);ctx.lineTo(pos+34,below+32);ctx.stroke();ctx.restore();
      text(ctx,labels[low?0:1],pos+45,below+17,column-56,24,colors.soft);
      text(ctx,m.percentText,pos,below+47,column-16,34,color,{weight:660});
      if(m.volumeText)text(ctx,labels[2]+'  '+m.volumeText,pos,below+91,column-12,20,colors.soft);
      m.notes.forEach((line,n)=>text(ctx,line,pos,below+(m.volumeText?121:91)+n*25,column-14,20,colors.muted));

    });
  }
  return y+height;
}

export async function renderSharePoster(model) {
  const bars=validatedCandles(model.bars);
  if(!bars.length)throw new Error('No candles available');
  const lang=Object.hasOwn(words,model.lang)?model.lang:'zh',locale=locales[lang],zone=model.timeZone||'Asia/Shanghai';
  const t=Object.fromEntries(fields.map((key,index)=>[key,words[lang][index]]));
  const canvas=document.createElement('canvas');
  canvas.width=width;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('Canvas unavailable');
  const list=(model.services||[]).slice(0,5);
  const [avatar,qr,art]=await Promise.all([
    imageAt('./brand/liushayu-avatar.jpg'),
    model.qrImage||imageAt('./brand/share-qr.png'),
    Promise.all(list.map(row=>/^[a-z0-9-]+$/.test(row.id)?imageAt('./equivalents/art/'+row.id+'.webp'):null)),
    document.fonts?.load('600 32px Geist'),
  ]);
  const colors=model.theme==='light'?light:dark;
  const savings=model.side==='savings'||model.side==='bank';
  const single=model.mode!=='bundle';
  const signColor=model.pnl<0?colors.down:model.pnl>0?colors.up:colors.ink;
  const serviceLines=list.map(row=>lines(ctx,row.title,single?inner-198:inner-128,single?35:28,630));
  const serviceHeights=serviceLines.map(ls=>single?Math.max(170,ls.length*43+103):Math.max(100,ls.length*35+58));
  const fieldRows=[
    [[t.low,model.lowPriceText],[t.lowTime,model.lowTimeText]],
    [[savings?t.investment:t.notional,model.entryNotionalText],[savings?t.interestStart:t.entryPrice,savings?model.entryTimeText:model.entryPriceText]],
  ];
  if(!savings && (model.entryBasisText||model.entryTimeText)) {
    fieldRows.push([[t.basis,model.entryBasisText],[t.entryTime,model.entryTimeText]]);
  }
  const column=(inner-36)/2;
  const detailRows=fieldRows.map(cells=>cells.map(([label,value])=>({label,lines:lines(ctx,value,column,30,580)})));
  const rowHeight=row=>42+Math.max(...row.map(cell=>cell.lines.length))*36+13;
  const detailsHeight=detailRows.reduce((sum,row)=>sum+rowHeight(row),0);
  const serviceHeight=list.length?94+serviceHeights.reduce((a,b)=>a+b,0):0;
  const chart=chartModel(model,bars);
  const noteWidth=(inner-56)/2-14;
  chart.moves.forEach(m=>{
    m.notes=[m.untilText,m.volumeBasis]
      .filter(Boolean).flatMap(value=>lines(ctx,value,noteWidth,20));
  });
  chart.height+=Math.max(0,...chart.moves.map(m=>m.notes.length))*25;

  const chartTop=514,detailsTop=chartTop+chart.height+34,footerTop=detailsTop+detailsHeight+serviceHeight+20;
  canvas.height=footerTop+211;
  ctx.textBaseline='top';ctx.fillStyle=colors.page;ctx.fillRect(0,0,width,canvas.height);
  swells(ctx,colors);
  cropped(ctx,avatar,margin,53,65,32);
  text(ctx,'刘鲨鱼',margin+82,44,220,41,colors.ink,{weight:730});
  text(ctx,'BULLS & BEARS',margin+82,94,265,20,colors.muted,{weight:600});
  const pill=t.positions;
  pen(ctx,24,630);const pillWidth=ctx.measureText(pill).width+45;
  rounded(ctx,width-margin-pillWidth,62,pillWidth,45,22,colors.swell);
  text(ctx,pill,width-margin-pillWidth/2,72,pillWidth-21,24,colors.soft,{align:'center',weight:630});
  rule(ctx,margin,143,inner,colors.rule);

  const side=(savings?t.savings:model.side==='short'?t.short:t.long);
  pen(ctx,26,650);const sideWidth=ctx.measureText(side).width+36;
  rounded(ctx,margin,178,sideWidth,45,10,colors.panel);
  text(ctx,side,margin+sideWidth/2,186,sideWidth-14,26,model.sideColor||(savings?colors.accent:model.side==='short'?colors.down:colors.up),{align:'center',weight:650});
  text(ctx,[model.market,model.symbol].filter(Boolean).join('  /  '),margin+sideWidth+18,184,inner-sideWidth-27,35,colors.ink,{weight:650});
  const basisCaption=!savings&&model.markPriceText?[model.markLabel,model.markPriceText].filter(Boolean).join(' '):'';
  const pnlCaption=[savings?t.interest:t.pnl,basisCaption].filter(Boolean).join('  ·  ');
  text(ctx,pnlCaption,margin,249,inner,29,colors.soft);
  text(ctx,model.pnlText,margin-2,280,inner,99,signColor,{weight:700,min:38});
  rule(ctx,margin,401,inner,colors.rule);
  const metrics=[[t.return,model.roiText],[t.capital,model.capitalText]];
  if(savings)metrics.push([t.rate,model.annualRateText||'3%']);
  else if(model.lotsText)metrics.push([model.positionSizeLabel||({zh:'手数',en:'Lots',ja:'取引枚数',ru:'Лоты',ko:'계약 수'})[lang],model.lotsText]);
  else if(model.leverageText)metrics.push([t.leverage,model.leverageText]);
  const segment=inner/metrics.length;
  metrics.forEach(([label,value],i)=>{
    const x=margin+i*segment;
    text(ctx,label,x,421,segment-16,22,colors.muted);
    text(ctx,value,x,454,segment-18,34,colors.ink,{weight:640});
  });
  drawChart(ctx,model,chart,chartTop,colors,t,lang,zone);

  let y=detailsTop;
  for(const row of detailRows) {
    rule(ctx,margin,y,inner,colors.rule);
    row.forEach((cell,i)=>{
      const x=margin+i*(column+36);
      text(ctx,cell.label,x,y+9,column,21,colors.muted);
      cell.lines.forEach((s,n)=>text(ctx,s,x,y+40+36*n,column,30,colors.ink,{weight:580}));
    });
    y+=rowHeight(row);
  }
  if(list.length) {
    rule(ctx,margin,y,inner,colors.rule);
    text(ctx,t.power,margin,y+29,inner-330,38,colors.ink,{weight:690});
    text(ctx,(single?t.single:t.bundle),width-margin,y+40,315,22,colors.muted,{align:'right'});
    y+=94;
    list.forEach((service,i)=>{
      const size=single?145:76, inset=single?175:100;
      const titleSize=single?35:28, titleStep=single?43:35, contentWidth=inner-inset;
      if(art[i])cropped(ctx,art[i],margin,y+4,size,single?18:12);
      const sx=margin+inset;
      serviceLines[i].forEach((s,j)=>text(ctx,s,sx,y+7+titleStep*j,contentWidth,titleSize,colors.ink,{weight:630}));
      const afterTitle=y+12+titleStep*serviceLines[i].length;
      if(single) {
        text(ctx,service.quantityText,sx,afterTitle,contentWidth,43,colors.accent,{weight:690});
        if(service.amountText)text(ctx,service.amountText,sx,afterTitle+51,contentWidth,23,colors.soft);
      } else {
        const quantity=service.quantityText||'—', amount=service.amountText||'—';
        text(ctx,quantity,sx,afterTitle,contentWidth*.46,25,colors.accent,{weight:600});
        text(ctx,amount,width-margin,afterTitle,contentWidth*.52,25,colors.soft,{align:'right',weight:600});
      }
      y+=serviceHeights[i];
      if(i<list.length-1)rule(ctx,margin,y-6,inner,colors.rule);
    });
  }
  rule(ctx,margin,footerTop,inner,colors.rule);
  const footerWidth=inner-202;
  text(ctx,'@LiuShaYu2026',margin,footerTop+30,footerWidth,34,colors.ink,{weight:680});
  const asOf=model.asOfText||dateLabel(model.asOf,locale,zone);
  text(ctx,t.asOf+'  '+asOf,margin,footerTop+84,footerWidth,22,colors.soft);
  const context={zh:'模拟结果',en:'Simulation results',ja:'シミュレーション結果',ru:'Результат моделирования',ko:'모의 결과'}[lang];
  text(ctx,context+'  ·  '+t.scan,margin,footerTop+131,footerWidth,23,colors.muted);
  const qrSize=134,qrX=width-margin-qrSize;
  rounded(ctx,qrX-6,footerTop+21,qrSize+12,qrSize+12,10,'#fff');
  ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,qrX,footerTop+27,qrSize,qrSize);ctx.imageSmoothingEnabled=true;
  return canvas;
}
