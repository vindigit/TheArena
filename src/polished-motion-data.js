// Rig-specific integrated game motion. Source terms: public/assets/animation-credits.txt.
import pack from '../art/animation/polished-samples.json' with {type:'json'};
export const POLISHED_PACK = pack;
export function samplePolished(THREE, name, time=0) {
  const clip=pack.clips[name], frames=clip.samples;
  let t=clip.loop ? ((time%clip.duration)+clip.duration)%clip.duration : Math.max(0,Math.min(clip.duration,time));
  let index=Math.max(0,Math.min(frames.length-2,Math.floor(t*(frames.length-1)/Math.max(.00001,clip.duration))));
  while(index>0 && frames[index].time>t)index--;
  while(index<frames.length-2 && frames[index+1].time<t)index++;
  const a=frames[index],b=frames[index+1]||a, alpha=Math.max(0,Math.min(1,(t-a.time)/Math.max(.00001,b.time-a.time)));
  const out={time:t,rotations:{},visualGroundingY:(a.visualGroundingY||0)+((b.visualGroundingY||0)-(a.visualGroundingY||0))*alpha};
  for(const name of Object.keys(a.rotations))out.rotations[name]=new THREE.Quaternion().fromArray(a.rotations[name]).slerp(new THREE.Quaternion().fromArray(b.rotations[name]),alpha);
  if(a.ballLocal&&b.ballLocal)out.ballLocal=a.ballLocal.map((v,i)=>v+(b.ballLocal[i]-v)*alpha);
  out.pushWeight=(a.pushWeight||0)+((b.pushWeight||0)-(a.pushWeight||0))*alpha;
  out.handShapeState=a.handShapeState;
  out.contacts=alpha<.5?a.contacts:b.contacts;
  return out;
}
