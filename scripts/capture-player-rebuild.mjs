import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const [mode='stills',out='.tmp/player-rebuild-review']=process.argv.slice(2);await mkdir(out,{recursive:true});
const video=mode==='video'||mode==='selected-video',selected=['selected','selected-video','selected-stress'].includes(mode);
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1000,height:1100}}),errors=[],results=[];let encoder;
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto('http://127.0.0.1:5173/dev/player-rebuild.html?manual=1'+(selected?'&model=selected':mode==='blockout'?'&model=blockout':''));await page.waitForFunction(()=>window.playerRebuild,null,{timeout:120000});
 const ids=await page.evaluate(()=>window.playerRebuild.shortlist);
 if(mode==='blockout')ids.splice(4);
 if(selected&&mode!=='selected-stress')ids.splice(0,ids.length,'4188_a0c36f23_000n_001','4205_6e5320a8_000n_002');
 if(video){
  encoder=spawn(process.env.FFMPEG_EXECUTABLE,['-y','-hide_banner','-loglevel','error','-f','image2pipe','-c:v','mjpeg','-r','30','-i','pipe:0','-an','-c:v','libvpx','-b:v','1800k','-deadline','realtime',path.join(out,'raw-motion.webm')],{windowsHide:true});
  encoder.stdin.on('error',()=>{});
 }
 for(const id of ids){for(const view of video||mode==='selected-stress'?['side','front']:['side']){
  await page.evaluate(({id,view})=>window.playerRebuild.configure(id,view),{id,view});const initial=await page.evaluate(()=>window.playerRebuild.snapshot());
  if(!video){
   for(let phase=0;phase<3;phase++){await page.evaluate(seconds=>window.playerRebuild.step(seconds),initial.duration/4);await page.screenshot({path:path.join(out,`${id}-${view}-${phase}.png`)});}
  }else{
   for(let frame=0;frame<Math.ceil(initial.duration*30);frame++){
    const data=await page.evaluate(()=>{window.playerRebuild.step(1/30);return window.playerRebuild.frame();});
    if(!encoder.stdin.write(Buffer.from(data,'base64')))await once(encoder.stdin,'drain');
   }
  }
  results.push({...initial,view});console.log(JSON.stringify({id,view,recorded:true}));
 }}
 if(encoder){const complete=once(encoder,'close');encoder.stdin.end();const [code]=await complete;if(code!==0)throw new Error('Video encoder failed');encoder=null;}
 if(errors.length)throw new Error(JSON.stringify(errors));await writeFile(path.join(out,'capture.json'),JSON.stringify({errors,results,normalSpeed:true,fps:video?30:null,model:selected?'selected-first-pass':mode==='blockout'?'blockout':'reference'},null,2));
}finally{encoder?.kill();await browser.close();}
