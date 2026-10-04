/** Assemble selected recovered basketball geometry without changing source files.
 * Usage: node scripts/build-nba2k9-assets.mjs <nba2k9-study-dir> [--analyze]
 * Source game assets remain proprietary; this script makes no rights assertion.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUDY = path.resolve(process.argv[2] || '');
if (!fs.existsSync(path.join(STUDY, 'catalog/models.json'))) throw new Error('Supply the recovered nba2k9-study directory.');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const models = JSON.parse(fs.readFileSync(path.join(STUDY, 'catalog/models.json'))).models;
const textures = JSON.parse(fs.readFileSync(path.join(STUDY, 'catalog/textures.json'))).textures;
const motions = JSON.parse(fs.readFileSync(path.join(STUDY, 'catalog/animations.json'))).animations;
const canonical = ['root','lfemur','ltibia','lfoot','ltoes','rfemur','rtibia','rfoot','rtoes','waist','lowback','thorax','neck','head','lcollar','lhumerus','ltwist','lelbow','lwrist','lhand','rcollar','rhumerus','rtwist','relbow','rwrist','rhand'];

function load(file) {
  const bytes = fs.readFileSync(path.join(STUDY, file));
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid GLB ${file}`);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binStart = 20 + length;
  return { json, bin: bytes.subarray(binStart + 8, binStart + 8 + bytes.readUInt32LE(binStart)), file, sha256: hash(bytes) };
}
function array(source, index) {
  const a = source.json.accessors[index], v = source.json.bufferViews[a.bufferView];
  const size = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT4:16 }[a.type];
  const bytes = {5121:1,5123:2,5125:4,5126:4}[a.componentType];
  const values=[];
  for(let i=0;i<a.count;i++) for(let k=0;k<size;k++) {
    const off=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*bytes)+k*bytes;
    values.push(a.componentType===5126?source.bin.readFloatLE(off):a.componentType===5123?source.bin.readUInt16LE(off):a.componentType===5125?source.bin.readUInt32LE(off):source.bin.readUInt8(off));
  }
  return values;
}
function poseFrames(source) {
  const j=source.json, anim=j.animations[0], count=j.accessors[anim.samplers[0].input].count;
  const times=array(source,anim.samplers[0].input);
  const rotations=new Map(anim.channels.filter(c=>c.target.path==='rotation').map(c=>[c.target.node,array(source,anim.samplers[c.sampler].output)]));
  const parents=new Map();j.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
  const frames=[];
  for(let frame=0;frame<count;frame++) {
    const matrices=[];
    for(let i=0;i<j.nodes.length;i++) {
      const node=j.nodes[i],q=new THREE.Quaternion();const keys=rotations.get(i);
      if(keys)q.fromArray(keys,frame*4);else if(node.rotation)q.fromArray(node.rotation);
      const m=new THREE.Matrix4().compose(new THREE.Vector3(...(node.translation||[0,0,0])),q,new THREE.Vector3(1,1,1));
      if(parents.has(i))m.premultiply(matrices[parents.get(i)]);
      matrices.push(m);
    }
    const result={time:times[frame]};
    canonical.forEach(name=>{const i=j.nodes.findIndex(n=>n.name===name);result[name]=new THREE.Vector3().setFromMatrixPosition(matrices[i]).toArray();});
    frames.push(result);
  }
  return frames;
}
if(process.argv.includes('--frames')) {
  const ids=process.argv.slice(process.argv.indexOf('--frames')+1);
  for(const id of ids){const row=motions.find(r=>r.id===id);const frames=poseFrames(load(row.file));console.log(id,row.name,JSON.stringify(frames.filter((_,i)=>i%5===0).map(f=>({t:+f.time.toFixed(2),lh:f.lhand.map(v=>+v.toFixed(1)),rh:f.rhand.map(v=>+v.toFixed(1)),lf:f.lfoot.map(v=>+v.toFixed(1)),rf:f.rfoot.map(v=>+v.toFixed(1)),head:f.head.map(v=>+v.toFixed(1))})),null,2));}
  process.exit(0);
}
if(process.argv.includes('--analyze')) {
  const results=[];
  for(const motion of motions.filter(r=>r.joints===26)) {
    const frames=poseFrames(load(motion.file));
    const foot=frames.map(f=>f.lfoot[2]-f.rfoot[2]);
    const crossings=foot.reduce((n,v,i)=>n+(i>0&&Math.sign(v)!==Math.sign(foot[i-1])&&Math.abs(v)>5?1:0),0);
    const stride=Math.max(...foot)-Math.min(...foot);
    const right=frames.map(f=>f.rhand[1]-f.head[1]);
    const raised=Math.max(...right);
    const handLow=frames.filter(f=>f.rhand[1]<f.thorax[1]+10).length/frames.length;
    results.push({id:motion.id,name:motion.name,duration:motion.duration_seconds,stride:+stride.toFixed(1),crossings,raised:+raised.toFixed(1),handLow:+handLow.toFixed(2)});
  }
  console.log(JSON.stringify({move:results.filter(r=>r.crossings>=4&&r.handLow>.7).sort((a,b)=>b.stride-a.stride).slice(0,12),finish:results.filter(r=>r.stride<45&&r.raised>0).sort((a,b)=>b.raised-a.raised).slice(0,20),shoot:results.filter(r=>/shooter/.test(r.name)),},null,2));
  process.exit(0);
}

function packer() {
  const json={asset:{version:'2.0',generator:'TheArena NBA2K9 source assembly'},scene:0,scenes:[{nodes:[0]}],nodes:[],meshes:[],materials:[],skins:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}]};
  const chunks=[];let bytes=0;
  const accessors=new Map(),images=new Map();
  function append(data,target) {
    const pad=(4-bytes%4)%4;if(pad){chunks.push(Buffer.alloc(pad));bytes+=pad;}
    const i=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:bytes,byteLength:data.length,...(target?{target}:{})});chunks.push(data);bytes+=data.length;return i;
  }
  function accessor(source,index) {
    const key=source.file+':'+index;if(accessors.has(key))return accessors.get(key);
    const a=copy(source.json.accessors[index]);const values=array(source,index);const byteSize={5121:1,5123:2,5125:4,5126:4}[a.componentType];
    const data=Buffer.alloc(values.length*byteSize);values.forEach((v,i)=>a.componentType===5126?data.writeFloatLE(v,i*byteSize):a.componentType===5123?data.writeUInt16LE(v,i*byteSize):a.componentType===5125?data.writeUInt32LE(v,i*byteSize):data.writeUInt8(v,i*byteSize));
    a.bufferView=append(data,source.json.bufferViews[source.json.accessors[index].bufferView].target);a.byteOffset=0;delete a.sparse;
    const result=json.accessors.length;json.accessors.push(a);accessors.set(key,result);return result;
  }
  function texture(id) {
    if(images.has(id))return images.get(id);
    const source=textures.find(r=>r.id===id);if(!source)throw new Error(`Missing texture ${id}`);
    const png=fs.readFileSync(path.join(STUDY,source.file));const view=append(png);
    json.images ||= [];json.textures ||= [];json.samplers ||= [{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];
    const image=json.images.length;json.images.push({name:id,mimeType:'image/png',bufferView:view,extras:{sourceFile:source.file,sourceSha256:source.source_sha256,pngSha256:hash(png)}});
    const result=json.textures.length;json.textures.push({source:image,sampler:0});images.set(id,result);return result;
  }
  function finish(file) {
    json.buffers[0].byteLength=bytes;const jb=Buffer.from(JSON.stringify(json));const jp=Buffer.alloc((4-jb.length%4)%4,0x20);const bin=Buffer.concat(chunks);const bp=Buffer.alloc((4-bin.length%4)%4);const out=Buffer.alloc(12+8+jb.length+jp.length+8+bin.length+bp.length);
    out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(jb.length+jp.length,12);out.writeUInt32LE(0x4e4f534a,16);jb.copy(out,20);jp.copy(out,20+jb.length);const offset=20+jb.length+jp.length;out.writeUInt32LE(bin.length+bp.length,offset);out.writeUInt32LE(0x004e4942,offset+4);bin.copy(out,offset+8);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,out);return {bytes:out.length,sha256:hash(out)};
  }
  return {json,accessor,texture,finish};
}

const players=[
  {id:'classic-one',label:'Classic 01',head:'0381_8eeb2674_001',face:'0381_8eeb2674_000',neck:'0381_8eeb2674_003',arm:'0381_8eeb2674_002',uniform:'2701_2fb6b1d2_007',shorts:'2701_2fb6b1d2_008',shoe:'3231_a3c75601_000',file:'player-one.glb'},
  {id:'classic-two',label:'Classic 02',head:'0385_c323877f_002',face:'0385_c323877f_000',neck:'0385_c323877f_004',arm:'0385_c323877f_003',uniform:'2702_12d69862_007',shorts:'2702_12d69862_008',shoe:'3231_a3c75601_001',file:'player-two.glb'},
];
const provenance={schema:1,source:'User-supplied NBA 2K9 PS2 recovery package',rights:'Recovered proprietary assets. Publication requested by project owner; no license clearance is established.',assembly:'Original source geometry, UVs, skin influences, rest translations and inverse binds retained. Optional outfit/accessory alternatives excluded. Recovered textures assigned by source material role; original actor/uniform pairing unverified.',players:[],motions:[]};
const roster={schema:1,defaultPlayerId:players[0].id,players:[],animations:{url:'assets/animations/nba2k9/motions.glb',mapping:{}}};

for(const player of players) {
  const bodyRow=models.find(r=>r.id==='3165_8d61b035_068'),headRow=models.find(r=>r.id===player.head);
  const body=load(bodyRow.file),head=load(headRow.file),pack=packer(),j=pack.json;
  const nodes=new Map();j.nodes.push({name:'nba2k9_player',children:[]});
  const addBones=source=>{
    const parents=new Map();source.json.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
    for(const index of source.json.skins[0].joints) {
      const node=source.json.nodes[index];if(nodes.has(node.name)){const old=j.nodes[nodes.get(node.name)];if(node.translation.some((v,i)=>Math.abs(v-old.translation[i])>1e-4))throw new Error(`Incompatible bind ${node.name}`);continue;}
      const newIndex=j.nodes.length;nodes.set(node.name,newIndex);j.nodes.push({name:node.name,translation:copy(node.translation),children:[],extras:{sourceRestRetained:true}});
    }
    for(const index of source.json.skins[0].joints) {
      const node=source.json.nodes[index],parent=source.json.nodes[parents.get(index)];const childIndex=nodes.get(node.name),parentIndex=nodes.get(parent?.name)??0;
      if(!j.nodes[parentIndex].children.includes(childIndex))j.nodes[parentIndex].children.push(childIndex);
    }
  };
  addBones(head);addBones(body);
  function material(name,sourceMaterial) {
    const png=name==='face'?player.face:name==='neck_mat'?player.neck:name==='arm'||name==='hands'||name==='leg'?player.arm:name==='uniform'?player.uniform:name==='shorts'?player.shorts:player.shoe;
    const result=j.materials.length;const original=copy(sourceMaterial);
    original.name=name;original.pbrMetallicRoughness={baseColorFactor:[1,1,1,1],baseColorTexture:{index:pack.texture(png)},metallicFactor:0,roughnessFactor:.9};
    original.extras={sourceMaterial:name,sourceDescriptorHash:sourceMaterial.extras?.texture_hash,assignedTextureId:png,binding:'Material-role assignment; original dynamic descriptor binding unverified'};
    j.materials.push(original);return result;
  }
  const core=new Set(['arm','hands','leg','shorts','uniform','upper_mat','sole_mat','fastener_mat','midsole_mat','toe_mat','heel_mat','logo_mat','hitop_mat']);
  for(const [source,kind] of [[body,'body'],[head,'head']]) {
    const skin=source.json.skins[0];const skinIndex=j.skins.length;j.skins.push({name:`${kind}_source_skin`,joints:skin.joints.map(i=>nodes.get(source.json.nodes[i].name)),inverseBindMatrices:pack.accessor(source,skin.inverseBindMatrices),skeleton:nodes.get('root')});
    const primitives=[],materialMap=new Map();
    for(const primitive of source.json.meshes[0].primitives) {
      const sourceMaterial=source.json.materials[primitive.material],name=sourceMaterial.name;
      if(kind==='body'&&!core.has(name))continue;if(kind==='head'&&!['face','neck_mat'].includes(name))continue;
      if(!materialMap.has(name))materialMap.set(name,material(name,sourceMaterial));
      primitives.push({attributes:Object.fromEntries(Object.entries(primitive.attributes).map(([k,v])=>[k,pack.accessor(source,v)])),indices:pack.accessor(source,primitive.indices),material:materialMap.get(name),mode:4,extras:{sourceResourceId:source.json.extras.source_resource_id,sourceSubmesh:primitive.extras?.source_submesh?.index}});
    }
    const meshIndex=j.meshes.length;j.meshes.push({name:kind,primitives});const nodeIndex=j.nodes.length;j.nodes.push({name:`${kind}_mesh`,mesh:meshIndex,skin:skinIndex});j.nodes[0].children.push(nodeIndex);
  }
  let minimum=Infinity,maximum=-Infinity,triangles=0,vertices=0;
  for(const mesh of j.meshes)for(const p of mesh.primitives){const a=j.accessors[p.attributes.POSITION];minimum=Math.min(minimum,a.min[1]);maximum=Math.max(maximum,a.max[1]);vertices+=a.count;triangles+=j.accessors[p.indices].count/3;}
  const scale=2/(maximum-minimum),rootOffsetY=-minimum*scale;
  j.extras={assembly:'Complete recovered body and head; common joints share original bind frames',sourceFiles:[{file:body.file,sha256:body.sha256,decodedSha256:bodyRow.source_sha256||body.json.extras.source_sha256},{file:head.file,sha256:head.sha256,decodedSha256:head.json.extras.source_sha256}],rig:{canonicalBoneCount:26,totalBoneCount:nodes.size},nativeUnits:true,rights:provenance.rights};
  const url=`assets/models/player/nba2k9/${player.file}`,result=pack.finish(path.join(ROOT,'public',url));
  roster.players.push({id:player.id,label:player.label,url,height:2,scale,rotationY:Math.PI,rootOffsetY});
  provenance.players.push({id:player.id,url,...result,vertices,triangles,bones:[...nodes.keys()],nativeBoundsY:[minimum,maximum],sources:j.extras.sourceFiles,textures:[...new Set(j.materials.map(m=>m.extras.assignedTextureId))].map(id=>{const t=textures.find(r=>r.id===id);return {id,file:t.file,sourceSha256:t.source_sha256,pngSha256:t.png_sha256};})});
}

// Recovered source clips remain intact; runtime mapping selects adapted segments.
const selected=[
  {id:'4187_e76315f3_000n_002',name:'recovered-run'},
  {id:'4160_3fa0ba75_000n_003',name:'recovered-idle'},
  {id:'4119_1c9421c4_000n_002',name:'recovered-reach'},
  {id:'4190_2f839a83_000n_008',name:'recovered-overhead'},
];
const pack=packer();const witness=load(motions.find(r=>r.id===selected[0].id).file);pack.json.nodes=copy(witness.json.nodes);pack.json.animations=[];
for(const selectedMotion of selected) {
  const row=motions.find(r=>r.id===selectedMotion.id),source=load(row.file),animation=copy(source.json.animations[0]);
  if(source.json.nodes.map(n=>n.name).slice(1).join()!==witness.json.nodes.map(n=>n.name).slice(1).join())throw new Error('Motion bone ordering changed.');
  animation.name=selectedMotion.name;animation.samplers=animation.samplers.map(s=>({...s,input:pack.accessor(source,s.input),output:pack.accessor(source,s.output)}));animation.extras={sourceId:row.id,sourceName:row.name,sourceSha256:row.source_sha256,interpretation:'Adapted for TheArena; original action semantics unverified'};
  pack.json.animations.push(animation);provenance.motions.push({id:row.id,file:row.file,sourceName:row.name,runtimeName:selectedMotion.name,sourceSha256:row.source_sha256,glbSha256:source.sha256,duration:row.duration_seconds,frames:row.frame_count});
}
pack.json.extras={source:'NBA 2K9 recovered canonical26 motion family',nativeRootMotionApplied:false,rights:provenance.rights};
provenance.animationBundle={url:roster.animations.url,...pack.finish(path.join(ROOT,'public',roster.animations.url))};
roster.animations.mapping={idle:{clip:'recovered-idle',start:.667,end:2.667,loop:true},move:{clip:'recovered-run',start:0,end:1.667,loop:true},dribble:{clip:'recovered-run',start:0,end:1.667,loop:true},gather:{clip:'recovered-reach',start:.4,end:.667},shoot:{clip:'recovered-reach',start:.4,end:1.2,release:1},layup:{clip:'recovered-overhead',start:0,end:1.2,release:.7},dunk:{clip:'recovered-overhead',start:0,end:1.2,release:.7}};
fs.writeFileSync(path.join(ROOT,'src/nba2k9-roster.json'),JSON.stringify(roster,null,2)+'\n');
fs.writeFileSync(path.join(ROOT,'public/assets/models/player/nba2k9/provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({players:provenance.players.map(({id,bytes,triangles,vertices,bones})=>({id,bytes,triangles,vertices,bones:bones.length})),animations:provenance.animationBundle},null,2));
