import {renderSharePoster} from './share-poster.js?v=20261122-share';

const copy = {
  zh: {
    title:'分享图', close:'关闭', download:'保存 PNG', share:'分享图片', retry:'重试',
    loading:'正在生成分享图…', empty:'行情或持仓数据尚未就绪。', failed:'图片生成失败，请重试。',
    shareFailed:'系统分享未能完成，仍可保存 PNG。', preview:'分享图预览',
  },
  en: {
    title:'Share image', close:'Close', download:'Save PNG', share:'Share image', retry:'Retry',
    loading:'Creating your image…', empty:'Market or position data is not available yet.', failed:'The image could not be created. Please retry.',
    shareFailed:'Sharing could not be completed. You can still save the PNG.', preview:'Share image preview',
  },
  ja: {
    title:'シェア画像', close:'閉じる', download:'PNG を保存', share:'画像を共有', retry:'再試行',
    loading:'画像を作成しています…', empty:'価格またはポジションのデータを待っています。', failed:'画像を作成できませんでした。もう一度お試しください。',
    shareFailed:'共有できませんでした。PNG は保存できます。', preview:'シェア画像のプレビュー',
  },
  ru: {
    title:'Карточка для публикации', close:'Закрыть', download:'Сохранить PNG', share:'Поделиться', retry:'Повторить',
    loading:'Создаём изображение…', empty:'Данные о котировках или позиции пока недоступны.', failed:'Не удалось создать изображение. Попробуйте ещё раз.',
    shareFailed:'Не удалось поделиться изображением. Его можно сохранить в PNG.', preview:'Предпросмотр карточки',
  },
  ko: {
    title:'공유 이미지', close:'닫기', download:'PNG 저장', share:'이미지 공유', retry:'다시 시도',
    loading:'이미지를 만드는 중…', empty:'시세 또는 포지션 데이터를 기다리는 중입니다.', failed:'이미지를 만들 수 없습니다. 다시 시도해 주세요.',
    shareFailed:'공유를 완료하지 못했습니다. PNG로 저장할 수 있습니다.', preview:'공유 이미지 미리보기',
  },
};

function textFor(lang) {
  return copy[String(lang || '').split('-')[0]] || copy.zh;
}

function pngFromCanvas(canvas) {
  return new Promise((resolve,reject)=>{
    canvas.toBlob(blob=>blob && blob.size ? resolve(blob) : reject(new Error('PNG encoding failed')),'image/png');
  });
}

function fileName(model,side) {
  const asset=String(model.symbol || model.assetName || '').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,48);
  const date=new Date().toISOString().slice(0,10);
  return ['LiuShaYu',asset,side,date].filter(Boolean).join('-')+'.png';
}

export function createShareDialog({getModel}) {
  const dialog=document.createElement('dialog');
  dialog.className='share-dialog';
  dialog.innerHTML='<div class="share-dialog-head"><h2></h2><button type="button" class="share-close" autofocus>×</button></div>'+
    '<div class="share-dialog-body" aria-busy="false"><img class="share-preview" hidden><p class="share-status" role="status" aria-live="polite"></p></div>'+
    '<div class="share-dialog-actions"><button type="button" class="share-retry" hidden></button>'+
    '<a class="share-download" hidden></a><button type="button" class="share-native" hidden></button></div>';
  document.body.append(dialog);

  const heading=dialog.querySelector('h2'), body=dialog.querySelector('.share-dialog-body');
  const preview=dialog.querySelector('.share-preview'), status=dialog.querySelector('.share-status');
  const closeButton=dialog.querySelector('.share-close'), retry=dialog.querySelector('.share-retry');
  const download=dialog.querySelector('.share-download'), share=dialog.querySelector('.share-native');
  let generation=0, side, url, shareData, words;

  function localize(lang) {
    words=textFor(lang);
    dialog.setAttribute('aria-label',words.title);
    heading.textContent=words.title;closeButton.setAttribute('aria-label',words.close);
    retry.textContent=words.retry;download.textContent=words.download;share.textContent=words.share;
    preview.alt=words.preview;
  }
  function clearPreview() {
    preview.hidden=true;preview.removeAttribute('src');
    download.hidden=true;download.removeAttribute('href');download.removeAttribute('download');
    share.hidden=true;share.disabled=false;shareData=null;
    if(url) URL.revokeObjectURL(url);
    url=null;
  }
  function current(id) {
    return id===generation && dialog.open;
  }
  function setStatus(message) {
    status.hidden=!message;status.textContent=message;
  }
  async function generate() {
    const id=++generation;
    clearPreview();retry.hidden=true;
    body.setAttribute('aria-busy','true');setStatus(words.loading);
    try {
      const model=await getModel(side);
      if(!current(id)) return;
      if(!model) {
        setStatus(words.empty);retry.hidden=false;
        return;
      }
      localize(model.lang || document.documentElement.lang);
      setStatus(words.loading);
      const canvas=await renderSharePoster(model);
      if(!current(id)) return;
      const blob=await pngFromCanvas(canvas);
      if(!current(id)) return;

      url=URL.createObjectURL(blob);
      preview.src=url;
      await preview.decode();
      if(!current(id)) return;
      const name=fileName(model,side);
      download.download=name;download.href=url;download.hidden=false;
      preview.hidden=false;setStatus('');

      if(typeof File==='function' && typeof navigator.share==='function' && typeof navigator.canShare==='function') {
        try {
          const payload={files:[new File([blob],name,{type:'image/png'})]};
          if(navigator.canShare(payload)) {shareData=payload;share.hidden=false;}
        } catch { /* The PNG download remains available. */ }
      }
    } catch (error) {
      if(!current(id)) return;
      clearPreview();
      setStatus(error?.code==='NO_DATA' ? words.empty : words.failed);
      retry.hidden=false;
    } finally {
      if(current(id)) body.setAttribute('aria-busy','false');
    }
  }
  function open(nextSide) {
    side=nextSide;
    localize(document.documentElement.lang);
    if(!dialog.open) dialog.showModal();
    return generate();
  }
  closeButton.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{
    if(dialog.open) return;
    ++generation;clearPreview();setStatus('');
  });
  retry.addEventListener('click',generate);
  share.addEventListener('click',async()=>{
    if(!shareData || share.disabled) return;
    const id=generation;
    share.disabled=true;setStatus('');
    try {
      await navigator.share(shareData);
    } catch (error) {
      if(current(id) && error?.name!=='AbortError') setStatus(words.shareFailed);
    } finally {
      if(current(id)) share.disabled=false;
    }
  });
  return {open};
}
