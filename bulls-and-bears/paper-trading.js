import {quotePerDollar,fxAsOf} from './equivalents/rates.js?v=20261122-market-v3';
import {readPrincipal} from './metrics.js?v=20261122-market-v3';
const minute=60000, hour=60*minute;
const finitePositive=n=>Number.isFinite(n) && n>0;
const displayed=new Map();
function dayOfWeek(stamp,zone) {
  if (!displayed.has(zone)) displayed.set(zone,new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short'}));
  return displayed.get(zone).format(stamp);
}
function slot(now,day,region,sessionEnd,sessionStart) {
  const h=(now-day)/hour;
  if (now>=sessionEnd) return 0;
  if(region==='cn') return h>=9.5 && h<11.5 ? 1 : h>=13 && h<15 ? 2 : 0;
  if(region==='us') return h>=9.5 && h<16 ? 1 : 0;
  if(region==='kr') return now>=(sessionStart || day+9*hour) ? 1 : 0;
  return 0;
}
export function paperAccess(a,q,now,online=true) {
  if (!a || !q || !online || q.symbol!==a.symbol || !(q.executionSourceId || q.sourceId) ||
      !finitePositive(q.price) || !Number.isSafeInteger(q.asOf) || q.asOf>now+1500 ||
      ['stale','offline','loading'].includes(q.status)) return 'paperNoQuote';
  if (a.region==='crypto') {
    return q.market==='perpetual' && ['binance-usdm','bybit-linear','bitget-usdt'].includes(q.sourceId) &&
      q.status==='live' && now-q.asOf<=16000 ? '' : 'paperNoQuote';
  }
  if (a.type==='future' && (!new RegExp('^'+a.symbol+'[0-9]{4}$').test(q.contract) ||
      q.sourceId!=='cffex-'+q.contract || !finitePositive(q.multiplier))) return 'paperNoQuote';
  if (q.session==='closed' || q.session==='break') return 'paperClosed';
  if (q.session!=='open' || !Number.isSafeInteger(q.tradeDay)) return 'paperNoQuote';
  const weekday=dayOfWeek(now,a.timeZone);
  if(weekday==='Sun' || weekday==='Sat') return 'paperClosed';
  const end=q.sessionEnd || (a.region==='cn' ? q.tradeDay+15*hour : null);
  if(!end) return 'paperNoQuote';
  const current=slot(now,q.tradeDay,a.region,end,q.sessionStart);
  if(!current) return 'paperClosed';
  if(slot(q.asOf,q.tradeDay,a.region,end,q.sessionStart)!==current || !q.executionConfirmedAt ||
     q.executionConfirmedAt>now+1500 || now-q.executionConfirmedAt>20*minute || now-q.asOf>20*minute) return 'paperNoQuote';
  return '';
}

function instrumentKey(a,q) {
  return [a.region,a.symbol,q.executionSourceId||q.sourceId,a.type==='future'?q.contract:''].join('/');
}
export function paperProfit(position,price) {
  return (price-position.entry)*position.units*position.direction/position.fx;
}
export function createPaperLedger() {
  const records=[];
  function open(a,q,options,now,online) {
    const access=paperAccess(a,q,now,online);
    if (access) return {error:access};
    const {capital,leverage,direction}=options,fx=quotePerDollar(a.currency);
    if (!finitePositive(capital) || !Number.isInteger(leverage) || leverage<1 || leverage>125 ||
        ![1,-1].includes(direction) || !finitePositive(fx)) return {error:'paperInputs'};
    const exposure=capital*leverage*fx;
    const multiplier=a.type==='future'?q.multiplier:1;
    const quantity=a.type==='future'?Math.floor(exposure/(q.price*multiplier)):exposure/q.price;
    if (!finitePositive(quantity) || !finitePositive(quantity*multiplier) || !Number.isFinite(exposure))
      return {error:a.type==='future'?'paperOneLot':'paperInputs'};
    const position={key:instrumentKey(a,q),label:q.contract||a.symbol,type:a.type,source:q.executionSource||q.source||q.sourceId,base:a.base||a.symbol,
      currency:a.currency,region:a.region,timeZone:a.timeZone,capital,leverage,quantity,units:quantity*multiplier,
      fx,direction,entry:q.price,mark:q.price,opened:q.asOf,marked:q.asOf,closed:null,profit:null};
    records.unshift(position);
    return {position};
  }
  function close(p,a,q,now,online) {
    if (!records.includes(p) || p.closed!==null) return 'paperAlreadyClosed';
    if (!a || !q || instrumentKey(a,q)!==p.key) return 'paperSelectSame';
    const access=paperAccess(a,q,now,online);
    if (access) return access;
    if(q.asOf<p.opened || q.asOf<p.marked) return 'paperNoQuote';
    p.mark=q.price;p.marked=q.asOf;p.closed=q.asOf;p.profit=paperProfit(p,p.mark);
    return '';
  }
  function mark(a,q,now,online) {
    if (paperAccess(a,q,now,online)) return;
    const key=instrumentKey(a,q);
    for(const p of records) if(p.closed===null && p.key===key && q.asOf>=p.marked) {p.mark=q.price;p.marked=q.asOf;}
  }
  return {records,open,close,mark};
}

export function createPaperTrading(host,{t,localeFor,dateTime}) {
  let asset,quote,lang='zh',feedback='';
  const ledger=createPaperLedger(), tr=(key,params)=>t(lang,key,params);
  const text=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
  const num=(v,d=2)=>new Intl.NumberFormat(localeFor(lang),{maximumFractionDigits:d}).format(v);
  const signed=v=>Math.abs(v)<.005 ? '0 USDT' : (v>0?'+':'')+num(v)+' USDT';
  const time=(stamp,zone)=>dateTime(lang,stamp,{timeZone:zone,seconds:true});
  host.innerHTML='<div class="paper-head"><h2 data-paper="paperTitle"></h2><span data-paper="paperTab"></span></div>'+
    '<form class="paper-form"><label><span data-paper="paperCapital"></span><input id="paper-capital" type="text" inputmode="decimal" autocomplete="off" value="10000" required></label>'+
    '<label><span data-paper="paperLeverage"></span><input id="paper-leverage" type="number" min="1" max="125" step="1" value="10" required></label>'+
    '<label><span data-paper="paperDirection"></span><select id="paper-side"><option value="1" data-paper="paperLong"></option><option value="-1" data-paper="paperShort"></option></select></label>'+
    '<button type="submit" id="paper-open" data-paper="paperOpen"></button></form>'+
    '<p class="paper-quote" id="paper-quote"></p><p class="paper-quote" id="paper-fx" hidden></p><p class="paper-feedback" id="paper-result" role="status"></p>'+
    '<div id="paper-orders"></div>';
  const $=sel=>host.querySelector(sel);
  const form=$('.paper-form'), button=$('#paper-open'), orders=$('#paper-orders'), rows=new Map();
  const fields=[...host.querySelectorAll('[data-paper]')];
  function paint() {
    if(!asset || !quote) return;
    const now=Date.now(),online=navigator.onLine!==false,access=paperAccess(asset,quote,now,online);
    const capital=readPrincipal($('#paper-capital').value,lang,'USDT'), leverage=$('#paper-leverage').valueAsNumber;
    const valid=finitePositive(capital) && Number.isInteger(leverage) && leverage>=1 && leverage<=125;
    const fx=quotePerDollar(asset.currency),isFuture=asset.type==='future';
    const wholeLot=isFuture && !access && valid && capital*leverage*fx<quote.price*quote.multiplier;
    button.disabled=Boolean(access)||!valid||!finitePositive(fx)||wholeLot;
    let desc=tr(access || (asset.region==='crypto'?'paperLiveQuote':'paperDelayedQuote'));
    const label=quote.contract||asset.symbol;
    if(!access) desc+=' · '+num(quote.price,asset.digits??4)+' '+asset.currency+' · '+time(quote.asOf,asset.timeZone);
    if(wholeLot) desc+=' · '+tr('paperOneLot');
    if(asset.type==='index') desc+=' · '+tr('paperIndex');
    text($('#paper-quote'),label+' · '+desc);
    const exchange=$('#paper-fx');exchange.hidden=!['CNY','KRW'].includes(asset.currency);
    if(!exchange.hidden)text(exchange,'1 USDT ≈ '+num(fx,4)+' '+asset.currency+' · '+tr('paperFx')+' '+fxAsOf);
    text($('#paper-result'),feedback?tr(feedback):'');
    ledger.mark(asset,quote,now,online);
    for(const p of ledger.records) {
      let row=rows.get(p);
      if(!row) {
        row=document.createElement('article');row.className='paper-order';
        row.innerHTML='<div class="paper-order-head"><strong></strong><button type="button" class="paper-close"></button></div><dl></dl><small></small>';
        row.querySelector('button').addEventListener('click',()=>{feedback=ledger.close(p,asset,quote,Date.now(),navigator.onLine!==false)||'paperFilledClose';paint();});
        for(let i=0;i<4;i++){const cell=document.createElement('div');cell.innerHTML='<dt></dt><dd></dd>';row.querySelector('dl').append(cell);}
        orders.prepend(row);rows.set(p,row);
      }
      const closed=p.closed!==null,same=p.key===instrumentKey(asset,quote);
      text(row.querySelector('strong'),p.label+' · '+tr(p.direction===1?'paperLong':'paperShort')+' '+p.leverage+'×');
      const close=row.querySelector('button');
      close.hidden=closed;close.disabled=Boolean(access)||!same||quote.asOf<p.marked;
      text(close,tr('paperClose'));close.title=tr(!same?'paperSelectSame':access||'paperClose');
      const quantityUnit=p.type==='future'?tr('paperLots'):p.type==='perpetual'?p.base:tr('paperUnits');
      const result=closed?p.profit:paperProfit(p,p.mark);
      const values=[['paperQuantity',num(p.quantity,8)+' '+quantityUnit],['paperEntry',num(p.entry,8)+' '+p.currency],
        [closed?'paperExit':'paperCurrent',num(p.mark,8)+' '+p.currency],[closed?'paperRealized':'paperFloating',signed(result)]];
      [...row.querySelector('dl').children].forEach((cell,i)=>{text(cell.firstChild,tr(values[i][0]));text(cell.lastChild,values[i][1]);});
      row.querySelector('dl').lastChild.lastChild.dataset.tone=result>0?'positive':result<0?'negative':'neutral';
      text(row.querySelector('small'),p.source+' · '+tr(closed?'paperClosedAt':'paperQuoteAt')+' '+time(p.marked,p.timeZone));
    }
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const fill=ledger.open(asset,quote,{capital:readPrincipal($('#paper-capital').value,lang,'USDT'),leverage:$('#paper-leverage').valueAsNumber,
      direction:Number($('#paper-side').value)},Date.now(),navigator.onLine!==false);
    feedback=fill.error||'paperFilledOpen';paint();
  });
  form.addEventListener('input',()=>{feedback='';paint();});
  const timer=setInterval(()=>{if(!document.hidden)paint();},1000);
  window.addEventListener('offline',paint);window.addEventListener('online',paint);
  return {update(a,q,language) {
    if(asset?.symbol!==a.symbol || quote?.sourceId!==q.sourceId) feedback='';
    if(lang!==language || !asset) {
      const capital=readPrincipal($('#paper-capital').value,lang,'USDT');
      lang=language;
      if(capital) $('#paper-capital').value=capital.toLocaleString(localeFor(lang),{useGrouping:false,maximumFractionDigits:8});
      for(const el of fields)text(el,tr(el.dataset.paper));
    }
    asset=a;quote=q;paint();
  },destroy(){clearInterval(timer);window.removeEventListener('offline',paint);window.removeEventListener('online',paint);}};
}
