const OVERLAP_EPSILON=1e-7;
export function audioOverlaps(clips){
  const events=[];
  for(const clip of clips){
    if(!Number.isFinite(clip.start)||!Number.isFinite(clip.duration)||clip.duration<=OVERLAP_EPSILON)continue;
    events.push({time:clip.start,id:clip.id,add:true},{time:clip.start+clip.duration,id:clip.id,add:false});
  }
  events.sort((a,b)=>a.time-b.time);
  const active=new Set(),ranges=[];
  let previous=null,index=0;
  while(index<events.length){
    const time=events[index].time;
    if(previous!==null&&time-previous>OVERLAP_EPSILON&&active.size>1){
      const clipIds=[...active].sort(),last=ranges.at(-1);
      if(last&&Math.abs(last.end-previous)<=OVERLAP_EPSILON&&last.clipIds.length===clipIds.length&&last.clipIds.every((id,i)=>id===clipIds[i]))last.end=time;
      else ranges.push({start:previous,end:time,clipIds});
    }
    while(index<events.length&&events[index].time===time){
      const event=events[index++];if(event.add)active.add(event.id);else active.delete(event.id);
    }
    previous=time;
  }
  return ranges;
}
export function projectOverlapState(tracks,destinations=new Map()){
  const state=new Map(tracks.map(track=>[track.id,{clips:[],ranges:[]}]));
  for(const track of tracks)for(const clip of track.clips){
    const target=state.get(destinations.get(clip.id))||state.get(track.id);
    target.clips.push(clip);
  }
  for(const value of state.values())value.ranges=audioOverlaps(value.clips);
  return state;
}
