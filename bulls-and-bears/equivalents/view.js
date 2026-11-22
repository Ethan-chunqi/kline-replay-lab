import {reveal} from '../motion.js?v=20261122-market-v3';
import {quotePerDollar,fxAsOf,fxSources} from './rates.js?v=20261122-comparisons';
import {referenceItems} from './reference.js?v=20261122-share';

import {createBundleView} from './bundle-view.js?v=20261122-share';
import {createCatalog} from './catalog.js?v=20261122-comparisons';

const items=new Map(referenceItems.map(item=>[item.id,item]));
// Dollar bands keep familiar comparisons and also include every item priced in the band.
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
const catalogItems=[...byPrice].reverse();
for(let i=0;i<bands.length;i++) {
  const lower=i?bands[i-1][0]:0, [upper,ids]=bands[i];
  for(const item of catalogItems) {
    const price=usdEquivalent(item.price,item.currency);
    if(price>=lower && price<upper && !ids.includes(item.id)) ids.push(item.id);
  }
}
const numberFormats=new Map();
export function formatQuantity(item,amount,currency,lang,t) {
  const count=quotePerDollar(currency)===quotePerDollar(item.currency)
    ? Math.abs(amount)/item.price
    : Math.abs(usdEquivalent(amount,currency))/usdEquivalent(item.price,item.currency);
  const decimals=item.decimals??0;
  const key=lang+'/'+decimals;
  if(!numberFormats.has(key))numberFormats.set(key,new Intl.NumberFormat(locale[lang],{maximumFractionDigits:decimals}));
  const number=numberFormats.get(key);
  let unit=item.unit[langIndex[lang]??0];
  if(lang==='en' && !decimals && count<1.5 && unit.endsWith('s')) {
    unit=unit.endsWith('sses')?unit.slice(0,-2):unit.endsWith('ies')?unit.slice(0,-3)+'y':unit.slice(0,-1);
  }
  if(!decimals && count<0.5) return t(lang,'eqBelowOne',{unit});
  if(decimals && count>0 && count<0.5*10**-decimals) return '< '+number.format(10**-decimals)+' '+unit;
  return number.format(count)+' '+unit;
}

export function createEquivalent(host,t,gainKey='eqGain') {
  host.innerHTML='<div class="eq-head"><span class="eq-caption"></span><button type="button" class="eq-next"></button></div>' +
    '<div class="eq-mode" role="group"><button type="button" data-mode="single" aria-pressed="true"></button><button type="button" data-mode="bundle" aria-pressed="false"></button></div>' +
    '<div class="eq-single"><a class="eq-main" target="_blank" rel="noopener noreferrer"><img class="eq-icon" alt="" width="70" height="70"><span class="eq-item"><strong></strong><span></span><small></small></span></a>' +
    '<a class="eq-video" target="_blank" rel="noopener noreferrer" hidden></a>'+
    '<div class="eq-tools"><details class="eq-compare"><summary></summary><ul class="eq-list"></ul></details><button type="button" class="eq-all"></button></div>'+
    '<details class="eq-pricing"><summary></summary><div class="eq-sources"><span class="eq-price"></span><span class="eq-note"></span><a class="eq-source" target="_blank" rel="noopener noreferrer"></a><span class="eq-fx"></span></div></details></div><div class="eq-bundle" hidden></div>';
  const q=s=>host.querySelector(s);
  const quantity=(item,amount,currency,lang)=>formatQuantity(item,amount,currency,lang,t);
  const catalogButton=q('.eq-all'), video=q('.eq-video');
  const main=q('.eq-main'), icon=q('.eq-icon'), title=q('.eq-item>span'), size=q('.eq-item strong'), action=q('.eq-item small');
  const next=q('.eq-next'), caption=q('.eq-caption'), detail=q('.eq-pricing'), summary=q('.eq-pricing summary'), quote=q('.eq-price');
  const source=q('.eq-source'),fx=q('.eq-fx'),note=q('.eq-note');
  const compare=q('.eq-compare'),list=q('.eq-list');
  const compareSummary=q('.eq-compare summary');
  const savedCurrencyText=[];
  let queue=[],pool=[],bestId='',compareKey='';
  const modeGroup=q('.eq-mode'), single=q('.eq-single'), bundleHost=q('.eq-bundle');
  const modeButtons=[...modeGroup.querySelectorAll('button')], bundleView=createBundleView(bundleHost,t);
  let mode='single',variant=0;
  for(const btn of modeButtons)btn.addEventListener('click',()=>{
    mode=btn.dataset.mode;compare.open=false;
    for(const option of modeButtons)option.setAttribute('aria-pressed',String(option===btn));
    single.hidden=mode!=='single';bundleHost.hidden=mode!=='bundle';
    paint();
  });
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
  const catalog=createCatalog(host,catalogItems,{t,quantity,onChoose(item){
    active=item;detail.open=false;compare.open=false;paint();reveal(main);
  }});
  catalogButton.addEventListener('click',()=>{compare.open=false;catalog.open(state);});
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
      action.textContent=tr(!active.buyUrl?'eqViewSource':!active.videoUrl?'eqEnjoy':active.linkType==='listings'?'eqListings':active.linkType==='booking'?'eqBook':'eqShop')+' ↗';
      icon.src='./equivalents/art/'+active.id+'.webp';
      modeGroup.setAttribute('aria-label',tr('eqMode'));
      modeButtons[0].textContent=tr('eqSingle');modeButtons[1].textContent=tr('eqBundle');
      catalogButton.textContent=t(lang,'eqCatalog',{count:items.size});
      video.hidden=!active.videoUrl;
      if(active.videoUrl) {
        const videoLabel=tr('eqEnjoy')+(active.videoScope==='related'?' · '+tr('eqRelatedVideo'):'');
        video.href=active.videoUrl;video.textContent='▶ '+videoLabel+' ↗';
        video.setAttribute('aria-label',videoLabel+' · '+active.title[id]);
        video.title=[lang==='zh'?active.videoTitle:active.title[id],active.videoCreator].filter(Boolean).join(' · ');
      } else {video.removeAttribute('href');video.removeAttribute('title');}

      summary.textContent=tr('eqDetails');compareSummary.textContent=tr('eqCompare');
      quote.textContent=unitPrice+' '+active.currency+' / '+active.unit[id]+' · '+active.asOf;
      note.hidden=lang!=='zh' || !active.noteZh;
      note.textContent=note.hidden?'':active.noteZh;
      source.href=active.sourceUrl;source.textContent=active.sourceName+' ↗';
      fx.hidden=currency===active.currency;
      const codes=[currency,active.currency].filter((c,i,arr)=>fxSources[c]&&arr.indexOf(c)===i);
      fx.replaceChildren();
      if(currency==='USDT')fx.append(document.createTextNode(tr('simulationRate')+' · 1 USDT = 1 USD '));
      for(const code of codes){
        const a=document.createElement('a');a.href=fxSources[code];a.target='_blank';a.rel='noopener noreferrer';
        a.textContent='1 USD = '+quotePerDollar(code)+' '+code+' · '+fxAsOf;fx.append(a);
      }
    }
    caption.textContent=tr(amount>0?gainKey:'eqLoss');
    next.textContent=tr(mode==='single'?'eqNext':'eqNextBundle');
    if(mode==='bundle'){bundleView.update(state,variant);return;}
    const text=quantity(active,amount,currency,lang);
    if (text!==size.textContent) size.textContent=text;
    if(compare.open) drawComparison();
    catalog.update(state);
  }
  next.addEventListener('click',()=>{
    if(!active)return;
    if(mode==='bundle')variant++;
    else choose(state.exclude);
    paint();reveal(mode==='bundle'?bundleHost:main);
  });
  return {get id(){return active?.id;},snapshot(){
    if(host.hidden||!state||!active)return {mode,services:[]};
    if(mode==='bundle')return {mode,services:bundleView.snapshot()};
    const {amount,currency,lang}=state;
    const i=langIndex[lang]??0;
    return {mode,services:[{id:active.id,title:active.title[i],quantityText:quantity(active,amount,currency,lang),
      amountText:active.price.toLocaleString(locale[lang],{maximumFractionDigits:4})+' '+active.currency+' / '+active.unit[i]}]};
  },update(amount,currency,lang,symbol,exclude){
    const dollars=Math.abs(usdEquivalent(amount,currency));
    host.hidden=!Number.isFinite(amount)||!Number.isFinite(dollars)||dollars===0;
    if(host.hidden){catalog.close();return;}
    state={amount,currency,lang,exclude};
    const nextBand=bands.find(([upper])=>dollars<upper);
    const best=dollars>=10000?byPrice.find(item=>usdEquivalent(item.price,item.currency)<=dollars):null;
    if(band!==nextBand || symbol!==lastKey || bestId!==(best?.id||'')) {
      band=nextBand;lastKey=symbol;bestId=best?.id||'';
      pool=best?[...new Set([best.id,...band[1]])]:[...band[1]];
      queue=[];
      if(best){active=best;queue=pool.filter(id=>id!==best.id);detail.open=false;}
      else choose(exclude);
    }
    paint();
  }};
}
