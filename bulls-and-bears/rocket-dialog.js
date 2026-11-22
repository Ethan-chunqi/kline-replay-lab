const copy={
  zh:{title:'火箭行情视频',close:'关闭',cancel:'取消生成',source:'正在读取行情…',encoding:'正在生成视频…',retry:'重新生成',save:'保存 MP4',share:'分享视频',post:'在 X 发布',attach:'先保存 MP4，再到 X 的发帖窗口添加视频。',empty:'行情尚未就绪，请稍后重试。',failed:'视频生成失败，请重试。',unsupported:'当前浏览器无法导出 MP4，请使用最新版 Chrome、Edge 或 Safari。',preview:'行情视频预览',previewFailed:'当前浏览器无法预览此视频，可保存 MP4 后播放。',shareFailed:'系统分享未完成。你可以保存 MP4 或在 X 发帖。'},
  en:{title:'Rocket market video',close:'Close',cancel:'Cancel generation',source:'Loading market data…',encoding:'Creating video…',retry:'Try again',save:'Save MP4',share:'Share video',post:'Post on X',attach:'Save the MP4, then attach it in the X post editor.',empty:'Market data is not ready. Please try again.',failed:'Could not create the video. Please try again.',unsupported:'This browser cannot export MP4. Try a current version of Chrome, Edge or Safari.',preview:'Market video preview',previewFailed:'Save the MP4 to play it outside this browser.',shareFailed:'Sharing did not finish. You can save the MP4 or post on X.'},
  ja:{title:'ロケット相場動画',close:'閉じる',cancel:'生成を中止',source:'相場データを読み込み中…',encoding:'動画を作成中…',retry:'再試行',save:'MP4 を保存',share:'動画を共有',post:'X に投稿',attach:'MP4 を保存してから、X の投稿画面で動画を添付してください。',empty:'相場データの準備中です。しばらくしてからお試しください。',failed:'動画を作成できませんでした。もう一度お試しください。',unsupported:'このブラウザでは MP4 を書き出せません。最新版の Chrome、Edge、Safari でお試しください。',preview:'相場動画のプレビュー',previewFailed:'MP4 を保存して動画プレイヤーで再生してください。',shareFailed:'共有が完了しませんでした。MP4 を保存するか X に投稿できます。'},
  ru:{title:'Видео о движении рынка',close:'Закрыть',cancel:'Отменить создание',source:'Загружаем котировки…',encoding:'Создаём видео…',retry:'Повторить',save:'Сохранить MP4',share:'Поделиться видео',post:'Опубликовать в X',attach:'Сохраните MP4 и прикрепите его к публикации в X.',empty:'Котировки ещё не готовы. Повторите попытку позже.',failed:'Не удалось создать видео. Попробуйте ещё раз.',unsupported:'Этот браузер не поддерживает экспорт в MP4. Откройте страницу в актуальной версии Chrome, Edge или Safari.',preview:'Просмотр видео',previewFailed:'Сохраните MP4 и откройте его в видеоплеере.',shareFailed:'Не удалось поделиться видео. Можно сохранить MP4 или открыть редактор X.'},
  ko:{title:'로켓 시세 영상',close:'닫기',cancel:'생성 취소',source:'시세를 불러오는 중…',encoding:'영상 생성 중…',retry:'다시 시도',save:'MP4 저장',share:'영상 공유',post:'X에 게시',attach:'MP4를 저장한 다음 X 게시물 작성 화면에 영상을 첨부하세요.',empty:'시세 데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.',failed:'영상을 만들지 못했습니다. 다시 시도하세요.',unsupported:'이 브라우저에서는 MP4를 내보낼 수 없습니다. 최신 Chrome, Edge 또는 Safari를 사용하세요.',preview:'시세 영상 미리보기',previewFailed:'MP4를 저장한 후 동영상 플레이어에서 재생하세요.',shareFailed:'영상 공유를 마치지 못했습니다. MP4를 저장하거나 X에 게시할 수 있습니다.'},
};
const site='https://ethan-chunqi.github.io/kline-replay-lab/bulls-and-bears/';
const textFor=lang=>copy[String(lang||'').split('-')[0]]||copy.zh;

function filename(model) {
  const label=String(model.symbol||'Market').replace(/[^\p{L}\p{N}.-]+/gu,'-').slice(0,52);
  const stamp=new Date(Number.isFinite(model.currentTime)?model.currentTime:Date.now()).toISOString().replace(/:/g,'-').slice(0,19);
  return 'LiuShaYu-'+label+'-'+stamp+'.mp4';
}

export function createRocketDialog({getModel}) {
  const dialog=document.createElement('dialog');
  dialog.className='rocket-dialog';
  dialog.innerHTML='<header><h2></h2><button class="rocket-close" type="button" autofocus>×</button></header>'+
    '<div class="rocket-stage"><div class="rocket-progress"><div class="rocket-step"><span role="status"></span><output></output></div><progress max="1"></progress></div>'+
    '<video hidden controls playsinline preload="metadata"></video></div><p class="rocket-message" role="status" hidden></p>'+
    '<footer><button type="button" class="rocket-cancel"></button><button type="button" class="rocket-retry" hidden></button>'+
    '<a class="rocket-save" hidden></a><button type="button" class="rocket-share" hidden></button>'+
    '<a class="rocket-x" hidden target="_blank" rel="noopener noreferrer"></a></footer><p class="rocket-hint" hidden></p>';
  document.body.append(dialog);
  const el=selector=>dialog.querySelector(selector);
  const heading=el('h2'),close=el('.rocket-close'),cancel=el('.rocket-cancel'),retry=el('.rocket-retry');
  const stage=el('.rocket-stage'),meter=el('.rocket-progress'),progress=el('progress'),step=el('.rocket-step span'),percent=el('output');
  const video=el('video'),message=el('.rocket-message'),hint=el('.rocket-hint');
  const save=el('.rocket-save'),share=el('.rocket-share'),post=el('.rocket-x');
  let request,objectUrl,shareData,words;
  function localize(lang) {
    words=textFor(lang);
    heading.textContent=words.title;dialog.setAttribute('aria-label',words.title);
    close.setAttribute('aria-label',words.close);cancel.textContent=words.cancel;
    retry.textContent=words.retry;save.textContent=words.save;share.textContent=words.share;
    post.textContent=words.post;hint.textContent=words.attach;
    video.setAttribute('aria-label',words.preview);progress.setAttribute('aria-label',words.encoding);
  }
  function note(value='') {
    message.hidden=!value;message.textContent=value;
  }
  function clear() {
    request?.abort();request=null;shareData=null;
    video.pause();video.hidden=true;
    if(video.hasAttribute('src')){video.removeAttribute('src');video.load();}
    if(objectUrl)URL.revokeObjectURL(objectUrl);
    objectUrl=null;save.removeAttribute('href');save.removeAttribute('download');post.removeAttribute('href');
    for(const node of [save,share,post,hint,retry,cancel,meter])node.hidden=true;
    share.disabled=false;stage.hidden=false;stage.setAttribute('aria-busy','false');note();
  }
  const current=job=>dialog.open && job===request && !job.signal.aborted;
  async function generate() {
    clear();localize(document.documentElement.lang);
    const job=new AbortController();request=job;
    cancel.hidden=false;meter.hidden=false;stage.setAttribute('aria-busy','true');
    step.textContent=words.source;percent.textContent='';progress.removeAttribute('value');
    try {
      const [model,scene,encoder]=await Promise.all([getModel(job.signal),
        import('./rocket-scene.js?v=20261122-editorial'),import('./rocket-encode.js?v=20261122-editorial')]);
      if(!current(job))return;
      if(!model){note(words.empty);retry.hidden=false;return;}
      localize(model.lang||document.documentElement.lang);step.textContent=words.encoding;
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
      const drawFrame=await scene.createRocketScene(canvas,model);
      if(!current(job))return;
      const onProgress=value=>{
        if(!current(job) || !Number.isFinite(value))return;
        const fraction=Math.max(0,Math.min(1,value)), label=Math.round(100*fraction)+'%';
        if(percent.textContent!==label){percent.textContent=label;progress.value=fraction;}
      };
      onProgress(0);
      const blob=await encoder.encodeRocketMp4({canvas,drawFrame,signal:job.signal,onProgress});
      if(!current(job))return;
      if(!(blob instanceof Blob) || !blob.size)throw Error('Empty MP4');
      objectUrl=URL.createObjectURL(blob);
      const name=filename(model);
      save.download=name;save.href=objectUrl;save.hidden=false;
      video.src=objectUrl;video.hidden=false;
      const intent=new URL('https://twitter.com/intent/tweet');
      intent.searchParams.set('text',[model.symbol,model.moves?.find(move=>move.kind==='low')?.percentText].filter(Boolean).join(' · '));
      intent.searchParams.set('url',site);post.href=intent.href;
      if(typeof navigator.canShare==='function' && typeof navigator.share==='function' && typeof File==='function'){
        const payload={files:[new File([blob],name,{type:'video/mp4'})]};
        try{if(navigator.canShare(payload))shareData=payload;}catch{/* File sharing varies by browser. */}
      }
      share.hidden=!shareData;post.hidden=hint.hidden=Boolean(shareData);
    } catch(error) {
      if(!current(job))return;
      note(error?.code==='NO_DATA'?words.empty:error?.name==='NotSupportedError'||error?.code==='UNSUPPORTED'?words.unsupported:words.failed);
      retry.hidden=false;
    } finally {
      if(current(job)){stage.setAttribute('aria-busy','false');meter.hidden=true;cancel.hidden=true;stage.hidden=video.hidden;}
    }
  }
  function dismiss(){clear();dialog.close();}
  close.addEventListener('click',dismiss);cancel.addEventListener('click',dismiss);
  dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss();});
  dialog.addEventListener('close',()=>{if(!dialog.open)clear();});
  retry.addEventListener('click',generate);
  video.addEventListener('error',()=>{if(objectUrl && video.currentSrc===objectUrl)note(words.previewFailed);});
  share.addEventListener('click',async()=>{
    const job=request;
    if(!shareData||share.disabled)return;
    share.disabled=true;
    try {await navigator.share(shareData);}
    catch(error){if(current(job) && error?.name!=='AbortError'){note(words.shareFailed);post.hidden=hint.hidden=false;}}
    finally{if(current(job))share.disabled=false;}
  });
  return {open(){
    if(!dialog.open)dialog.showModal();
    return generate();
  }};
}
