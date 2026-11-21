const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const active=new WeakMap();
function play(node,frames,duration) {
  if(!node?.animate || reduced.matches)return;
  active.get(node)?.cancel();
  active.set(node,node.animate(frames,{duration,easing:'cubic-bezier(.2,.65,.3,1)'}));
}
export function reveal(node) {
  play(node,[{opacity:.5,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],230);
}
let lastFlash=0;
export function quoteTick(node,up) {
  if(performance.now()-lastFlash<600)return;
  lastFlash=performance.now();
  const style=getComputedStyle(node);
  const accent=style.getPropertyValue(up?'--up':'--down').trim();
  play(node,[{color:accent},{color:style.color}],450);
}
