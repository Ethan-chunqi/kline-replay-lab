// Vectors use chart media coordinates. The caller supplies a segment clipped to
// the visible price pane, and a cycle phase (or null for a still image).
const paint = {
  dark: {
    low:  {outer:'#20d9a0', edge:'#0c654f', start:'#179875', mid:'#47d6a9', end:'#93f4cc', glint:'#dbfff0'},
    high: {outer:'#ff805f', edge:'#853e48', start:'#bd505b', mid:'#f0807e', end:'#ffb092', glint:'#ffead4'},
  },
  light: {
    low:  {outer:'#11a27d', edge:'#14614f', start:'#157a67', mid:'#168e70', end:'#18a579', glint:'#b3ffde'},
    high: {outer:'#cf6658', edge:'#802e40', start:'#9b394c', mid:'#bb4650', end:'#d36349', glint:'#ffcfb6'},
  },
};

export function moveTrailColor(kind,theme='dark') {
  const color=(paint[theme]||paint.dark)[kind];
  return theme==='light'?color.start:color.end;
}

function axialGradient(ctx,start,end,colors) {
  const gradient=ctx.createLinearGradient(start,0,end,0);
  colors.forEach((value,i)=>gradient.addColorStop(i/(colors.length-1),value));
  return gradient;
}

// The tapered exhaust is local to the craft. Its axis coincides with the
// measured move, including when the price change projects almost vertically.
function plume(ctx,reentry,wave) {
  const length=(reentry?25:22)*(1+wave*.08);
  const nozzle=reentry?-4:-8, width=reentry?5:3.1;
  ctx.fillStyle=axialGradient(ctx,nozzle-length,nozzle,
    [reentry?'rgba(247,96,75,0)':'rgba(255,130,64,0)',reentry?'#eb715c':'#ffa14e','#ffe392']);
  ctx.beginPath();
  ctx.moveTo(nozzle,-width);
  ctx.bezierCurveTo(nozzle-length*.34,-width*.8,nozzle-length*.66,-.75,nozzle-length,0);
  ctx.bezierCurveTo(nozzle-length*.6,.7,nozzle-length*.31,width*1.05,nozzle,width);
  ctx.closePath();ctx.fill();
  ctx.fillStyle='#fff0ba';
  ctx.beginPath();ctx.moveTo(nozzle,-width*.45);
  ctx.quadraticCurveTo(nozzle-length*.25,-.75,nozzle-length*.65,0);
  ctx.quadraticCurveTo(nozzle-length*.20,1,nozzle,width*.46);
  ctx.closePath();ctx.fill();
}

function rocket(ctx) {
  ctx.lineJoin='round';ctx.lineWidth=1.15;ctx.strokeStyle='#12494e';ctx.fillStyle='#28ba9b';
  ctx.beginPath();
  ctx.moveTo(-3,-3);ctx.lineTo(-8,-7.4);ctx.lineTo(-10.3,-7.7);ctx.lineTo(-8.6,-2.1);
  ctx.lineTo(-8.6,2.1);ctx.lineTo(-10.3,7.7);ctx.lineTo(-8,7.4);ctx.lineTo(-3,3);
  ctx.closePath();ctx.fill();ctx.stroke();
  const metal=ctx.createLinearGradient(0,-4,0,4.5);
  metal.addColorStop(0,'#ffffff');metal.addColorStop(.48,'#d8f7f2');metal.addColorStop(1,'#73a6b0');
  ctx.fillStyle=metal;
  ctx.beginPath();ctx.moveTo(-8.5,-2.45);
  ctx.bezierCurveTo(-3.5,-5.2,5,-4.95,11.8,0);
  ctx.bezierCurveTo(5,4.95,-3.5,5.2,-8.5,2.45);
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#137c91';ctx.beginPath();ctx.arc(2.3,-.45,2.15,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#a7f8ff';ctx.beginPath();ctx.arc(2,-1,.7,0,Math.PI*2);ctx.fill();
}

function satellite(ctx) {
  // Paired photovoltaic arrays, two panel divisions and a gold-foil bus
  // give the satellite a different silhouette even at a small display size.
  ctx.rotate(-.34);ctx.lineCap='butt';ctx.lineJoin='round';
  ctx.strokeStyle='#8aaeb8';ctx.lineWidth=1.7;
  ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(0,10);ctx.stroke();
  const cells=ctx.createLinearGradient(-4,0,4,0);
  cells.addColorStop(0,'#173f60');cells.addColorStop(.62,'#326d94');cells.addColorStop(1,'#5d99ba');
  for(const y of [-12.6,5.7]) {
    ctx.fillStyle=cells;ctx.fillRect(-3.6,y,7.2,6.9);
    ctx.strokeStyle='#afccd6';ctx.lineWidth=.8;ctx.strokeRect(-3.6,y,7.2,6.9);
    ctx.strokeStyle='#79a5bf';ctx.lineWidth=.55;
    ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(0,y+6.9);
    ctx.moveTo(-3.6,y+3.45);ctx.lineTo(3.6,y+3.45);ctx.stroke();
  }
  ctx.fillStyle=axialGradient(ctx,-5.5,5.5,['#bb7746','#ffd594','#edaa64']);
  ctx.strokeStyle='#623d39';ctx.lineWidth=1.05;
  ctx.beginPath();ctx.roundRect(-5.5,-4.2,10.3,8.4,1.35);ctx.fill();ctx.stroke();
  ctx.fillStyle='#fff0cb';ctx.fillRect(-3.7,-2.7,1.65,5.4);
  ctx.strokeStyle='#785446';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(4,0);ctx.lineTo(8.7,0);ctx.stroke();
  ctx.fillStyle='#eadbd2';ctx.beginPath();ctx.moveTo(9,-3.6);
  ctx.quadraticCurveTo(3.8,0,9,3.6);ctx.closePath();ctx.fill();ctx.stroke();
}

export function drawMoveTrail(ctx,{segment,kind,theme='dark',phase=null,scale=1,compact=false}) {
  const color=(paint[theme]||paint.dark)[kind];
  if(!color || !segment || segment.length!==4 || !segment.every(Number.isFinite) || !(scale>0))return;
  const [x0,y0,x1,y1]=segment;
  const dx=x1-x0,dy=y1-y0,length=Math.hypot(dx,dy)/scale;
  if(length<.25 || !Number.isFinite(length))return;
  const falling=kind==='high';
  ctx.save();
  ctx.translate(x0,y0);ctx.rotate(Math.atan2(dy,dx));ctx.scale(scale,scale);
  ctx.lineCap='butt';ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(length,0);
  // Broad soft edges and a narrow reflection keep the core legible against
  // candle bodies in both palettes, with no blur filter on each animation step.
  const opacity=ctx.globalAlpha;
  ctx.strokeStyle=color.outer;ctx.lineWidth=8;ctx.globalAlpha=opacity*.11;ctx.stroke();
  ctx.lineWidth=5.7;ctx.globalAlpha=opacity*.17;ctx.stroke();
  ctx.strokeStyle=color.edge;ctx.lineWidth=4.5;ctx.globalAlpha=opacity*(falling?.42:.8);ctx.stroke();
  if(falling)ctx.setLineDash([10,3.3]);
  ctx.strokeStyle=axialGradient(ctx,0,length,[color.start,color.mid,color.end]);
  ctx.lineWidth=3.65;ctx.globalAlpha=opacity;ctx.stroke();
  ctx.strokeStyle=color.glint;ctx.lineWidth=.85;ctx.globalAlpha=opacity*.62;
  ctx.beginPath();ctx.moveTo(0,-.55);ctx.lineTo(length,-.55);ctx.stroke();
  ctx.setLineDash([]);ctx.globalAlpha=opacity;

  const craftScale=Math.min(compact?.82:1,length/58);
  const margin=34*craftScale;
  if(craftScale>=.55) {
    const moving=Number.isFinite(phase);
    const progress=moving?((phase%1)+1)%1:(falling?.37:.68);
    const nose=margin+(length-margin-15*craftScale)*progress;
    ctx.translate(nose,0);ctx.scale(craftScale,craftScale);
    if(moving)ctx.globalAlpha=opacity*Math.min(1,progress/.055,(1-progress)/.055);
    const wave=moving?Math.sin(progress*6*Math.PI):0;
    plume(ctx,falling,wave);
    if(falling)satellite(ctx);else rocket(ctx);
  }
  ctx.restore();
}
