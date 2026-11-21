import {reveal} from '../motion.js?v=20261122-market-v3';
import {quotePerDollar,fxAsOf,fxSources} from './rates.js?v=20261122-market-v3';
import {iconCount,referenceItems} from './reference.js?v=20261122-market-v3';

const items=new Map(referenceItems.map(item=>[item.id,item]));
// Upper bounds are in USD. Each band has five alternatives.
export const bands=[
  [5,['beijing-metro','us-stamp','ikea-bag','costco-hot-dog','us-rice']],
  [10,['us-bread','us-gasoline','shanghai-astronomy','badaling-winter','nyc-ferry']],
  [20,['palace-museum','film-forum','water-cube-swim','shanghai-maglev','shanghai-astronomy']],
  [35,['shenzhen-foot','citibike-day','apple-adapter','nyc-climb','moma-ny']],
  [100,['nyc-haircut','one-world-deck','shenzhen-foot','missouri-admission','nyc-climb']],
  [300,['disneyland-anaheim','sge-gold','squier-sonic','national-parks-nonresident','airpods-pro-3']],
  [1200,['wuhan-wage','beijing-min-wage','amtrak-usa-rail-pass','switch-two','sge-gold']],
  [3500,['iphone-duo','iphone-18-pro','wuhan-wage','sge-gold','switch-two']],
  [10000,['canon-r5ii','honda-rebel','serengeti-migration','sge-gold','iphone-duo']],
  [30000,['serengeti-migration','toyota-corolla','honda-rebel','canon-r5ii','sge-gold']],
  [80000,['mercedes-c300','toyota-corolla','serengeti-migration','sge-gold','airstream-bambi']],
  [300000,['world-jet-tour','guangzhou-90m2','airstream-bambi','mercedes-c300','serengeti-migration']],
  [Infinity,['beijing-90m2','shanghai-90m2','guangzhou-90m2','manhattan-median','world-jet-tour']],
];
const langIndex={zh:0,en:1,ja:2,ru:3,ko:4};
const locale={zh:'zh-CN',en:'en-US',ja:'ja-JP',ru:'ru-RU',ko:'ko-KR'};
export function usdEquivalent(amount,currency) {
  return amount/quotePerDollar(currency);
}

const byPrice=[...referenceItems].sort((a,b)=>usdEquivalent(b.price,b.currency)-usdEquivalent(a.price,a.currency));
function quantity(item,amount,currency,lang) {
  const count=Math.abs(usdEquivalent(amount,currency))/usdEquivalent(item.price,item.currency);
  return count.toLocaleString(locale[lang],count<0.01?{maximumSignificantDigits:2}:{maximumFractionDigits:2})+' '+item.unit[langIndex[lang]??0];
}

export function createEquivalent(host,t) {
  host.innerHTML='<div class="eq-head"><span class="eq-caption"></span><button type="button" class="eq-next"></button></div>' +
    '<a class="eq-main" target="_blank" rel="noopener noreferrer"><span class="eq-icon" aria-hidden="true"></span><span class="eq-item"><strong></strong><span></span><small></small></span></a>' +
    '<details class="eq-compare"><summary></summary><ul class="eq-list"></ul></details><details class="eq-pricing"><summary></summary><div class="eq-sources"><span class="eq-price"></span><span class="eq-note"></span><a class="eq-source" target="_blank" rel="noopener noreferrer"></a><span class="eq-fx"></span></div></details>';
  const q=s=>host.querySelector(s);
  const main=q('.eq-main'), icon=q('.eq-icon'), title=q('.eq-item>span'), size=q('.eq-item strong'), action=q('.eq-item small');
  const next=q('.eq-next'), caption=q('.eq-caption'), detail=q('.eq-pricing'), summary=q('.eq-pricing summary'), quote=q('.eq-price');
  const source=q('.eq-source'),fx=q('.eq-fx'),note=q('.eq-note');
  const compare=q('.eq-compare'),list=q('.eq-list');
  const compareSummary=q('.eq-compare summary');
  const savedCurrencyText=[];
  let queue=[],pool=[],bestId='',compareKey='';
  const hover=matchMedia('(hover: hover)');
  main.addEventListener('pointerenter',event=>{if(hover.matches && event.pointerType==='mouse'){compare.open=true;drawComparison();}});
  host.addEventListener('pointerleave',()=>{if(hover.matches && !host.contains(document.activeElement)) compare.open=false;});
  compare.addEventListener('toggle',()=>{if(compare.open) drawComparison();});
  function drawComparison() {
    if (!active || !state)return;
    const {amount,lang,currency}=state, id=langIndex[lang]??0;
    const candidates=[...new Set(['iphone-duo','wuhan-wage','sge-gold','shenzhen-foot',...pool])].filter(x=>x!==active.id).slice(0,7);
    const key=candidates.join('/')+lang;
    if(compareKey!==key){
      compareKey=key;list.replaceChildren();savedCurrencyText.length=0;
      for(const itemId of candidates){
        const item=items.get(itemId), row=document.createElement('li'),link=document.createElement('a'),count=document.createElement('b');
        link.href=item.buyUrl||item.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=item.title[id];
        row.append(link,count);list.append(row);savedCurrencyText.push([count,item]);
      }
    }
    for(const [node,item] of savedCurrencyText){
      const text=quantity(item,amount,currency,lang);
      if(node.textContent!==text)node.textContent=text;
    }
  }
  let lastKey='',active,band,state,rendered;
  function choose(exclude) {
    if (!queue.length) {
      queue=[...pool];
      for(let i=queue.length-1;i>0;i--) {
        const j=Math.floor(Math.random()*(i+1));
        [queue[i],queue[j]]=[queue[j],queue[i]];
      }
    }
    const index=queue.findIndex(id=>id!==exclude && id!==active?.id);
    active=items.get(queue.splice(index<0?0:index,1)[0]);
    detail.open=false;
  }
  function paint() {
    const {amount,currency,lang}=state, tr=key=>t(lang,key);
    const key=[active.id,lang,currency].join('|');
    const id=langIndex[lang]??0;
    if (rendered!==key) {
      rendered=key;
      const unitPrice=active.price.toLocaleString(locale[lang],{maximumFractionDigits:4});
      title.textContent=active.title[id];
      main.href=active.buyUrl || active.sourceUrl;
      action.textContent=tr(!active.buyUrl?'eqViewSource':active.linkType==='listings'?'eqListings':active.linkType==='booking'?'eqBook':'eqShop')+' ↗';
      icon.style.backgroundSize=iconCount*100+'% 100%';
      icon.style.backgroundPosition=(active.icon/(iconCount-1)*100)+'% center';
      icon.replaceChildren();
      if(active.imageUrl) {
        const image=new Image();
        image.alt='';image.referrerPolicy='no-referrer';image.decoding='async';
        image.onload=()=>{if(icon.contains(image))image.classList.add('loaded');};
        image.onerror=()=>image.remove();image.src=active.imageUrl;icon.append(image);
      }
      next.textContent=tr('eqNext');
      summary.textContent=tr('eqDetails');compareSummary.textContent=tr('eqCompare');
      quote.textContent=unitPrice+' '+active.currency+' / '+active.unit[id]+' · '+active.asOf;
      note.hidden=lang!=='zh' || !active.noteZh;
      note.textContent=note.hidden?'':active.noteZh;
      source.href=active.sourceUrl;source.textContent=active.sourceName+' ↗';
      fx.hidden=currency===active.currency;
      const codes=[currency,active.currency].filter((c,i,arr)=>fxSources[c]&&arr.indexOf(c)===i);
      fx.replaceChildren();
      if(currency==='USDT')fx.append(document.createTextNode('1 USDT ≈ 1 USD '));
      for(const code of codes){
        const a=document.createElement('a');a.href=fxSources[code];a.target='_blank';a.rel='noopener noreferrer';
        a.textContent='1 USD ≈ '+quotePerDollar(code)+' '+code+' · '+fxAsOf;fx.append(a);
      }
    }
    caption.textContent=tr(amount>0?'eqGain':'eqLoss');
    const text='≈ '+quantity(active,amount,currency,lang);
    if (text!==size.textContent) size.textContent=text;
    if(compare.open) drawComparison();
  }
  next.addEventListener('click',()=>{if(active){choose(state.exclude);paint();reveal(main);}});
  return {get id(){return active?.id;},update(amount,currency,lang,symbol,exclude){
    const dollars=Math.abs(usdEquivalent(amount,currency));
    host.hidden=!Number.isFinite(amount)||!Number.isFinite(dollars)||dollars===0;
    if(host.hidden)return;
    state={amount,currency,lang,exclude};
    const nextBand=bands.find(([upper])=>dollars<upper);
    const best=dollars>=10000?byPrice.find(item=>usdEquivalent(item.price,item.currency)<=dollars):null;
    if(band!==nextBand || symbol!==lastKey || bestId!==(best?.id||'')) {
      band=nextBand;lastKey=symbol;bestId=best?.id||'';
      pool=best?[...new Set([best.id,...band[1]])].slice(0,5):[...band[1]];
      queue=[];
      if(best){active=best;queue=pool.filter(id=>id!==best.id);detail.open=false;}
      else choose(exclude);
    }
    paint();
  }};
}
