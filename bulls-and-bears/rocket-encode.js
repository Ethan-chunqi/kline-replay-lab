// Export silent 16:9 AVC suitable for sharing directly as an MP4 file.
const WIDTH=1280, HEIGHT=720, FPS=24, FRAMES=FPS*6, BITRATE=5_000_000;
const nextTask=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function checkAbort(signal) {
  if(signal?.aborted)throw signal.reason || new DOMException('Cancelled','AbortError');
}

async function avcConfig() {
  if(!globalThis.VideoEncoder || !globalThis.VideoFrame)return null;
  for(const codec of ['avc1.42E01F','avc1.42001F','avc1.4D401F']) {
    const config={codec,width:WIDTH,height:HEIGHT,framerate:FPS,bitrate:BITRATE,
      latencyMode:'realtime',avc:{format:'avc'}};
    if((await VideoEncoder.isConfigSupported(config).catch(()=>null))?.supported)return config;
  }
  return null;
}

async function encodeFrames({canvas,drawFrame,signal,onProgress},config) {
  const {ArrayBufferTarget,Muxer}=await import('./vendor/mp4-muxer-5.2.2.mjs');
  checkAbort(signal);
  const target=new ArrayBufferTarget();
  const muxer=new Muxer({target,video:{codec:'avc',width:WIDTH,height:HEIGHT,frameRate:FPS},fastStart:'in-memory'});
  let failure, encoded=0;
  const encoder=new VideoEncoder({
    output(chunk,metadata) {
      if(failure || signal?.aborted)return;
      try {muxer.addVideoChunk(chunk,metadata);encoded++;} catch(error){failure=error;}
    },
    error(error){failure=error;},
  });
  const close=()=>{if(encoder.state!=='closed')encoder.close();};
  signal?.addEventListener('abort',close,{once:true});
  try {
    encoder.configure(config);
    for(let i=0;i<FRAMES;i++) {
      // Bound the number of live GPU buffers. Yield to input and cancellation
      // even when the hardware encoder consumes every frame immediately.
      while(encoder.encodeQueueSize>=5 && !failure && !signal?.aborted)await nextTask(4);
      checkAbort(signal);
      if(failure)throw failure;
      drawFrame(i/(FRAMES-1));
      const stamp=Math.round(i*1e6/FPS);
      const frame=new VideoFrame(canvas,{timestamp:stamp,duration:Math.round((i+1)*1e6/FPS)-stamp});
      try {encoder.encode(frame,{keyFrame:i%48===0});} finally {frame.close();}
      if(i%4===0) {
        onProgress?.(i/FRAMES);
        await nextTask(0);
      }
    }
    await encoder.flush();
    checkAbort(signal);
    if(failure)throw failure;
    if(encoded!==FRAMES)throw new Error('Incomplete AVC stream');
    muxer.finalize();
    return new Blob([target.buffer],{type:'video/mp4'});
  } finally {
    signal?.removeEventListener('abort',close);
    close();
  }
}

function recorderType(canvas) {
  if(!canvas.captureStream || !globalThis.MediaRecorder?.isTypeSupported)return null;
  return ['video/mp4;codecs=avc1.42E01F','video/mp4;codecs=avc1'].find(type=>MediaRecorder.isTypeSupported(type));
}

async function recordFrames({canvas,drawFrame,signal,onProgress},mimeType) {
  drawFrame(0);
  const stream=canvas.captureStream(FPS);
  const [track]=stream.getVideoTracks();
  let recorder, timer, abort;
  try {
    recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:BITRATE});
    return await new Promise((resolve,reject)=>{
      const chunks=[];
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onerror=event=>reject(event.error||new Error('AVC recording failed'));
      recorder.onstop=()=>chunks.length?resolve(new Blob(chunks,{type:'video/mp4'})):reject(new Error('Empty AVC stream'));
      abort=()=>reject(signal.reason||new DOMException('Cancelled','AbortError'));
      signal?.addEventListener('abort',abort,{once:true});
      checkAbort(signal);
      recorder.start();
      const start=performance.now();
      function step(i) {
        try {
          if(i===FRAMES){recorder.stop();return;}
          drawFrame(i/(FRAMES-1));
          track.requestFrame?.();
          if(i%4===0)onProgress?.(i/FRAMES);
          const next=start+(i+1)*1000/FPS;
          timer=setTimeout(()=>step(i+1),Math.max(0,next-performance.now()));
        }catch(error){reject(error);}
      }
      step(0);
    });
  } finally {
    clearTimeout(timer);
    if(abort)signal?.removeEventListener('abort',abort);
    if(recorder){
      recorder.onstop=recorder.onerror=recorder.ondataavailable=null;
      if(recorder.state!=='inactive')recorder.stop();
    }
    stream.getTracks().forEach(t=>t.stop());
  }
}

export async function encodeRocketMp4(options) {
  const {canvas,drawFrame,signal,onProgress}=options;
  checkAbort(signal);
  if(canvas?.width!==WIDTH || canvas.height!==HEIGHT || typeof drawFrame!=='function')
    throw new TypeError('Expected a 1280 × 720 canvas and drawFrame(progress)');
  const config=await avcConfig();
  checkAbort(signal);
  let blob;
  if(config) {
    try {blob=await encodeFrames(options,config);}
    catch(error){
      checkAbort(signal);
      // Devices can report support and then decline to allocate a hardware
      // encoder, for example while another application is using the GPU.
      if(!['NotSupportedError','OperationError','EncodingError','QuotaExceededError'].includes(error.name))throw error;
    }
  }
  if(!blob) {
    const type=recorderType(canvas);
    if(!type)throw Object.assign(new Error('H.264 export unavailable'),{code:'UNSUPPORTED'});
    blob=await recordFrames(options,type);
  }
  checkAbort(signal);
  onProgress?.(1);
  return blob;
}
