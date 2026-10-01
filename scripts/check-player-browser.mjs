// Owned browser CDP runner. Start agent-browser, pass its get cdp-url result.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const reuseRig=process.argv.includes('--reuse-rig');
import sharp from 'sharp';
const endpoint=process.argv[2],base=process.argv[3]||'http://127.0.0.1:5177';
if(!endpoint?.startsWith('ws://127.0.0.1:'))throw new Error('Pass owned local CDP websocket URL');
await mkdir('.tmp/part1',{recursive:true});await mkdir('docs/evidence',{recursive:true});
const socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
let sequence=0;const pending=new Map(),requests=[];
socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);});
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const targets=await send('Target.getTargets');const target=targets.targetInfos.find(t=>t.type==='page'&&t.url.startsWith(base));assert.ok(target,'Open repository server in owned browser');
const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
const call=(method,params={})=>send(method,params,sessionId);
await call('Page.enable');await call('Network.enable');
await call('Network.setCacheDisabled',{cacheDisabled:true});
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function ready(expression){for(let i=0;i<120;i++){try{if(await evaluate(expression))return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Page readiness timeout '+expression);}
async function navigate(path,expression){await call('Page.navigate',{url:base+path});await ready('location.href==='+JSON.stringify(base+path)+'&&('+expression+')');}
async function emulation(width,height,touch=false){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch});await call('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:5});}
async function screenshot(path){await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const shot=await call('Page.captureScreenshot',{format:'png'});const data=Buffer.from(shot.data,'base64');await writeFile(path,data);return data;}
const report={checks:[],controls:[],rig:[],transitions:[]};
const check=(name,pass,details)=>{report.checks.push({name,pass:!!pass,details});console.log(JSON.stringify({name,pass:!!pass}));};
function labelSvg(text,width=420){return Buffer.from('<svg width="'+width+'" height="28"><rect width="100%" height="100%" fill="#132838"/><text x="10" y="19" font-family="sans-serif" font-size="14" fill="white">'+text.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</text></svg>');}
async function sheet(items,path,cols=3,w=420,h=390){const rows=Math.ceil(items.length/cols),parts=[];for(let i=0;i<items.length;i++){const col=i%cols,row=Math.floor(i/cols);const buffer=await sharp(items[i].image).resize(w,h,{fit:'cover'}).png().toBuffer();parts.push({input:buffer,left:col*w,top:row*(h+28)+28},{input:labelSvg(items[i].label,w),left:col*w,top:row*(h+28)});}await sharp({create:{width:cols*w,height:rows*(h+28),channels:3,background:'#e4e9ed'}}).composite(parts).jpeg({quality:85}).toFile(path);}
try{
 await emulation(1280,800);
 requests.length=0;await navigate('/','document.querySelector("#startButton")&&!document.querySelector("#startButton").disabled');
 const launchRequests=[...requests];check('ordinary URL requests only Luke',launchRequests.some(u=>u.endsWith('/luke-player-v1.glb'))&&!launchRequests.some(u=>/fictional-player|forward-dribble|preview-v1/.test(u)),launchRequests.filter(u=>u.includes('.glb')));
 await screenshot('docs/evidence/part1-ordinary-launch.png');
 await call('Page.reload',{ignoreCache:true});await ready('!document.querySelector("#startButton").disabled');check('ordinary reload succeeds',true);
 await navigate('/.tmp/player/game.html','window.arenaPlayerCheck');
 const desktop=await evaluate('arenaPlayerCheck.runChecks(false)');report.controls.push(desktop);check('desktop gameplay',desktop.pass,desktop.checks);
 for(let repeat=0;repeat<4;repeat++){const s=await evaluate('arenaPlayerCheck.compareGather('+[12,42,83,120][repeat]+')');report.transitions.push({type:'gather',...s});const delta=(name)=>Math.hypot(...s.before.bones[name].world.map((v,i)=>v-s.after.bones[name].world[i]));check('gather ankle continuity '+repeat,delta('left_foot')<.025&&delta('right_foot')<.025,{left:delta('left_foot'),right:delta('right_foot')});await evaluate('arenaPlayerCheck.gatherFrame(45);arenaPlayerCheck.release();arenaPlayerCheck.step(70)');}
 const actualPickup=await evaluate('arenaPlayerCheck.pickupFrame()');check('actual loose-ball possession path',actualPickup.ballMode==='dribble',actualPickup);
 // Comparable HEAD Luke versus revised Luke: same timestep, pose phase and camera.
 const comparison=[];
 const comparisonTargets=[['Luke after','/.tmp/player/game.html','arenaPlayerCheck']];
 if(process.argv.includes('--compare-before'))comparisonTargets.unshift(['Luke before','/.tmp/part1-before/index.html?player=luke','part1Before']);
 for(const[mode,path,api]of comparisonTargets){
  await navigate(path,'window.'+api);
  await evaluate(api+'.prepareWalk(42);'+api+'.evidenceView()');comparison.push({label:mode+' · moving',image:await screenshot('.tmp/part1/'+mode.replaceAll(' ','-')+'-moving.png')});
  const snap=await evaluate(api+'.gatherFrame(1);'+api+'.evidenceView()');report.transitions.push({type:mode+' first gather',snapshot:snap});comparison.push({label:mode+' · first gather frame',image:await screenshot('.tmp/part1/'+mode.replaceAll(' ','-')+'-gather.png')});
  await evaluate(api+'.gatherFrame(18);'+api+'.evidenceView()');comparison.push({label:mode+' · gather +150ms',image:await screenshot('.tmp/part1/'+mode.replaceAll(' ','-')+'-settled.png')});
 }
 await sheet(comparison,'docs/evidence/part1-gather-before-after.jpg',3,640,400);
 // Repeated actual gameplay path frame evidence.
 await navigate('/.tmp/player/game.html','window.arenaPlayerCheck');
 const sequence=[];
 for(let r=0;r<3;r++){await evaluate('arenaPlayerCheck.pickupFrame()');sequence.push({label:'Pickup '+(r+1)+' · dribble restored',image:await screenshot('.tmp/part1/pickup-'+r+'.png')});await evaluate('arenaPlayerCheck.gatherFrame(20)');sequence.push({label:'Gather '+(r+1),image:await screenshot('.tmp/part1/gather-'+r+'.png')});await evaluate('arenaPlayerCheck.release();arenaPlayerCheck.step(70)');sequence.push({label:'Release '+(r+1),image:await screenshot('.tmp/part1/release-'+r+'.png')});}
 await sheet(sequence,'docs/evidence/part1-gameplay-transitions.jpg',3,480,300);
 // Fixed stress poses with rest writer alone, then procedural base separately.
 await navigate('/dev/rig.html','window.lukeRigInspection');await evaluate('lukeRigInspection.stop()');
 const poses=['neutral','right knee','left knee','shallow squat','athletic crouch','forward step','wide stance','torso lean','arm raise','ball hold'];
 for(const writer of ['isolated','adapter']){
  const images=[];
  for(const pose of poses)for(const view of ['front','side','three-quarter']){
   if(reuseRig){const raw=await readFile('.tmp/part1/rig-'+writer+'-'+pose.replaceAll(' ','-')+'-'+view+'.png');const cropped=await sharp(raw).extract({left:330,top:90,width:630,height:620}).toBuffer();images.push({label:pose+' · '+view,image:cropped});report.rig.push({pose,writer,view,capture:'first pass; unchanged pose source'});continue;}
   const s=await evaluate('lukeRigInspection.drawPose('+JSON.stringify(pose)+','+JSON.stringify(writer)+');lukeRigInspection.setView('+JSON.stringify(view)+');lukeRigInspection.snapshot()');report.rig.push(s);
   const raw=await screenshot('.tmp/part1/rig-'+writer+'-'+pose.replaceAll(' ','-')+'-'+view+'.png');
   const cropped=await sharp(raw).extract({left:330,top:90,width:630,height:620}).toBuffer();images.push({label:pose+' · '+view,image:cropped});
  }
  await sheet(images.slice(0,15),'docs/evidence/part1-rig-'+writer+'-legs.jpg',3,340,335);
  await sheet(images.slice(15),'docs/evidence/part1-rig-'+writer+'-upper.jpg',3,340,335);
 }
 // Touch controls: narrow portrait and landscape, real CDP touch hit testing.
 for(const[width,height]of[[320,568],[390,844],[844,390]]){
  await emulation(width,height,true);await navigate('/.tmp/player/game.html','window.arenaPlayerCheck');
  const controls=await evaluate('arenaPlayerCheck.runChecks(true)');report.controls.push(controls);check('touch gameplay '+width+'x'+height,controls.pass,controls.checks);
  const layout=await evaluate('Array.from(document.querySelectorAll(".touch-stick,.touch-actions button")).map(e=>({id:e.id,rect:e.getBoundingClientRect().toJSON()}))');
  check('touch layout '+width+'x'+height,layout.every(x=>x.rect.width>0&&x.rect.left>=0&&x.rect.right<=width),layout);
  await evaluate('arenaPlayerCheck.reset();arenaPlayerCheck.resume()');
  const rect=await evaluate('document.querySelector("#touchStick").getBoundingClientRect().toJSON()');
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:rect.x+rect.width/2,y:rect.y+4}]});
  await evaluate('new Promise(r=>{let n=0;const tick=()=>++n>=20?r():requestAnimationFrame(tick);requestAnimationFrame(tick)})');
  const movement=await evaluate('arenaPlayerCheck.snapshot()');check('real touch movement '+width+'x'+height,movement.position[2]<3.5&&movement.coarsePointer,movement.position);
  await call('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await screenshot('docs/evidence/part1-touch-'+width+'x'+height+'.png');
 }
 await emulation(1280,800,false);
 await navigate('/.tmp/player/game.html?animation=hybrid','window.arenaPlayerCheck');
 const superseded=await evaluate('arenaPlayerCheck.snapshot()');check('old hybrid request superseded',superseded.animation.status==='superseded'&&superseded.animation.weight===0,superseded.animation);
 // Intentional blocked Luke load at ordinary URL. No game can start.
 await call('Network.setBlockedURLs',{urls:['*luke-player-v1.glb*']});requests.length=0;
 await navigate('/','document.querySelector("#startButton")?.classList.contains("has-load-error")');
 const failure=await evaluate('({text:document.querySelector("#startButton").textContent,disabled:document.querySelector("#startButton").disabled})');
 check('ordinary URL Luke failure stays blocked',failure.disabled&&failure.text.includes('LUKE UNAVAILABLE'),failure);
 await screenshot('docs/evidence/part1-intentional-load-failure.png');
 check('failure requests no old fallback',!requests.some(u=>/fictional-player|forward-dribble/.test(u)),requests.filter(u=>u.includes('.glb')));
 await call('Network.setBlockedURLs',{urls:[]});await call('Page.reload',{ignoreCache:true});await ready('!document.querySelector("#startButton").disabled');
 check('recover by ordinary reload',true);
 report.pass=report.checks.every(c=>c.pass);await writeFile('docs/evidence/part1-browser-validation.json',JSON.stringify(report,null,2));
 assert.ok(report.pass,'browser checks failed');console.log('Part 1 rendered/browser checks PASS');
}finally{await call('Network.setBlockedURLs',{urls:[]}).catch(()=>{});socket.close();}
