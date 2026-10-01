// Capture repeated real-game transitions in the dev harness; no production hooks.
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import sharp from 'sharp';
const endpoint=process.argv[2],base=process.argv[3]||'http://127.0.0.1:5177';
if(!endpoint?.startsWith('ws://127.0.0.1:'))throw new Error('Pass owned browser CDP URL');
await mkdir('docs/evidence',{recursive:true});
const socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
let seq=0;const pending=new Map();
socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const targets=await send('Target.getTargets');const t=targets.targetInfos.find(x=>x.type==='page'&&x.url.startsWith(base));if(!t)throw new Error('Open dev server in owned browser');
const{sessionId}=await send('Target.attachToTarget',{targetId:t.targetId,flatten:true});const call=(m,p={})=>send(m,p,sessionId);
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
async function navigate(path,api){await call('Page.navigate',{url:base+path});for(let i=0;i<100;i++){try{if(await evaluate('location.href==='+JSON.stringify(base+path)+'&&!!window.'+api))return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Harness unavailable');}
async function shot(){await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');return Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64');}
try{
 await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await call('Emulation.setTouchEmulationEnabled',{enabled:false,maxTouchPoints:5});
 const images=[];
 const targets=[['Luke after','/.tmp/player/game.html','arenaPlayerCheck']];
 if(process.argv.includes('--compare-before'))targets.unshift(['Luke before','/.tmp/part1-before/index.html?player=luke','part1Before']);
 for(const[label,path,api]of targets){await navigate(path,api);
  for(const[stage,command]of[['moving','prepareWalk(42)'],['first gather','gatherFrame(1)'],['gather +150ms','gatherFrame(18)']]){
   await evaluate(api+'.'+command+';'+api+'.evidenceView()');images.push({label:label+' · '+stage,image:await shot()});
  }
 }
 const parts=[],w=640,h=400;
 for(let i=0;i<images.length;i++){const left=i%3*w,top=Math.floor(i/3)*(h+28);parts.push({input:await sharp(images[i].image).resize(w,h).png().toBuffer(),left,top:top+28},{input:Buffer.from('<svg width="640" height="28"><rect width="100%" height="100%" fill="#132838"/><text x="10" y="19" font-family="sans-serif" font-size="14" fill="white">'+images[i].label+'</text></svg>'),left,top});}
 await sharp({create:{width:w*3,height:Math.ceil(images.length/3)*(h+28),channels:3,background:'#fff'}}).composite(parts).jpeg({quality:90}).toFile('docs/evidence/part1-gather-before-after.jpg');
 await navigate('/.tmp/player/game.html','arenaPlayerCheck');await evaluate('arenaPlayerCheck.pause()');
 const result=await evaluate(`(async()=>{const canvas=document.querySelector('#game'),stream=canvas.captureStream(30),chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:1400000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};const done=new Promise(r=>recorder.onstop=r);const samples=[];recorder.start();for(let frame=0;frame<720;frame++){const s=arenaPlayerCheck.replayPart1Frame(frame);if([0,60,61,90,91,120,135,136,220].includes(frame%240))samples.push({frame,snapshot:s});await new Promise(r=>setTimeout(r,1000/60));}recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:'video/webm'});const encoded=await new Promise(r=>{const reader=new FileReader();reader.onload=()=>r(reader.result.split(',')[1]);reader.readAsDataURL(blob)});return{encoded,samples,mimeType:blob.type,bytes:blob.size}})()`);
 await writeFile('docs/evidence/part1-repeated-transitions.webm',Buffer.from(result.encoded,'base64'));
 await writeFile('docs/evidence/part1-repeated-transitions.json',JSON.stringify({mimeType:result.mimeType,bytes:result.bytes,scenario:'3 repeats: walk, loose ball placed in pickup radius, actual possession update, moving gather, release, idle/stop; fixed root-relative camera, 60Hz game timestep',samples:result.samples},null,2));
 console.log(JSON.stringify({pass:true,recording:'docs/evidence/part1-repeated-transitions.webm',bytes:result.bytes,samples:result.samples.length}));
}finally{socket.close();}
