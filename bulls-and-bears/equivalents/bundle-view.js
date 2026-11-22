import {buildBundle} from './bundle.js?v=20261122-comparisons';
import {referenceItems} from './reference.js?v=20261122-share';
import {quantityUnit} from './quantity.js?v=20261122-editorial-2';
const languages={zh:0,en:1,ja:2,ru:3,ko:4};
const locales={zh:'zh-CN',en:'en-US',ja:'ja-JP',ru:'ru-RU',ko:'ko-KR'};

export function createBundleView(host,t) {
  host.innerHTML='<ul class="bundle-list"></ul><div class="bundle-total"><span></span><strong></strong></div><small class="bundle-note"></small>';
  const list=host.querySelector('ul'), total=host.querySelector('.bundle-total strong');
  const label=host.querySelector('.bundle-total span'), note=host.querySelector('.bundle-note');
  let previous='', structure='', rows=[], services=[];
  function update(state,variant) {
    const {amount,currency,lang}=state, key=[Math.abs(amount).toFixed(2),currency,lang,variant].join('|');
    if(previous===key) return;
    previous=key;
    const bundle=buildBundle(amount,currency,referenceItems,variant);
    const number=new Intl.NumberFormat(locales[lang],{minimumFractionDigits:2,maximumFractionDigits:2});
    const weight=new Intl.NumberFormat(locales[lang],{maximumSignificantDigits:5});
    const integers=new Intl.NumberFormat(locales[lang],{maximumFractionDigits:0});
    const money=value=>number.format(value)+' '+currency;
    const language=languages[lang]??0;
    const layout=lang+'/'+bundle.lines.map(line=>line.item.id).join('/');
    if(layout!==structure) {
      structure=layout;list.replaceChildren();rows=[];
      for(const {item} of bundle.lines) {
        const row=document.createElement('li'), picture=document.createElement('img'), body=document.createElement('div');
        const name=document.createElement('a'), values=document.createElement('div');
        const quantity=document.createElement('span'), cost=document.createElement('b');
        picture.alt='';picture.src='./equivalents/art/'+item.id+'.webp';picture.decoding='async';
        name.target='_blank';name.rel='noopener noreferrer';name.href=item.buyUrl||item.sourceUrl;
        name.textContent=item.title[language];
        values.className='bundle-values';values.append(quantity,cost);body.append(name,values);
        if(item.videoUrl){
          const video=document.createElement('a');
          const action=t(lang,'eqEnjoy')+(item.videoScope==='related'?' · '+t(lang,'eqRelatedVideo'):'');
          video.className='bundle-video';video.href=item.videoUrl;video.target='_blank';video.rel='noopener noreferrer';
          video.textContent='▶ '+action;
          video.setAttribute('aria-label',action+' · '+item.title[language]);body.append(video);
        }
        row.append(picture,body);list.append(row);rows.push({quantity,cost});
      }
    }
    services=bundle.lines.map((line,i)=>{
      const number=(line.measured?weight:integers).format(line.quantity);
      const value=number+' '+quantityUnit(line.item,lang,number);
      const subtotal=money(line.amount);
      if(rows[i].quantity.textContent!==value) rows[i].quantity.textContent=value;
      if(rows[i].cost.textContent!==subtotal) rows[i].cost.textContent=subtotal;
      return {id:line.item.id,title:line.item.title[language],quantityText:value,amountText:subtotal};
    });
    label.textContent=t(lang,'bundleTotal');
    total.textContent=money(bundle.total);
    const remainder=bundle.lines.some(l=>l.measured);
    note.hidden=!remainder && bundle.total>0;
    note.textContent=t(lang,remainder?'bundleRemainder':'bundleTiny',{currency});
  }
  return {update,snapshot:()=>services.map(line=>({...line}))};
}
