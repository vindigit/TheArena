// Appended only by prepare-player-check.mjs to the ignored actual-game module.
await player.group.userData.assetReady;
const stableRefs=[player.group,player.rightHand,player.leftHand,player.chest,player.head];
let checkNow=performance.now();
function checkStep(frames=1,dt=1/120){for(let i=0;i<frames;i++){checkNow+=dt*1000;update(dt,checkNow);}renderer.render(scene,camera);}
function clearCheckInput(){Object.assign(input,{forward:false,backward:false,left:false,right:false,sprint:false,touchX:0,touchY:0});}
function checkSnapshot(){const rig=player.getRigInspection();player.group.updateMatrixWorld(true);return{
 status:player.group.userData.assetStatus,asset:player.group.userData.playerAsset,animation:player.getAnimationDiagnostics(),
 action:game.player.action,charge:game.charge.active,progress:game.player.actionProgress,position:game.player.position.toArray(),speed:game.player.currentSpeed,
 ballMode:game.ball.mode,ball:game.ball.position.toArray(),hand:player.getRightHandWorldPosition().toArray(),score:game.score,yaw:game.cameraYaw,pitch:game.cameraPitch,coarsePointer,
 bones:rig?Object.fromEntries([...rig.bones].map(([n,b])=>[n,{q:b.quaternion.toArray(),p:b.position.toArray(),world:b.getWorldPosition(new THREE.Vector3()).toArray()}])):null};}
window.arenaPlayerCheck={
 snapshot:checkSnapshot,step:checkStep,
 pause(){renderer.setAnimationLoop(null);},resume(){renderer.setAnimationLoop(render);},
 evidenceView(){camera.position.copy(player.group.position).add(new THREE.Vector3(1.6,1.9,3.2));camera.lookAt(player.group.position.clone().add(new THREE.Vector3(0,1,0)));camera.updateMatrixWorld(true);renderer.render(scene,camera);return checkSnapshot();},
 reset(){renderer.setAnimationLoop(null);clearCheckInput();resetPossession(false);checkNow=performance.now();game.started=true;startButton.hidden=true;checkStep();return checkSnapshot();},
 prepareWalk(frames=42){this.reset();input.forward=true;checkStep(frames);return checkSnapshot();},
 gatherFrame(frames=1){if(!game.charge.active){checkNow=performance.now();startCharge(checkNow);}clearCheckInput();checkStep(frames);return checkSnapshot();},
 release(){releaseJumpShot(checkNow);checkStep();return checkSnapshot();},
 pickupFrame(frames=1){this.prepareWalk();game.ball.mode='loose';game.ball.position.copy(game.player.position).add(new THREE.Vector3(.3,.12,0));setBallPosition(game.ball.position);checkStep(frames);return checkSnapshot();},
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
  check('gather anchor',game.ball.mode==='gather'&&player.getRightHandWorldPosition().distanceTo(game.ball.position)<.006,player.getRightHandWorldPosition().distanceTo(game.ball.position));
  if(touch)pointer(touchShoot,'pointerup');else key('keyup','Space');checkStep();check('shot release',game.ball.mode==='flight'&&game.player.action==='shoot');
  for(const[kind,z,speed]of[['layup',-2.5,0],['dunk',-4.1,2.2]]){
   this.reset();game.player.position.set(0,0,z);game.player.currentSpeed=speed;player.group.position.copy(game.player.position);
   if(touch)pointer(touchFinish,'pointerdown');else key('keydown','KeyF');check('select '+kind,game.player.action===kind);
   checkStep(35);check('attach '+kind,game.ball.mode==='finish'&&player.getRightHandWorldPosition().distanceTo(game.ball.position)<1e-6);
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
  this.reset();return{pass:checks.every(c=>c.pass),layout:touch?'touch':'desktop',checks};
 }
};
