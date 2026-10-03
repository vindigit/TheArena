// Gameplay adapter: accepted sampled body, live world plants, no root tracks.
import {createPoseAdapter as createLegacy, LUKE_PHYSICAL_PALMS} from './player-pose.js';
import {POLISHED_PACK,samplePolished} from './polished-motion-data.js';
import {createAbsoluteHandProbe} from './hand-absolute-clearance.js';
export function createPolishedPoseAdapter(THREE,visual,bones,anchors) {
 const absoluteProbe=createAbsoluteHandProbe(THREE,visual);
 let skinMesh;visual.traverse(o=>{if(o.isSkinnedMesh)skinMesh=o});
 const shoeIndices=Object.fromEntries(['right','left'].map(side=>{const g=skinMesh.geometry,j=skinMesh.skeleton.bones.findIndex(b=>b.name===side+'_foot'),ids=[];for(let i=0;i<g.attributes.position.count;i++){let weight=0;for(let k=0;k<4;k++)if(g.attributes.skinIndex.getComponent(i,k)===j)weight+=g.attributes.skinWeight.getComponent(i,k);if(weight>.5)ids.push(i)}return[side,ids]}));
 function shoeMinimum(side){visual.updateWorldMatrix(true,true);skinMesh.updateMatrixWorld(true);skinMesh.skeleton.update();const point=new THREE.Vector3();let min=Infinity;for(const i of shoeIndices[side]){skinMesh.getVertexPosition(i,point).applyMatrix4(skinMesh.matrixWorld);min=Math.min(min,point.y)}return min;}
 const legacy=createLegacy(THREE,visual,bones,anchors), get=n=>bones.get(n),V=(...v)=>new THREE.Vector3(...v),Q=()=>new THREE.Quaternion();
 const rest=new Map([...bones].map(([n,b])=>[n,{p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()}]));
 const lower=['pelvis',...['right','left'].flatMap(s=>['thigh','shin','foot'].map(p=>s+'_'+p))];
 let heldBall=null,age=0,dribbleAge=0,clip=null,priorClip=null,blendAge=1,previous=new Map(),previousOffset=0,stanceOffset=0,stance=null,stopping=false,plantSide=null,footLocks={},lockSerial=0,lastFeet={},lastFootRotations={},shotFeet=null,diagnostic={},contact={},lastBall=null;
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t)};
 const wp=b=>b.getWorldPosition(V()),wq=b=>b.getWorldQuaternion(Q());
 function poseReset(){visual.position.set(0,0,0);for(const[n,b]of bones){b.position.copy(rest.get(n).p);b.quaternion.copy(rest.get(n).q);b.scale.copy(rest.get(n).s)}}
 function twoBone(upper,lower,effector,target,pole) {
   visual.updateWorldMatrix(true,true);
   const start=wp(upper),joint=wp(lower),end=wp(effector),a=start.distanceTo(joint),b=joint.distanceTo(end),direction=target.clone().sub(start),distance=Math.max(.001,Math.min(a+b-.00001,direction.length()));direction.normalize();
   const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
   const bend=pole.clone().sub(start).addScaledVector(direction,-pole.clone().sub(start).dot(direction)).normalize();
   const mid=start.clone().addScaledVector(direction,along).addScaledVector(bend,height),goal=start.clone().addScaledVector(direction,distance);
   const uq=Q().setFromUnitVectors(joint.clone().sub(start).normalize(),mid.clone().sub(start).normalize()).multiply(wq(upper));
   upper.quaternion.copy(wq(upper.parent).invert().multiply(uq));visual.updateWorldMatrix(true,true);
   const lq=Q().setFromUnitVectors(wp(effector).sub(wp(lower)).normalize(),goal.clone().sub(mid).normalize()).multiply(wq(lower));
   lower.quaternion.copy(wq(lower.parent).invert().multiply(lq));visual.updateWorldMatrix(true,true);
 }
 function solveFoot(side,lock){
   const thigh=get(side+'_thigh'),shin=get(side+'_shin'),foot=get(side+'_foot');
   const knee=wp(shin),forward=V(0,0,-1).transformDirection(visual.matrixWorld);
   twoBone(thigh,shin,foot,lock.position,knee.addScaledVector(forward,.12));
   foot.quaternion.copy(wq(foot.parent).invert().multiply(lock.rotation));visual.updateWorldMatrix(true,true);
   return wp(foot).distanceTo(lock.position);
 }
 function armContact(side,ball,normal,weight=1,surfaceOverride=null,contactRequired=weight>.99){
  const palm=LUKE_PHYSICAL_PALMS[side],hand=get(side+'_hand'),upper=get(side+'_upper_arm'),fore=get(side+'_forearm');
  const surface=ball.clone().addScaledVector(normal,-.12),old=hand.localToWorld(V(...palm.offset));
  const blendedSurface=surfaceOverride||old.clone().lerp(surface,weight);
  const worldNormal=V(...palm.normal).applyQuaternion(wq(hand)).normalize();
  const handQ=Q().setFromUnitVectors(worldNormal,normal).multiply(wq(hand));
  const currentQ=wq(hand);currentQ.slerp(handQ,weight);
  const target=blendedSurface.clone().sub(V(...palm.offset).applyQuaternion(currentQ));
  const pole=wp(fore).add(V(side==='right'?.12:-.12,0,.06).transformDirection(visual.matrixWorld).multiplyScalar(.12));
  twoBone(upper,fore,hand,target,pole);
  hand.quaternion.copy(wq(hand.parent).invert().multiply(currentQ));visual.updateWorldMatrix(true,true);
  const actual=hand.localToWorld(V(...palm.offset)),n=V(...palm.normal).applyQuaternion(wq(hand)).normalize();
  contact[side]={required:contactRequired,error:actual.distanceTo(surface),ballSurfaceError:Math.abs(actual.distanceTo(ball)-.12),normalDot:n.dot(ball.clone().sub(actual).normalize()),actual:visual.worldToLocal(actual.clone()).toArray(),target:visual.worldToLocal(surface.clone()).toArray(),phase:clip};
 }
 function update(dt=1/60,state={}) {
  const speed=Math.max(0,state.speed||0),jump=state.jump||0,pickup=Number.isFinite(state.pickupProgress),finish=['layup','dunk'].includes(state.action);
  // The layup is sampled from the video-captured clip; dunks keep the legacy pose.
  const layup=state.action==='layup'&&!pickup&&!!POLISHED_PACK.clips.layup;heldBall=null;
  if(pickup||(finish&&!layup)){legacy.update(dt,state);clip=pickup?'legacy-pickup':state.action;contact=legacy.diagnostics().contact||{};diagnostic={...legacy.diagnostics(),clip,owner:'luke-polished-with-legacy-pickup-finishes'};footLocks={};previous.clear();return;}
  const shoot=state.action==='shoot'&&Number.isFinite(state.shootElapsed),gather=state.charging;
  const isStop=state.stopElapsed!==null&&state.stopElapsed!==undefined&&state.stopElapsed<.30&&!gather&&!shoot;
  clip=shoot?'shoot':layup?'layup':gather?'gather':isStop?'stop':speed>.15?(state.ballMode==='dribble'?'dribble':'run'):state.ballMode==='dribble'?'stationary-dribble':'ready';
  if(clip!==priorClip){blendAge=0;
    if(shoot)shotFeet=Object.fromEntries(['right','left'].map(side=>[side,{position:(lastFeet[side]||wp(get(side+'_foot'))).clone(),rotation:(lastFootRotations[side]||wq(get(side+'_foot'))).clone()}]));
    if(isStop||gather||clip==='stationary-dribble'||clip==='ready'){
    visual.updateWorldMatrix(true,true);stance=new Map(lower.map(n=>[n,get(n).quaternion.clone()]));stanceOffset=visual.position.y;
    if(isStop){const root=visual.parent;const left=root.worldToLocal(wp(get('left_foot'))),right=root.worldToLocal(wp(get('right_foot')));plantSide=left.z<right.z?'left':'right';}
  }}
  age+=dt*Math.max(.2,speed/2.5);dribbleAge+=dt*Math.max(.65,Math.min(1.55,speed>0.15?speed/1.6:1));blendAge+=dt;
  let selected=shoot?'shoot':layup?'layup':gather?'gather':clip==='run'?'run':clip==='ready'||(isStop&&state.ballMode!=='dribble')?'ready':'moving_dribble';
  let time=shoot?state.shootElapsed:layup?(state.finishElapsed||0):gather?Math.min(POLISHED_PACK.clips.gather.duration,state.gatherElapsed||0):selected==='run'?age:((state.dribblePhase||0)/(Math.PI*2)-.25)*.8;
  const sample=samplePolished(THREE,selected,time);poseReset();
  if(!previous.size&&!gather&&!shoot){stance=new Map(lower.map(n=>[n,new THREE.Quaternion().fromArray(POLISHED_PACK.clips.ready.samples[0].rotations[n])]));stanceOffset=POLISHED_PACK.clips.ready.samples[0].visualGroundingY;}
  for(const[n,q]of Object.entries(sample.rotations))if(get(n))get(n).quaternion.copy(q);
  visual.position.y=sample.visualGroundingY;
  if((clip==='stationary-dribble'||clip==='ready'||isStop||gather)&&stance){for(const n of lower)get(n).quaternion.copy(stance.get(n));visual.position.y=stanceOffset;}
  if(isStop){get('pelvis').position.y-=.065*smooth(state.stopElapsed/.16);}
  // Blend from the actual last pose, so stop/resume and early input interrupt
  // from the displayed body instead of a presumed authored clip boundary.
  const blend=smooth(blendAge/(shoot?.055:.11));
  if(previous.size&&blend<1){for(const[n,b]of bones)b.quaternion.copy(previous.get(n)?.clone().slerp(b.quaternion,blend)||b.quaternion);visual.position.y=previousOffset+(visual.position.y-previousOffset)*blend;}
  visual.updateWorldMatrix(true,true);
  // The imported shot contains a large source-stage yaw inside the pelvis.
  // Gameplay facing owns yaw; remove the sampled torso heading without changing
  // its lean, lift, wrist flick, or the player's requested root direction.
  if(shoot){
    const rootHeading=wq(visual.parent),forward=V(0,0,-1).applyQuaternion(wq(get('chest'))).applyQuaternion(rootHeading.invert());
    const sourceYaw=Math.atan2(-forward.x,-forward.z);
    get('pelvis').quaternion.premultiply(Q().setFromAxisAngle(V(0,1,0),-sourceYaw));
    visual.updateWorldMatrix(true,true);
  }
  // Return stationary landing feet to their actual takeoff anchors. The
  // source clip's lateral shift is not gameplay translation authority.
  if(shoot&&shotFeet&&(state.shootElapsed>.2||state.shootElapsed<1e-8)){
    const returnWeight=state.shootElapsed<1e-8?1:smooth((state.shootElapsed-.2)/.2);
    for(const side of ['right','left']){
      const foot=get(side+'_foot'),now=wp(foot),anchor=shotFeet[side];
      const target=now.clone();target.x+=(anchor.position.x-now.x)*returnWeight;target.z+=(anchor.position.z-now.z)*returnWeight;
      solveFoot(side,{position:target,rotation:wq(foot).slerp(anchor.rotation,returnWeight)});
    }
  }
  const footErrors={},footInfo={};
  for(const side of['right','left']){
    const foot=get(side+'_foot'),now=wp(foot),local=visual.worldToLocal(now.clone()),velocity=lastFeet[side]?now.clone().sub(lastFeet[side]).multiplyScalar(1/Math.max(dt,1e-5)):V();
    const plantedState=isStop||gather||clip==='stationary-dribble'||clip==='ready'||(shoot&&state.shootElapsed>=.4-1e-8);
    const sourceSoleY=shoeMinimum(side);
    const desired=jump<.012&&(plantedState||sourceSoleY<.035);
    if(!desired)delete footLocks[side];
    if(desired&&!footLocks[side]){footLocks[side]={id:++lockSerial,position:now.clone(),rotation:wq(foot),age:0};footLocks[side].position.y=now.y-sourceSoleY+.002;}
    const lock=footLocks[side];
    if(lock){lock.age+=dt;const maxAge=plantedState?Infinity:.26/Math.max(.65,speed/2.5);if(lock.age>maxAge||wp(get(side+'_thigh')).distanceTo(lock.position)>.87){delete footLocks[side];}else footErrors[side]=solveFoot(side,lock);}
    // A low swing/transition shoe is lifted vertically, without inventing a horizontal plant.
    let floorCorrection=0;const low=shoeMinimum(side);
    if(low<0&&!footLocks[side]){floorCorrection=.002-low;solveFoot(side,{position:wp(foot).add(V(0,floorCorrection,0)),rotation:wq(foot)});}
    footInfo[side]={sourceSoleY,floorCorrection,displayedSoleMinY:shoeMinimum(side),locked:!!footLocks[side],lockId:footLocks[side]?.id||null,lockAge:footLocks[side]?.age||0,world:wp(foot).toArray(),sourceAnkleHeightAboveRoot:now.y-(state.rootWorld?.[1]||0),sourceLocalY:local.y,sourceWorldVelocity:velocity.toArray(),target:footLocks[side]?.position.toArray(),error:footErrors[side]||0};lastFeet[side]=wp(foot);lastFootRotations[side]=wq(foot);
  }
  contact={};
  if(Array.isArray(state.ballLocal)&&!shoot){
   const ball=visual.parent.localToWorld(V(...state.ballLocal));
   if(gather){const acquisition=smooth((state.gatherElapsed||0)/.25);armContact('right',ball,V(0,1,0),acquisition);armContact('left',ball,V(1,0,0).transformDirection(visual.parent.matrixWorld),acquisition);}
   else if(state.ballMode==='dribble'){
    const u=(((state.dribblePhase||0)/(Math.PI*2)-.25)%1+1)%1;
    const push=u<=.20?1:u<.32?1-smooth((u-.20)/.12):u>.90?smooth((u-.90)/.10):0;
    // Withdraw above the ball, never through the old source's ball corridor.
    const surface=ball.clone().add(V(0,.12,0));
    const ready=visual.parent.localToWorld(V(state.ballLocal[0],1.44,-.20));
    const reach=ready.lerp(surface,push);
    armContact('right',ball,V(0,-1,0),1,reach,push>.99);
   }
  }
  // Layup: the ball rides the captured right palm. It blends in from where
  // the dribble left it, then the right arm is solved onto that path without
  // changing the captured hand orientation.
  if(layup&&state.ballMode==='finish'&&sample.ballLocal){
   const held=V(...sample.ballLocal);
   if(Array.isArray(state.finishOriginLocal))held.lerpVectors(V(...state.finishOriginLocal),held.clone(),smooth((state.finishElapsed||0)/.20));
   heldBall=held;
   const normal=V(...LUKE_PHYSICAL_PALMS.right.normal).applyQuaternion(wq(get('right_hand'))).normalize();
   armContact('right',visual.parent.localToWorld(held.clone()),normal,1);
  }
  // Shot's final rise uses exact parent-local ball target while attached;
  // after release, sampled accepted follow-through owns both arms again.
  if(shoot&&state.ballMode==='gather'&&Array.isArray(state.ballLocal)){
   const ball=visual.parent.localToWorld(V(...state.ballLocal));
   const acquisition=smooth(state.shootElapsed/.10);
   armContact('right',ball,V(0,1,0),acquisition);
   const guide=acquisition*(1-smooth((state.shootElapsed-.12)/.08));
   if(guide>0)armContact('left',ball,V(1,0,0).transformDirection(visual.parent.matrixWorld),guide);
  }
  visual.updateWorldMatrix(true,true);
  for(const side of['right','left'])anchors[side+'Hand'].position.copy(visual.parent.worldToLocal(get(side+'_hand').localToWorld(V(...LUKE_PHYSICAL_PALMS[side].offset))));
  anchors.chest.position.copy(visual.parent.worldToLocal(wp(get('chest'))));anchors.head.position.copy(visual.parent.worldToLocal(wp(get('head'))));
  previous=new Map([...bones].map(([n,b])=>[n,b.quaternion.clone()]));previousOffset=visual.position.y;priorClip=clip;lastBall=state.ballLocal||null;
  diagnostic={owner:'luke-polished-sampled',clip,sourceClip:selected,sourceTime:time,contact,footInfo,footCorrection:true,plantSide,grounding:'world-space planted ankle IK',samplePack:POLISHED_PACK.schema||'private',fallback:null};
 }
 function resolveBallClearance(dt,ballWorld,radius=.12) {
   if(!ballWorld?.isVector3)return;
   const before=absoluteProbe.measure(ballWorld,radius),corrections={right:0,left:0};
   for(const side of ['right','left']){
     for(let iteration=0;iteration<8;iteration++){
       const hit=absoluteProbe.measure(ballWorld,radius)[side];
       if(hit.distance>=radius+.002)break;
       const hand=get(side+'_hand'),upper=get(side+'_upper_arm'),fore=get(side+'_forearm');
       const normal=V(...hit.closest).sub(ballWorld);
       if(normal.lengthSq()<1e-10)normal.copy(wp(hand)).sub(ballWorld);
       normal.normalize();
       const amount=Math.min(.055,radius+.002-hit.distance),orientation=wq(hand),wrist=wp(hand).addScaledVector(normal,amount);
       const pole=wp(fore);
       twoBone(upper,fore,hand,wrist,pole);
       hand.quaternion.copy(wq(hand.parent).invert().multiply(orientation));
       corrections[side]+=amount;visual.updateWorldMatrix(true,true);
     }
   }
   const after=absoluteProbe.measure(ballWorld,radius);
   for(const side of ['right','left']){
     const hand=get(side+'_hand'),actualWorld=hand.localToWorld(V(...LUKE_PHYSICAL_PALMS[side].offset));
     anchors[side+'Hand'].position.copy(visual.parent.worldToLocal(actualWorld.clone()));
     const c=contact[side];if(c){const local=visual.worldToLocal(actualWorld.clone()),target=V(...c.target);c.actual=local.toArray();c.error=local.distanceTo(target);c.ballSurfaceError=Math.abs(actualWorld.distanceTo(ballWorld)-radius);c.clearanceCorrection=corrections[side];}
   }
   diagnostic.absoluteHandClearance={before,after,corrections,scope:'All neutral hand-region triangles against actual displayed ball; morph guard follows'};
   diagnostic.contact=contact;
 }
 return {update,resolveBallClearance,recordDisplayedHandClearance(ballWorld,radius=.12){if(diagnostic.absoluteHandClearance)diagnostic.absoluteHandClearance.displayed=absoluteProbe.measure(ballWorld,radius,true);},reset(){legacy.reset();heldBall=null;age=0;dribbleAge=0;clip=null;priorClip=null;blendAge=1;previous.clear();stance=null;footLocks={};lastFeet={};lastFootRotations={};shotFeet=null;contact={};diagnostic={};poseReset();},diagnostics:()=>diagnostic,getHeldBallLocal:target=>heldBall?(target||V()).copy(heldBall):legacy.getHeldBallLocal(target)};
}
