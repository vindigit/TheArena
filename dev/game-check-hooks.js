// Appended only by prepare-player-check.mjs to the ignored actual-game module.
await player.group.userData.assetReady;
const stableRefs=[player.group,player.rightHand,player.leftHand,player.chest,player.head];
let checkNow=performance.now();
function checkStep(frames=1,dt=1/120){for(let i=0;i<frames;i++){checkNow+=dt*1000;update(dt,checkNow);}renderer.render(scene,camera);}
function clearCheckInput(){Object.assign(input,{forward:false,backward:false,left:false,right:false,sprint:false,touchX:0,touchY:0});}
function checkArray(value){return Array.isArray(value)?value:value?.toArray?.()||null;}
const checkHandMeshes = new WeakMap();
function checkHandClearance(rig) {
 if (!rig?.visual) return null;
 let entries = checkHandMeshes.get(rig.visual);
 if (!entries) {
  entries = [];
  rig.visual.traverse(mesh => {
   if (!mesh.isSkinnedMesh) return;
   const index = mesh.geometry.index, skinIndex = mesh.geometry.attributes.skinIndex, skinWeight = mesh.geometry.attributes.skinWeight;
   for (const side of ['right','left']) {
    const joint = mesh.skeleton.bones.findIndex(bone => bone.name === side+'_hand'), vertices = [];
    for (let i=0;i<skinIndex.count;i++) {
     let weight=0;
     for (let slot=0;slot<4;slot++) if (skinIndex.getComponent(i,slot)===joint) weight+=skinWeight.getComponent(i,slot);
     if (weight===1) vertices.push(i);
    }
    const owned=new Set(vertices), triangles=[];
    for (let i=0;i<index.count;i+=3) {
     const tri=[index.getX(i),index.getX(i+1),index.getX(i+2)];
     if (tri.every(vertex=>owned.has(vertex))) triangles.push(tri);
    }
    entries.push({mesh,side,vertices,triangles});
   }
  });
  checkHandMeshes.set(rig.visual,entries);
 }
 const result={}, triangle=new THREE.Triangle(), closest=new THREE.Vector3();
 for (const {mesh,side,vertices,triangles} of entries) {
  const points={runtime:new Map(),neutral:new Map()}, distances={runtime:Infinity,neutral:Infinity};
  for (const vertex of vertices) {
   points.runtime.set(vertex,mesh.getVertexPosition(vertex,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
   const neutral=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,vertex);
   mesh.applyBoneTransform(vertex,neutral);points.neutral.set(vertex,neutral.applyMatrix4(mesh.matrixWorld));
  }
  let addedTriangleIntrusion=0,worstAddedTriangle=null;
  for (const ids of triangles) {
   const intrusions={};
   for (const mode of ['runtime','neutral']) {
    triangle.set(...ids.map(id=>points[mode].get(id)));triangle.closestPointToPoint(game.ball.position,closest);
    const distance=closest.distanceTo(game.ball.position);distances[mode]=Math.min(distances[mode],distance);
    intrusions[mode]=Math.max(0,BALL_RADIUS-distance);
   }
   if (intrusions.runtime-intrusions.neutral>addedTriangleIntrusion) {
    addedTriangleIntrusion=intrusions.runtime-intrusions.neutral;worstAddedTriangle={vertices:ids,...intrusions};
   }
  }
  const runtime=Math.max(0,BALL_RADIUS-distances.runtime),neutral=Math.max(0,BALL_RADIUS-distances.neutral);
  result[side]={runtimeTriangleIntrusion:runtime,neutralTriangleIntrusion:neutral,addedTriangleIntrusion,worstAddedTriangle,
   runtimeTriangleDistance:distances.runtime,runtimeTriangleGap:Math.max(0,distances.runtime-BALL_RADIUS),neutralTriangleDistance:distances.neutral,
   handVertices:vertices.length,handTriangles:triangles.length,ballMode:game.ball.mode,
   limitation:'Actual displayed ball sphere vs posed rigid hand triangles; original overlap reported separately. No body/shorts collision approval.'};
 }
 return result;
}
function checkSnapshot(){const rig=player.getRigInspection();player.group.updateMatrixWorld(true);return{
 source:'actual src/main.js gameplay',simulationNow:checkNow,elapsed:game.elapsed,
 status:player.group.userData.assetStatus,asset:player.group.userData.playerAsset,animation:player.getAnimationDiagnostics(),handClearance:checkHandClearance(rig),
 jumpY:game.player.jumpY,shotPending:game.player.shotPending,shotReleaseCount:game.player.shotReleaseCount,actionTime:game.player.actionTime,action:game.player.action,charge:game.charge.active,progress:game.player.actionProgress,position:game.player.position.toArray(),speed:game.player.currentSpeed,
 ballMode:game.ball.mode,ball:game.ball.position.toArray(),hand:player.getRightHandWorldPosition().toArray(),leftHand:player.getLeftHandWorldPosition().toArray(),heldBall:player.getHeldBallWorldPosition?.()?.toArray?.()||null,score:game.score,yaw:game.cameraYaw,pitch:game.cameraPitch,cameraDistance:game.cameraDistance,coarsePointer,
 presentation:{pickup:game.player.presentationPickup?{elapsed:game.player.presentationPickup.elapsed,origin:checkArray(game.player.presentationPickup.origin)}:null,gather:game.player.presentationGather?{elapsed:game.charge.value*1.3,origin:checkArray(game.player.presentationGather.origin)}:null,finish:game.player.presentationFinish?{elapsed:game.player.actionTime,origin:checkArray(game.player.presentationFinish.origin)}:null,releaseLocal:checkArray(game.player.presentationReleaseLocal)},
 bones:rig?Object.fromEntries([...rig.bones].map(([n,b])=>[n,{q:b.quaternion.toArray(),p:b.position.toArray(),world:b.getWorldPosition(new THREE.Vector3()).toArray()}])):null};}
window.arenaPlayerCheck={
 snapshot:checkSnapshot,step:checkStep,
 pause(){renderer.setAnimationLoop(null);},resume(){renderer.setAnimationLoop(render);},
 evidenceView(view='comparison'){const offset={comparison:[3.4,2.5,-5.4],front:[0,1.7,-3.8],side:[3.8,1.7,0],'three-quarter':[2.7,1.8,-3.1]}[view]||[1.6,1.9,3.2];camera.position.copy(player.group.position).add(new THREE.Vector3(...offset).applyAxisAngle(new THREE.Vector3(0,1,0),game.player.yaw));camera.lookAt(player.group.position.clone().add(new THREE.Vector3(0,1.35,0)));camera.updateMatrixWorld(true);renderer.render(scene,camera);return checkSnapshot();},
 reset(){renderer.setAnimationLoop(null);clearCheckInput();resetPossession(false);checkNow=performance.now();game.started=true;startButton.hidden=true;checkStep();return checkSnapshot();},
 prepareWalk(frames=42){this.reset();input.forward=true;checkStep(frames);return checkSnapshot();},
 gatherFrame(frames=1){if(!game.charge.active){checkNow=performance.now();startCharge(checkNow);}clearCheckInput();checkStep(frames);return checkSnapshot();},
 release(){releaseJumpShot(checkNow);checkStep();return checkSnapshot();},
 pickupFrame(frames=1){this.prepareWalk();game.ball.mode='loose';game.ball.position.copy(game.player.position).add(new THREE.Vector3(.3,.12,0));setBallPosition(game.ball.position);checkStep(frames);return checkSnapshot();},
 // Place only an existing loose ball. Possession still changes through the
 // game's real updateLooseBall proximity path, never through the harness.
 placeLooseBall(offset=[.3,.12,-.12]){game.ball.mode='loose';game.ball.velocity.set(0,0,0);const target=new THREE.Vector3(...offset);player.group.localToWorld(target);setBallPosition(target);return checkSnapshot();},
 preparePickup({moving=true,offset=[.3,.12,-.12],walkFrames=42}={}){this.reset();if(moving){input.forward=true;checkStep(walkFrames);}this.placeLooseBall(offset);return checkSnapshot();},
 stopMovement(frames=1){clearCheckInput();checkStep(frames);return checkSnapshot();},
 // Continuous review uses the real movement/possession/charge paths. The
 // capture tool encodes one image per fixed update at the same 60 Hz.
 visualSequenceFrame(frame,{sequence='moving-pickup-dribble',pickupOrigin=[.35,.12,-.15],sprint=false,gatherSeconds=.65,pickupInterruptProgress=.5}={}){
  if(frame===0){this.reset();input.forward=true;input.sprint=sprint;}
  if(sequence==='moving-pickup-dribble'||sequence==='moving-pickup-gather-release'){
   if(frame===60)this.placeLooseBall(pickupOrigin);
   if(sequence==='moving-pickup-gather-release') {
    const gatherFrame=60+Math.round(pickupInterruptProgress*.72*60),releaseFrame=gatherFrame+Math.round(gatherSeconds*60);
    if(frame===gatherFrame){clearCheckInput();startCharge(checkNow);}
    if(frame===releaseFrame)releaseJumpShot(checkNow);
    if(frame===releaseFrame+Math.ceil(.44*60)+12)input.forward=true;
   }
  }else if(sequence==='moving-gather-release-recovery'){
   if(frame===60){clearCheckInput();startCharge(checkNow);}
   const releaseFrame=60+Math.round(gatherSeconds*60);
   if(frame===releaseFrame)releaseJumpShot(checkNow);
   if(frame===releaseFrame+Math.ceil(.44*60)+12)input.forward=true;
  }else throw new Error('Unknown visual review sequence: '+sequence);
  checkStep(1,1/60);return checkSnapshot();
 },
 startGather(){startCharge(checkNow);return checkSnapshot();},
 startFinishCase(kind='layup'){this.reset();game.player.position.set(0,0,kind==='dunk'?-4.1:-2.5);game.player.currentSpeed=kind==='dunk'?2.2:0;player.group.position.copy(game.player.position);checkStep(1,0);startFinish();return checkSnapshot();},
 // Fixed 60 Hz updates, with repeated possession recovery, two arbitrary
 // release charges, a pickup-to-gather interruption and both existing finishes.
 replayPart2Frame(frame){
  const local=frame%600;
  if(local===0)this.reset();
  if(local===12)input.forward=true;
  if(local===54)clearCheckInput();
  if(local===66)input.forward=true;
  if(local===80)this.placeLooseBall([.35,.12,-.15]);
  if(local===97)clearCheckInput();
  if(local===103)input.forward=true;
  if(local===115){clearCheckInput();startCharge(checkNow);}
  if(local===142)releaseJumpShot(checkNow);
  if(local===176){this.reset();input.forward=true;input.sprint=true;}
  if(local===206)this.placeLooseBall([-.35,.12,-.1]);
  if(local===230)clearCheckInput();
  if(local===250)clearCheckInput();
  if(local===275)startCharge(checkNow);
  if(local===332)releaseJumpShot(checkNow);
  if(local===366)this.startFinishCase('layup');
  if(local===460)this.startFinishCase('dunk');
  if(local===550)this.reset();
  if(local===564){input.forward=true;this.placeLooseBall([.2,.12,-.35]);}
  if(local===583)this.reset();
  checkStep(1,1/60);this.evidenceView();return checkSnapshot();
 },
 compareGather(frames=42){this.prepareWalk(frames);const before=checkSnapshot();const after=this.gatherFrame(1);return {before,after};},
 replayPart1Frame(frame){
  const local=frame%240;
  if(local===0){this.reset();input.forward=true;}
  if(local===60){game.ball.mode='loose';game.ball.velocity.set(0,0,0);setBallPosition(game.player.position.clone().add(new THREE.Vector3(.3,.12,0)));}
  if(local===90){clearCheckInput();startCharge(checkNow);}
  if(local===135)releaseJumpShot(checkNow);
  checkStep(1,1/60);this.evidenceView();return checkSnapshot();
 },
 async runChecks(touch=false){
  const savedEventTime=eventTime;eventTime=()=>checkNow;
  try {
  const landmarkWarnings=[];
  const geometryContact=animation=>Object.entries(animation?.contact||{}).filter(([side,c])=>c.required).every(([side])=>{const h=animation.absoluteHandClearance?.displayed?.[side];return h&&h.penetration<=1e-6&&Math.max(0,h.distance-BALL_RADIUS)<=.005;});
  const checks=[],check=(name,pass,details)=>checks.push({name,pass:!!pass,details});
  this.reset();
  const key=(type,code)=>document.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));
  const pointer=(element,type,x=0,y=0)=>{
    // Synthetic handler checks have no browser pointer to capture. The CDP
    // runner separately checks real touch events, hit testing and capture.
    const capture=element.setPointerCapture;element.setPointerCapture=()=>{};
    try{return element.dispatchEvent(new PointerEvent(type,{pointerId:71,pointerType:'touch',clientX:x,clientY:y,bubbles:true,cancelable:true}));}
    finally{element.setPointerCapture=capture;}
  };
  check('Luke ready',player.group.userData.assetStatus==='ready',player.group.userData.playerAsset);
  check('stable interface',stableRefs.every((r,i)=>r===[player.group,player.rightHand,player.leftHand,player.chest,player.head][i]));
  const z=game.player.position.z;
  if(touch){const b=touchStick.getBoundingClientRect();pointer(touchStick,'pointerdown',b.x+b.width/2,b.y+3);}else key('keydown','KeyW');
  checkStep(60);const walkSpeed=game.player.currentSpeed;check('movement',game.player.position.z<z-.3&&walkSpeed>2.5,walkSpeed);
  if(touch)pointer(touchSprint,'pointerdown');else key('keydown','ShiftLeft');checkStep(60);check('sprint',game.player.currentSpeed>walkSpeed+1);
  if(touch){pointer(touchStick,'pointerup');pointer(touchSprint,'pointerup');}else{key('keyup','KeyW');key('keyup','ShiftLeft');}
  this.reset();checkNow=performance.now();
  if(touch)pointer(touchShoot,'pointerdown');else key('keydown','Space');checkStep(60);
  const contact=player.getAnimationDiagnostics().contact;
  const gatherContact=contact?(!contact.right.required||contact.right.error<.025)&&(!contact.left.required||contact.left.error<.025):player.getRightHandWorldPosition().distanceTo(game.ball.position)<.006;
  landmarkWarnings.push({name:'gather flat-palm landmark (legacy)',pass:gatherContact,thresholdMetres:.025,details:contact});
  check('gather displayed triangle contact',game.ball.mode==='gather'&&geometryContact(player.getAnimationDiagnostics()),player.getAnimationDiagnostics().absoluteHandClearance?.displayed);
  if(touch)pointer(touchShoot,'pointerup');else key('keyup','Space');
  checkStep(1,1/120);
  check('shot commits to attached rise before apex',game.ball.mode==='gather'&&game.player.action==='shoot'&&!game.charge.active&&!game.player.shotPending?.released,{actionTime:game.player.actionTime,mode:game.ball.mode});
  let observedRelease=null;for(let i=0;i<60;i++){checkStep(1,1/120);if(!observedRelease&&game.player.shotPending?.released)observedRelease={actionTime:game.player.actionTime,detachedAt:game.player.shotPending.detachedAt,rootY:game.player.jumpY,mode:game.ball.mode,count:game.player.shotReleaseCount,origin:game.player.shotPending.detachWorld};}
  check('shot detaches once at observed apex',!!observedRelease&&observedRelease.mode==='flight'&&Math.abs(observedRelease.detachedAt-.2)<=1/120+1e-9&&Math.abs(observedRelease.rootY-.3048)<.004&&game.player.shotReleaseCount===1,observedRelease);
  for(const holdSteps of [1,36,96,180]){
   this.reset();if(touch)pointer(touchShoot,'pointerdown');else key('keydown','Space');
   checkStep(holdSteps,1/120);if(touch)pointer(touchShoot,'pointerup');else key('keyup','Space');
   let countAtFirstRelease=game.player.shotReleaseCount;
   for(let i=0;i<120;i++){checkStep(1,1/120);if(!countAtFirstRelease&&game.player.shotPending?.released)countAtFirstRelease=game.player.shotReleaseCount;}
   const shot=game.player.shotPending;
   check('apex timing and exactly-once after '+holdSteps+' held steps',!!shot?.released&&Math.abs(shot.detachedAt-.2)<=1/120+1e-9&&game.player.shotReleaseCount===1&&countAtFirstRelease===1,{holdSteps,stepSeconds:1/120,detachedAt:shot?.detachedAt,releaseCount:game.player.shotReleaseCount});
  }
  for(const[kind,z,speed]of[['layup',-2.5,0],['dunk',-4.1,2.2]]){
   this.reset();game.player.position.set(0,0,z);game.player.currentSpeed=speed;player.group.position.copy(game.player.position);checkStep(1,0);
   if(touch)pointer(touchFinish,'pointerdown');else key('keydown','KeyF');check('select '+kind,game.player.action===kind);
   checkStep(35);const heldCenter=player.getHeldBallWorldPosition?.()||player.getRightHandWorldPosition();const finishAnimation=player.getAnimationDiagnostics(),finishContact=finishAnimation.contact;
   landmarkWarnings.push({name:kind+' flat-palm landmark (legacy)',pass:!finishContact||Object.values(finishContact).every(c=>!c.required||(c.error<.025&&(c.ballSurfaceError==null||c.ballSurfaceError<.025))),thresholdMetres:.025,details:finishContact});
   check('attach '+kind+' with displayed triangle contact',game.ball.mode==='finish'&&heldCenter.distanceTo(game.ball.position)<1e-6&&geometryContact(finishAnimation),{centerError:heldCenter.distanceTo(game.ball.position),contact:finishContact,geometry:finishAnimation.absoluteHandClearance?.displayed,scope:'Retained legacy body motion with shared geometry clearance'});
   for(let i=0;i<500&&game.score===0;i++)checkStep();check('score '+kind,game.score===2&&game.ball.finishKind.toLowerCase()===kind,{score:game.score});
   if(touch)pointer(touchFinish,'pointerup');else key('keyup','KeyF');
  }
  if(touch){const yaw=game.cameraYaw;pointer(canvas,'pointerdown',220,260);pointer(canvas,'pointermove',260,275);pointer(canvas,'pointerup');check('touch look',yaw!==game.cameraYaw);}
  else{const yaw=game.cameraYaw;game.pointerLocked=true;document.dispatchEvent(new MouseEvent('mousemove',{movementX:30,movementY:10}));game.pointerLocked=false;check('mouse look',yaw!==game.cameraYaw);const distance=game.cameraDistance;window.dispatchEvent(new WheelEvent('wheel',{deltaY:-200}));check('mouse zoom',game.cameraDistance<distance);}
  if(touch)pointer(touchReset,'pointerdown');else key('keydown','KeyR');check('reset',game.score===0&&game.remaining===120&&game.player.position.z===3.9);
  for(const[name,url]of[['missing','/assets/models/player/intentional-missing.glb'],['invalid','/assets/models/ball/basketball-v1.glb']]){
   const candidate=createPlayer(THREE,{modelUrl:url});await candidate.group.userData.assetReady;candidate.update(1/60,{action:'shoot'});
   let visiblePlayerMeshes=0;candidate.group.traverse(n=>{if(n.isMesh&&n.name!=='player-contact-shadow'&&n.visible)visiblePlayerMeshes++;});
   check(name+' clear error without substitute',candidate.group.userData.assetStatus==='error'&&visiblePlayerMeshes===0&&!!candidate.group.userData.assetError);
  }
  const pickups=[];for(let i=0;i<4;i++){const p=this.pickupFrame();pickups.push(p.ballMode==='dribble');this.gatherFrame(22);this.release();}
  check('repeated pickup/gather',pickups.every(Boolean));
  this.reset();return{pass:checks.every(c=>c.pass),layout:touch?'touch':'desktop',checks,legacyPalmLandmarkPass:landmarkWarnings.every(c=>c.pass),landmarkWarnings,geometryThresholds:{maxIntrusion:1e-6,maxRequiredGap:.005},timingScope:'Fixed120Hz game steps through original input handlers; not realtime recording speed or browser FPS'};
  } finally {eventTime=savedEventTime;}
 }
};

// Dev evidence clock: real keyboard/pointer handlers, deterministic game time.
const ordinaryEventTime=eventTime;
window.arenaPolishReview={
  fixedInputClock(enabled=true){eventTime=enabled?()=>checkNow:ordinaryEventTime;},
  ...window.arenaPlayerCheck,
};
