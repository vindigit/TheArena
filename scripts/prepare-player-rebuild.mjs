// Read-only recovery inputs; all review outputs remain inside TheArena.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { parseGlb } from './luke-rig-tools.mjs';
const study=path.resolve(process.argv[2]||'');
const catalog=JSON.parse(fs.readFileSync(path.join(study,'catalog/animations.json')));
const reference=parseGlb(fs.readFileSync('public/assets/models/player/nba2k9/player-one.glb')).doc;
const canonical=['root','lfemur','ltibia','lfoot','ltoes','rfemur','rtibia','rfoot','rtoes','waist','lowback','thorax','neck','head','lcollar','lhumerus','ltwist','lelbow','lwrist','lhand','rcollar','rhumerus','rtwist','relbow','rwrist','rhand'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const destination='art/player-rebuild/source-motion';fs.mkdirSync(destination,{recursive:true});
function values(doc,binary,index){
  const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],size={SCALAR:1,VEC3:3,VEC4:4}[a.type];
  if(a.componentType!==5126||!size)throw new Error('Unexpected animation accessor');
  return Array.from({length:a.count*size},(_,i)=>binary.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+Math.floor(i/size)*(v.byteStride||size*4)+(i%size)*4));
}
const rows=[],excluded=[];
for(const item of catalog.animations){
  if(item.binding?.kind!=='canonical_player_rig'){excluded.push({id:item.id,reason:'Original joint binding unresolved'});continue;}
  const bytes=fs.readFileSync(path.join(study,item.file)),{doc,binary}=parseGlb(bytes);
  for(const name of canonical){
    const source=doc.nodes.find(n=>n.name===name),target=reference.nodes.find(n=>n.name===name);
    if(!source||!target||new THREE.Vector3(...source.translation||[0,0,0]).distanceTo(new THREE.Vector3(...target.translation||[0,0,0]))>1e-3)
      throw new Error(`Reference rest translation mismatch ${item.id}: ${name}`);
    if(new THREE.Quaternion(...source.rotation||[0,0,0,1]).angleTo(new THREE.Quaternion(...target.rotation||[0,0,0,1]))>1e-5)
      throw new Error(`Reference rest rotation mismatch ${item.id}: ${name}`);
    const sourceParent=doc.nodes.find(n=>(n.children||[]).some(i=>doc.nodes[i]===source));
    const targetParent=reference.nodes.find(n=>(n.children||[]).some(i=>reference.nodes[i]===target));
    if(name!=='root'&&sourceParent?.name!==targetParent?.name)throw new Error(`Reference parent mismatch ${item.id}: ${name}`);
  }
  const animation=doc.animations[0],times=values(doc,binary,animation.samplers[0].input),parents=new Map();
  doc.nodes.forEach((n,i)=>(n.children||[]).forEach(child=>parents.set(child,i)));
  const rotations=new Map(animation.channels.filter(c=>c.target.path==='rotation').map(c=>[c.target.node,values(doc,binary,animation.samplers[c.sampler].output)]));
  let seam=0;for(const keys of rotations.values())seam=Math.max(seam,new THREE.Quaternion().fromArray(keys).angleTo(new THREE.Quaternion().fromArray(keys,keys.length-4)));
  const positions=[];
  for(let frame=0;frame<times.length;frame++){
    const matrices=[];function matrix(i){if(matrices[i])return matrices[i];const n=doc.nodes[i],q=new THREE.Quaternion().fromArray(rotations.get(i)||n.rotation||[0,0,0,1],rotations.has(i)?frame*4:0);
      const m=new THREE.Matrix4().compose(new THREE.Vector3(...n.translation||[0,0,0]),q,new THREE.Vector3(...n.scale||[1,1,1]));if(parents.has(i))m.premultiply(matrix(parents.get(i)));return matrices[i]=m;}
    const p=Object.fromEntries(['lfoot','rfoot','lhand','rhand','head','thorax'].map(name=>[name,new THREE.Vector3().setFromMatrixPosition(matrix(doc.nodes.findIndex(n=>n.name===name)))]));positions.push(p);
  }
  const stride=positions.map(p=>p.lfoot.z-p.rfoot.z),crossings=stride.reduce((n,v,i)=>n+(i&&Math.sign(v)!==Math.sign(stride[i-1])&&Math.abs(v)>5?1:0),0);
  const metadata=JSON.parse(fs.readFileSync(path.join(study,item.metadata_file)));
  const reviewFile=path.join(destination,path.basename(item.file));fs.writeFileSync(reviewFile,bytes);
  fs.copyFileSync(path.join(study,item.metadata_file),path.join(destination,path.basename(item.metadata_file)));
  rows.push({id:item.id,nativeName:item.name,url:'/'+reviewFile.replaceAll('\\','/'),duration:times.at(-1),frames:times.length,
    sourceFile:item.file,sourceHash:item.source_sha256,glbHash:hash(bytes),rig:item.binding.source_rig,
    seamRadians:seam,footCrossings:crossings,strideSourceUnits:Math.max(...stride)-Math.min(...stride),
    handAboveHeadSourceUnits:Math.max(...positions.map(p=>Math.max(p.lhand.y,p.rhand.y)-p.head.y)),
    eventWords:metadata.events,metadataFile:item.metadata_file,metadataHash:hash(fs.readFileSync(path.join(study,item.metadata_file))),rootTrajectoryPresent:!!metadata.root_motion,rootTrajectoryApplied:false,
    metadataUrl:'/'+path.join(destination,path.basename(item.metadata_file)).replaceAll('\\','/'),reviewStatus:'unreviewed',action:null,range:null,contacts:null});
}
const analysis=JSON.parse(fs.readFileSync('.tmp/player-rebuild-analysis.json'));
const shortlist=[...new Set([...analysis.move.slice(0,6),...analysis.shoot.slice(0,5),...analysis.finish.slice(0,3)].map(r=>r.id))];
const report={schema:1,stage:'source-motion-review',source:'NBA 2K9 PS2 supplied study',canonicalCount:rows.length,excludedCount:excluded.length,
  interpretation:'Metrics shortlist candidates; no action or event meaning is certified. Trajectory metadata is retained but not applied in raw pose playback.',shortlist,clips:rows,excluded};
fs.mkdirSync('art/player-rebuild',{recursive:true});fs.writeFileSync('art/player-rebuild/motion-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({canonical:rows.length,excluded:excluded.length,shortlist:shortlist.length,stage:report.stage}));
