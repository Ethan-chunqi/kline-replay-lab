const family='Geist,"PingFang SC","Hiragino Sans","Apple SD Gothic Neo","Microsoft YaHei",Arial,sans-serif';

function font(ctx,size,weight) {
  ctx.font=weight+' '+size+'px '+family;
}

export function measureText(ctx,value,size,weight=500) {
  font(ctx,size,weight);
  return ctx.measureText(String(value)).width;
}

export function drawText(ctx,value,x,y,width,size,color,{weight=500,align='left',min=18}={}) {
  const s=String(value??'').trim()||'—';
  if(width<=0)return 0;
  const measured=measureText(ctx,s,size,weight);
  if(measured>width)font(ctx,Math.max(min,size*width/measured),weight);
  ctx.textBaseline='top';ctx.textAlign=align;ctx.fillStyle=color;
  ctx.fillText(s,x,y,width);
  ctx.textAlign='left';
  return Math.min(width,ctx.measureText(s).width);
}

export function wrapText(ctx,value,width,size,weight=500) {
  const s=String(value??'').trim()||'—';
  font(ctx,size,weight);
  const tokens=s.match(/[\p{Script=Latin}\p{Script=Cyrillic}\d][\p{Script=Latin}\p{Script=Cyrillic}\d.,:+%/×–−-]*|\s+|[^\s]/gu)||[s];
  const rows=[];
  let row='';
  for(const token of tokens) {
    if(row.trim() && ctx.measureText(row+token).width>width) {
      rows.push(row.trim());row=token.trimStart();
    } else row+=token;
  }
  if(row.trim())rows.push(row.trim());
  return rows;
}

export function rule(ctx,x,y,width,color) {
  ctx.fillStyle=color;ctx.fillRect(x,y,width,1.5);
}
