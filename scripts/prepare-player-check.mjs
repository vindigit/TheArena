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
window.arenaPlayerCheck={
 snapshot:()=>({status:player.group.userData.assetStatus,asset:player.group.userData.playerAsset,action:game.player.action,position:game.player.position.toArray(),root:player.group.position.toArray(),speed:game.player.currentSpeed,ballMode:game.ball.mode,ball:game.ball.position.toArray(),hand:player.getRightHandWorldPosition().toArray(),score:game.score,yaw:game.cameraYaw,pitch:game.cameraPitch,coarsePointer}),
 reset:()=>resetPossession(false),
 nearHoop:(z=-4.1,speed=2.2)=>{resetPossession(false);game.player.position.set(0,0,z);game.player.currentSpeed=speed;player.group.position.copy(game.player.position);},
 pose:(action,progress=.5)=>{renderer.setAnimationLoop(null);game.started=true;startButton.hidden=true;player.group.position.set(0,0,3.9);player.update(1/60,{action,shotProgress:progress,speed:action==='move'?3.38:0,facing:0});setBallPosition(player.getRightHandWorldPosition());updateCamera(1/60);renderer.render(scene,camera);},
 resume:()=>renderer.setAnimationLoop(render),
 async runChecks(touch=false){
  renderer.setAnimationLoop(null);game.started=true;startButton.hidden=true;
  const checks=[];const check=(name,pass,details)=>checks.push({name,pass:!!pass,details});
  let now=performance.now();
  const step=(n=1)=>{for(let i=0;i<n;i++){now+=1000/120;updatePlayer(1/120,now);player.group.updateMatrixWorld(true);updateBall(1/120);}};
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
