export function createCatalog(host, items, {t, quantity, onChoose}) {
  // Show the featured destinations first, then the rest of the catalogue by unit price.
  const featured=['chengdu-panda','bangkok-bbw-2026','phuket-month'];
  const entries=[...items].sort((a,b)=>{
    const order=id=>featured.includes(id)?featured.indexOf(id):featured.length;
    return order(a.id)-order(b.id);
  });
  const dialog=document.createElement('dialog');
  dialog.className='eq-dialog';
  dialog.innerHTML='<header><h3></h3><button type="button" class="eq-close">×</button></header>'+
    '<div class="eq-filter"><input type="search"><label><input type="checkbox"> <span></span></label></div>'+
    '<ul class="eq-catalog-list"></ul><p class="eq-empty" role="status" hidden></p>';
  host.append(dialog);
  const heading=dialog.querySelector('h3'), close=dialog.querySelector('.eq-close');
  const search=dialog.querySelector('[type=search]'), videos=dialog.querySelector('[type=checkbox]');
  const filterLabel=dialog.querySelector('label span'), list=dialog.querySelector('ul'), empty=dialog.querySelector('.eq-empty');
  const indices={zh:0,en:1,ja:2,ru:3,ko:4};
  let state, rows=[], filterKey='';

  function update(next) {
    if(!dialog.open) return;
    state=next;
    const {amount,currency,lang}=state;
    const language=indices[lang]??0;
    const query=search.value.trim().toLocaleLowerCase();
    const key=[lang,query,videos.checked].join('|');
    if(key!==filterKey) {
      filterKey=key;
      const title=t(lang,'eqCatalog',{count:items.length});
      heading.textContent=title;
      dialog.setAttribute('aria-label',title);
      close.setAttribute('aria-label',t(lang,'eqClose'));
      const searchLabel=t(lang,'eqSearch');
      search.placeholder=searchLabel;
      search.setAttribute('aria-label',searchLabel);
      filterLabel.textContent=t(lang,'eqVideoOnly');
      const fragment=document.createDocumentFragment();
      rows=[];
      for(const item of entries) {
        if(videos.checked && !item.videoUrl) continue;
        if(query && !item.title.some(name=>name.toLocaleLowerCase().includes(query))) continue;
        const row=document.createElement('li'), choose=document.createElement('button'), count=document.createElement('b');
        choose.type='button';
        const image=document.createElement('img'), name=document.createElement('span');
        image.src='./equivalents/art/'+item.id+'.webp';image.alt='';image.loading='lazy';image.decoding='async';
        name.textContent=item.title[language];choose.append(image,name);
        choose.addEventListener('click',()=>{dialog.close();onChoose(item);});
        row.append(choose,count);
        if(item.videoUrl) {
          const link=document.createElement('a');
          link.href=item.videoUrl;link.target='_blank';link.rel='noopener noreferrer';
          const label=t(lang,'eqEnjoy')+(item.videoScope==='related'?' · '+t(lang,'eqRelatedVideo'):'');
          link.textContent='▶ '+label;
          link.setAttribute('aria-label',label+' · '+item.title[language]);
          link.title=[lang==='zh'?item.videoTitle:item.title[language],item.videoCreator].filter(Boolean).join(' · ');
          row.append(link);
        }
        fragment.append(row);rows.push([item,count]);
      }
      list.replaceChildren(fragment);
      empty.textContent=t(lang,'eqNoMatch');
      empty.hidden=rows.length>0;
    }
    for(const [item,node] of rows) {
      const text=quantity(item,amount,currency,lang);
      if(text!==node.textContent) node.textContent=text;
    }
  }
  close.addEventListener('click',()=>dialog.close());
  search.addEventListener('input',()=>update(state));
  videos.addEventListener('change',()=>update(state));
  return {update, close(){if(dialog.open)dialog.close();}, open(next){
    search.value='';videos.checked=false;filterKey='';
    dialog.showModal();
    update(next);
    search.focus();
  }};
}
