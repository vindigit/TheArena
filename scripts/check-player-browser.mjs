// Browser regression runner for the ignored harness, using an owned browser's
// CDP URL (for example `agent-browser --session arena-hybrid get cdp-url`).
// Node 22+; no browser package or production test hooks required.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:5174';
if (!endpoint?.startsWith('ws://127.0.0.1:')) throw new Error('Pass an owned local browser CDP WebSocket URL.');
await mkdir('.tmp/hybrid', { recursive: true });
const socket = new WebSocket(endpoint);
await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true}); });
let sequence=0;const pending=new Map();
socket.addEventListener('message',event=>{
 const message=JSON.parse(event.data);
 if(message.id){const task=pending.get(message.id);pending.delete(message.id);message.error?task.reject(new Error(JSON.stringify(message.error))):task.resolve(message.result);}
});
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
const targets=await send('Target.getTargets');
const target=targets.targetInfos.find(t=>t.type==='page'&&t.url.startsWith(base));
if(!target)throw new Error('Open this repository dev server in the owned browser first.');
const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
const call=(method,params={})=>send(method,params,sessionId);
await call('Page.enable');
async function evaluate(expression){
 const response=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
 if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));
 return response.result.value;
}
async function navigate(query=''){
 const url=base+'/.tmp/player/game.html'+query;
 await call('Page.navigate',{url});
 await call('Page.bringToFront');
 for(let i=0;i<100;i++){
  try { if(await evaluate('location.href==='+JSON.stringify(url)+'&&Boolean(window.arenaPlayerCheck)'))return; } catch { /* Navigation replaced the evaluation context. */ }
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw new Error('Harness did not become ready.');
}
async function screenshot(name){const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('.tmp/hybrid/'+name+'.png',Buffer.from(shot.data,'base64'));}
async function emulation(width,height,touch){
 await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch});
 await call('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:5});
}
const report={checks:[],controls:[],benchmarks:[],screenshots:[]};
const check=(name,pass,details)=>{report.checks.push({name,pass:Boolean(pass),details});console.log(JSON.stringify({name,pass:Boolean(pass),details}));};
try{
 await emulation(1280,800,false);
 await navigate();
 const baseline=await evaluate('arenaPlayerCheck.motionTrace()');
 check('procedural default',baseline.animationStatus==='procedural',baseline.animationStatus);
 await navigate('?animation=hybrid');
 const hybrid=await evaluate('arenaPlayerCheck.motionTrace()');
 check('hybrid clip ready',hybrid.animationStatus==='ready',hybrid.animationStatus);
 let maxDelta=0,sameStates=baseline.trace.length===hybrid.trace.length;
 baseline.trace.forEach((row,i)=>row.forEach((value,j)=>{const other=hybrid.trace[i]?.[j];if(typeof value==='number')maxDelta=Math.max(maxDelta,Math.abs(value-other));else sameStates&&=value===other;}));
 check('identical simulation traces',sameStates&&maxDelta<=1e-8,{frames:hybrid.trace.length,maxDelta});
 check('immediate direction changes',hybrid.directionChecks.every(c=>c.pass),hybrid.directionChecks);
 check('contact during game turns and reversals',Object.values(hybrid.contactErrors).every(c=>c.maxError<=.02)&&hybrid.contactErrors.reverse?.samples>0&&hybrid.contactErrors['right turn']?.samples>0,hybrid.contactErrors);
 const terms=await evaluate('fetch(document.querySelector("#motionCredits").href).then(async r=>({status:r.status,valid:(await r.text()).includes("may not resell")}))');
 check('published motion terms accessible',terms.status===200&&terms.valid,terms);
 await writeFile('.tmp/hybrid/parity.json',JSON.stringify({baseline,hybrid,maxDelta},null,2));
 const desktop=await evaluate('arenaPlayerCheck.runChecks(false)');
 check('existing desktop player checks',desktop.pass,desktop.checks);
 report.controls.push(desktop);
 const failures=await evaluate('arenaPlayerCheck.runAnimationFailures()');
 check('animation failure isolation',failures.pass,failures.checks);
 await evaluate('arenaPlayerCheck.reset();arenaPlayerCheck.resume()');
 await call('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
 await evaluate('new Promise(resolve=>{let n=0;const tick=()=>++n>=20?resolve(true):requestAnimationFrame(tick);requestAnimationFrame(tick);})');
 await call('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
 const actualKey=await evaluate('arenaPlayerCheck.snapshot()');
 check('actual keyboard movement',actualKey.position[2]<3.5,actualKey.position);
 await evaluate('arenaPlayerCheck.motionFrame()');await screenshot('desktop-hybrid');report.screenshots.push('desktop-hybrid.png');
 for(const [query,mode] of [['','procedural'],['?animation=hybrid','hybrid']]){
  await navigate(query);
  const result=await evaluate('arenaPlayerCheck.benchmark(180)');
  report.benchmarks.push({mode,...result});
  console.log(JSON.stringify({benchmark:mode,...result}));
 }
 const rect=id=>evaluate('document.querySelector('+JSON.stringify('#'+id)+').getBoundingClientRect().toJSON()');
 const touch=(type,points)=>call('Input.dispatchTouchEvent',{type,touchPoints:points});
 for(const [width,height] of [[320,568],[390,844],[844,390]]){
  await emulation(width,height,true);await navigate('?animation=hybrid');
  const coarse=await evaluate('matchMedia("(any-pointer: coarse)").matches');
  check('coarse pointer '+width+'x'+height,coarse);
  const layout=await evaluate('Array.from(document.querySelectorAll(".touch-stick,.touch-actions button")).map(e=>({id:e.id,rect:e.getBoundingClientRect().toJSON()}))');
  const visible=layout.every(({rect:r})=>r.width>0&&r.left>=0&&r.right<=width);
  const overlap=layout.some((a,i)=>layout.some((b,j)=>j>i&&a.rect.left<b.rect.right&&a.rect.right>b.rect.left&&a.rect.top<b.rect.bottom&&a.rect.bottom>b.rect.top));
  check('touch hit targets fit '+width+'x'+height,visible&&!overlap,layout);
  const handlers=await evaluate('arenaPlayerCheck.runChecks(true)');
  check('touch player checks '+width+'x'+height,handlers.pass,handlers.checks);report.controls.push(handlers);
  await evaluate('arenaPlayerCheck.reset();arenaPlayerCheck.resume()');
  const stick=await rect('touchStick'),run=await rect('touchSprint');
  const points=[{id:1,x:stick.x+stick.width/2,y:stick.y+4},{id:2,x:run.x+run.width/2,y:run.y+run.height/2}];
  await touch('touchStart',points);
  await evaluate('new Promise(resolve=>{let n=0;const tick=()=>++n>=35?resolve(true):requestAnimationFrame(tick);requestAnimationFrame(tick);})');
  const moving=await evaluate('arenaPlayerCheck.snapshot()');
  check('actual joystick plus RUN '+width+'x'+height,moving.position[2]<3.5&&moving.speed>4.5,{position:moving.position,speed:moving.speed});
  await screenshot('touch-'+width+'x'+height);report.screenshots.push('touch-'+width+'x'+height+'.png');
  await touch('touchCancel',[]);
  const cancelPosition=(await evaluate('arenaPlayerCheck.snapshot()')).position;
  await evaluate('new Promise(resolve=>{let n=0;const tick=()=>++n>=10?resolve(true):requestAnimationFrame(tick);requestAnimationFrame(tick);})');
  const afterCancel=(await evaluate('arenaPlayerCheck.snapshot()')).position;
  check('touch cancellation stops displacement '+width+'x'+height,cancelPosition.every((v,i)=>Math.abs(v-afterCancel[i])<1e-8),{before:cancelPosition,after:afterCancel});
  await evaluate('arenaPlayerCheck.reset();arenaPlayerCheck.resume()');
  const yaw=await evaluate('arenaPlayerCheck.snapshot().yaw');
  await touch('touchStart',[{id:1,x:width*.55,y:height*.4}]);
  await touch('touchMove',[{id:1,x:width*.7,y:height*.42}]);
  await touch('touchEnd',[]);
  check('actual touch camera '+width+'x'+height,yaw!==await evaluate('arenaPlayerCheck.snapshot().yaw'));
  await evaluate('arenaPlayerCheck.motionFrame()');await screenshot('touch-'+width+'x'+height);
  if(width===390){const perf=await evaluate('arenaPlayerCheck.benchmark(180)');report.benchmarks.push({mode:'hybrid touch emulation',...perf});console.log(JSON.stringify({benchmark:'touch',...perf}));}
 }
 await emulation(1280,800,false);await navigate('?player=luke&animation=hybrid');
 check('Luke stays procedural',(await evaluate('arenaPlayerCheck.snapshot()')).animationStatus==='procedural');
 const baselinePerf=report.benchmarks.find(b=>b.mode==='procedural'),hybridPerf=report.benchmarks.find(b=>b.mode==='hybrid');
 check('no added draw calls',baselinePerf.drawCalls===hybridPerf.drawCalls,{baseline:baselinePerf.drawCalls,hybrid:hybridPerf.drawCalls});
 report.pass=report.checks.every(c=>c.pass);
 await writeFile('.tmp/hybrid/browser-report.json',JSON.stringify(report,null,2)+'\n');
 assert.ok(report.pass,'See .tmp/hybrid/browser-report.json for failures.');
}finally{socket.close();}
