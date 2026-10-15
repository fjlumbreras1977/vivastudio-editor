// El desplazamiento empieza después de las cabeceras fijas de las pistas.
export function playheadScrollLeft({position,zoom,scrollLeft,clientWidth,scrollWidth,controlsWidth}){
  const max=Math.max(0,scrollWidth-clientWidth);
  const current=Math.max(0,Math.min(max,scrollLeft));
  if(position<=0)return 0;
  const width=clientWidth-controlsWidth;
  if(width<=0||zoom<=0||!Number.isFinite(position)||!Number.isFinite(zoom))return current;
  const cursor=position*zoom,margin=Math.min(64,width*.2);
  let next=current;
  if(cursor<current+margin)next=cursor-margin;
  else if(cursor>current+width-margin)next=cursor-width+margin;
  return Math.max(0,Math.min(max,next));
}
