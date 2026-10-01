// Creates an ignored harness around the actual game module, without exporting
// test hooks or altering the production gameplay orchestration.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('.tmp/player', {recursive:true});
const candidate = process.argv.includes('--candidate');
let source=(await readFile('src/main.js','utf8')).replace("import './styles.css';", "import '../../src/styles.css';").replaceAll("from './", "from '../../src/");
if(candidate)source=source.replace('createPlayer(THREE)', "createPlayer(THREE,{modelUrl:'/.tmp/player/fictional-player-v1.glb'})");
source+=`
const stableRefs=[player.group,player.rightHand,player.leftHand,player.chest,player.head];
await player.group.userData.assetReady;
await player.group.userData.animationReady;
window.arenaPlayerCheck={
 snapshot:()=>({status:player.group.userData.assetStatus,asset:player.group.userData.playerAsset,animationStatus:player.group.userData.animationStatus,animation:player.getAnimationDiagnostics?.(),action:game.player.action,position:game.player.position.toArray(),root:player.group.position.toArray(),speed:game.player.currentSpeed,ballMode:game.ball.mode,ball:game.ball.position.toArray(),hand:player.getRightHandWorldPosition().toArray(),score:game.score,yaw:game.cameraYaw,pitch:game.cameraPitch,coarsePointer}),
 reset:()=>resetPossession(false),
 nearHoop:(z=-4.1,speed=2.2)=>{resetPossession(false);game.player.position.set(0,0,z);game.player.currentSpeed=speed;player.group.position.copy(game.player.position);},
 pose:(action,progress=.5)=>{renderer.setAnimationLoop(null);game.started=true;startButton.hidden=true;player.group.position.set(0,0,3.9);player.update(1/60,{action,shotProgress:progress,speed:action==='move'?3.38:0,facing:0});setBallPosition(player.getRightHandWorldPosition());updateCamera(1/60);renderer.render(scene,camera);},
 resume:()=>renderer.setAnimationLoop(render),
 motionFrame(frames=83,sprint=false){
  renderer.setAnimationLoop(null);game.started=true;startButton.hidden=true;
  resetPossession(false);game.cameraYaw=0;player.group.rotation.y=0;
  Object.assign(input,{forward:true,backward:false,right:false,left:false,sprint,touchX:0,touchY:0});
  for(let i=0;i<frames;i++){
   updatePlayer(1/120,10000+i*1000/120);player.group.updateMatrixWorld(true);updateBall(1/120);
   player.updateDribbleContact?.({ballPosition:game.ball.position,ballRadius:BALL_RADIUS,dribblePhase:game.ball.dribblePhase,ballMode:game.ball.mode});
   updateCamera(1/120);
  }
  Object.assign(input,{forward:false,sprint:false});renderer.render(scene,camera);
  return this.snapshot();
 },
 async runAnimationFailures(){
  const checks=[];
  for(const [name,animationUrl] of [['missing','/.tmp/player/missing-animation.glb'],['invalid',import.meta.env.BASE_URL+'assets/models/ball/basketball-v1.glb']]){
   const candidate=createPlayer(THREE,{animationMode:'hybrid',animationUrl});
   const refs=[candidate.group,candidate.rightHand,candidate.leftHand];
   await candidate.group.userData.assetReady;await candidate.group.userData.animationReady;
   candidate.update(1/60,{action:'move',speed:3.38,ballMode:'dribble'});
   checks.push({name:name+' animation retains skeletal procedural player',pass:candidate.group.userData.assetStatus==='ready'&&candidate.group.userData.animationStatus==='fallback'&&refs.every((r,i)=>r===[candidate.group,candidate.rightHand,candidate.leftHand][i])&&candidate.getRightHandWorldPosition().toArray().every(Number.isFinite)});
  }
  return {pass:checks.every(c=>c.pass),checks};
 },
 motionTrace(){
  renderer.setAnimationLoop(null);game.started=true;startButton.hidden=true;
  resetPossession(false);game.cameraYaw=0;player.group.rotation.y=0;
  const trace=[],directionChecks=[],contactErrors={};let now=10000;
  const blocks=[['walk',{forward:true},60],['sprint',{forward:true,sprint:true},60],['right turn',{right:true},45],['reverse',{left:true},60],['stop',{},30],['boundary',{forward:true},600],['away from boundary',{backward:true},45],['diagonal',{backward:true,right:true},30],['stop',{},20]];
  for(const [label,controls,frames] of blocks){
   Object.assign(input,{forward:false,backward:false,right:false,left:false,sprint:false,touchX:0,touchY:0},controls);
   const before=game.player.position.clone();
   for(let i=0;i<frames;i++){
    now+=1000/120;updatePlayer(1/120,now);player.group.updateMatrixWorld(true);updateBall(1/120);
    player.updateDribbleContact?.({ballPosition:game.ball.position,ballRadius:BALL_RADIUS,dribblePhase:game.ball.dribblePhase,ballMode:game.ball.mode});
    if(i===0&&['right turn','reverse','away from boundary'].includes(label)){
     const delta=game.player.position.clone().sub(before);
     directionChecks.push({label,pass:label==='right turn'?delta.x>0:label==='reverse'?delta.x<0:delta.z>0,delta:delta.toArray()});
    }
    const p=game.player,b=game.ball;
    const diagnostics=player.getAnimationDiagnostics?.();
    const apex=Math.abs(Math.atan2(Math.sin(b.dribblePhase-Math.PI/2),Math.cos(b.dribblePhase-Math.PI/2)));
    if(diagnostics?.active&&apex<=.35){
     const target=b.position.clone();target.y+=BALL_RADIUS;
     const error=player.getRightHandWorldPosition().distanceTo(target);
     const record=contactErrors[label]||{samples:0,maxError:0};record.samples++;record.maxError=Math.max(record.maxError,error);contactErrors[label]=record;
    }
    trace.push([...p.position.toArray(),...player.group.position.toArray(),p.yaw,p.desiredYaw,p.currentSpeed,...b.position.toArray(),b.dribblePhase,b.mode,p.action,game.score]);
   }
  }
  Object.assign(input,{forward:false,backward:false,right:false,left:false,sprint:false,touchX:0,touchY:0});
  return {animationStatus:player.group.userData.animationStatus,directionChecks,contactErrors,trace};
 },
 async benchmark(frames=180){
  renderer.setAnimationLoop(null);game.started=true;startButton.hidden=true;
  resetPossession(false);game.cameraYaw=0;
  const poseTimes=[],frameTimes=[],intervals=[];let previous=0;
  for(let i=0;i<frames+30;i++){
   const timestamp=await new Promise(requestAnimationFrame);
   const start=performance.now(),dt=1/60;
   if(game.player.position.z<-4.5)resetPossession(false);
   Object.assign(input,{forward:true,backward:false,right:false,left:false,sprint:i%120>=60,touchX:0,touchY:0});
   const poseStart=performance.now();updatePlayer(dt,timestamp);player.group.updateMatrixWorld(true);
   const poseEnd=performance.now();updateBall(dt);
   const contactStart=performance.now();player.updateDribbleContact?.({ballPosition:game.ball.position,ballRadius:BALL_RADIUS,dribblePhase:game.ball.dribblePhase,ballMode:game.ball.mode});
   const contactEnd=performance.now();updateCamera(dt);renderer.render(scene,camera);
   if(i>=30){poseTimes.push(poseEnd-poseStart+contactEnd-contactStart);frameTimes.push(performance.now()-start);intervals.push(timestamp-previous);}
   previous=timestamp;
  }
  Object.assign(input,{forward:false,sprint:false});
  const summary=values=>{values.sort((a,b)=>a-b);return {median:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)]};};
  return {animationStatus:player.group.userData.animationStatus,frames,poseCpuMs:summary(poseTimes),frameCpuMs:summary(frameTimes),frameIntervalMs:summary(intervals),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,viewport:[innerWidth,innerHeight],coarsePointer};
 },
 async runChecks(touch=false){
  renderer.setAnimationLoop(null);game.started=true;startButton.hidden=true;
  const checks=[];const check=(name,pass,details)=>checks.push({name,pass:!!pass,details});
  let now=performance.now();
  const step=(n=1)=>{for(let i=0;i<n;i++){now+=1000/120;updatePlayer(1/120,now);player.group.updateMatrixWorld(true);updateBall(1/120);player.updateDribbleContact?.({ballPosition:game.ball.position,ballRadius:BALL_RADIUS,dribblePhase:game.ball.dribblePhase,ballMode:game.ball.mode});}};
  const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));
  // Synthetic pointer events exercise the real handlers. Real pointer capture
  // cannot be attached to a synthetic pointer, so stub only that browser API.
  const pointer=(element,type,x=0,y=0)=>{
   const capture=element.setPointerCapture;element.setPointerCapture=()=>{};
   element.dispatchEvent(new PointerEvent(type,{pointerId:71,pointerType:'touch',clientX:x,clientY:y,bubbles:true}));
   element.setPointerCapture=capture;
  };
  check('runtime GLB ready',player.group.userData.assetStatus==='ready',player.group.userData.playerAsset);
  check('stable interface',stableRefs.every((ref,i)=>ref===[player.group,player.rightHand,player.leftHand,player.chest,player.head][i]));
  resetPossession(false);const z=game.player.position.z;
  if(touch){const b=touchStick.getBoundingClientRect();pointer(touchStick,'pointerdown',b.x+b.width/2,b.y+3);}else key('keydown','KeyW');
  step(30);const walkSpeed=game.player.currentSpeed;
  check('movement',game.player.position.z<z-.3&&walkSpeed>2.5,{z:game.player.position.z,speed:walkSpeed});
  if(touch)pointer(touchSprint,'pointerdown');else key('keydown','ShiftLeft');step(30);
  check('sprint',game.player.currentSpeed>walkSpeed+1&&game.player.action==='move',game.player.currentSpeed);
  if(touch){pointer(touchStick,'pointerup');pointer(touchSprint,'pointerup');}else{key('keyup','KeyW');key('keyup','ShiftLeft');}
  resetPossession(false);now=performance.now();
  if(touch)pointer(touchShoot,'pointerdown');else key('keydown','Space');step(30);
  const gatherError=player.getRightHandWorldPosition().distanceTo(game.ball.position);
  check('gather ball contact',game.ball.mode==='gather'&&gatherError<.006,{mode:game.ball.mode,error:gatherError});
  if(touch)pointer(touchShoot,'pointerup');else key('keyup','Space');step(1);
  check('shoot release',game.ball.mode==='flight'&&game.player.action==='shoot',{ballMode:game.ball.mode,action:game.player.action});
  for(const [kind,z,speed] of [['layup',-2.5,0],['dunk',-4.1,2.2]]){
   resetPossession(false);game.player.position.set(0,0,z);game.player.currentSpeed=speed;player.group.position.copy(game.player.position);player.update(0,{action:'idle',facing:0});
   if(touch)pointer(touchFinish,'pointerdown');else key('keydown','KeyF');
   check(kind+' selected',game.player.action===kind,game.player.action);
   step(20);const attached=player.getRightHandWorldPosition().distanceTo(game.ball.position);
   check(kind+' ball contact',game.ball.mode==='finish'&&attached<.00001,{error:attached,mode:game.ball.mode});
   check(kind+' jump owned by game',Math.abs(player.group.position.y-game.player.jumpY)<1e-10&&player.group.position.y>.1);
   for(let i=0;i<300&&game.score===0;i++)step();
   check(kind+' release and score',game.score===2&&game.ball.finishKind.toLowerCase()===kind,{score:game.score,finish:game.ball.finishKind});
   if(touch)pointer(touchFinish,'pointerup');else key('keyup','KeyF');
  }
  if(touch){const yaw=game.cameraYaw;pointer(canvas,'pointerdown',220,260);pointer(canvas,'pointermove',260,275);pointer(canvas,'pointerup',260,275);check('touch camera drag',game.cameraYaw!==yaw);}
  else {const distance=game.cameraDistance;window.dispatchEvent(new WheelEvent('wheel',{deltaY:-200}));check('mouse zoom',game.cameraDistance<distance);const yaw=game.cameraYaw;game.pointerLocked=true;document.dispatchEvent(new MouseEvent('mousemove',{movementX:30,movementY:10}));game.pointerLocked=false;check('mouse look handler',game.cameraYaw!==yaw);}
  if(touch)pointer(touchReset,'pointerdown');else key('keydown','KeyR');
  check('reset',game.score===0&&game.remaining===120&&game.player.position.distanceTo(new THREE.Vector3(0,0,3.9))<1e-8);
  const failed=createPlayer(THREE,{modelUrl:'/.tmp/player/missing.glb'});const before=failed.rightHand;
  await failed.group.userData.assetReady;failed.update(1/60,{action:'shoot',shotProgress:.5});
  check('HTTP failure retains procedural player',failed.group.userData.assetStatus==='fallback'&&failed.rightHand===before&&failed.group.getObjectByName('jersey-body').visible&&failed.getRightHandWorldPosition().toArray().every(Number.isFinite));
  const wrong=createPlayer(THREE,{modelUrl:import.meta.env.BASE_URL+'assets/models/ball/basketball-v1.glb'});
  await wrong.group.userData.assetReady;
  check('invalid rig retains procedural player',wrong.group.userData.assetStatus==='fallback'&&wrong.group.getObjectByName('jersey-body').visible);
  window.playerCheckResults={pass:checks.every(c=>c.pass),layout:touch?'touch':'desktop',checks};
  resetPossession(false);step();updateCamera(1);renderer.render(scene,camera);
  return window.playerCheckResults;
 }
};
`;
await writeFile('.tmp/player/game.js',source);
const html=(await readFile('index.html','utf8')).replace('src="/src/main.js"','src="/.tmp/player/game.js"');
await writeFile('.tmp/player/game.html',html);
console.log('Open http://127.0.0.1:5174/.tmp/player/game.html and call arenaPlayerCheck.runChecks(touch).');
