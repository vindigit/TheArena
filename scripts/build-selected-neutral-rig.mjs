// Neutral authoring foundation. Recovered motion is deliberately disconnected.
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import {parseGlb,accessor} from './luke-rig-tools.mjs';
import {STYLE,widenShoulder,addBaggyShorts,PLAYER_HEIGHT_SCALE} from './selected-player-style.mjs';
const source=fs.readFileSync('art/player-rebuild/selected-player-source.glb');
const authoring=process.argv.includes('--authoring');
const {doc,binary}=parseGlb(source),canonical=parseGlb(fs.readFileSync('art/player-rebuild/athlete-blockout.glb')).doc;
const nodes=structuredClone(canonical.nodes.slice(0,26)),names=new Map(nodes.map((n,i)=>[n.name,i])),parents=new Map();
nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
const landmarks={root:[0,.525,-.014],waist:[0,.590,-.012],lowback:[0,.674,-.010],thorax:[0,.766,-.017],neck:[0,.847,-.017],head:[0,.892,-.014]};
for(const [side,sign]of [['l',1],['r',-1]]){
 const p=(x,y,z)=>[x*sign,y,z],knee=side==='l'?[.0892,.2574,-.0300]:[-.0931,.2575,-.0306],ankle=side==='l'?[.1138,.0957,-.0395]:[-.1170,.0946,-.0381];
 Object.assign(landmarks,{[side+'femur']:p(.068,.50,0),[side+'tibia']:knee,[side+'foot']:ankle,[side+'toes']:p(.123,.028,.055),[side+'collar']:p(.055,.805,-.020),[side+'humerus']:p(.140,.7933,-.0269),[side+'twist']:p(.215,.7866,-.0264),[side+'elbow']:p(.290,.7799,-.0259),[side+'wrist']:p(.3525,.773,-.0133),[side+'hand']:p(.415,.7660,-.0007)});
 for(const suffix of ['collar','humerus','twist','elbow','wrist','hand'])landmarks[side+suffix][0]=widenShoulder(landmarks[side+suffix][0]);
}
for(const [i,n]of nodes.entries()){
 const origin=parents.has(i)?landmarks[nodes[parents.get(i)].name]:[0,0,0];
 n.translation=landmarks[n.name].map((v,k)=>v-origin[k]);delete n.rotation;delete n.scale;
 n.extras={basis:'selected-athlete-neutral',role:/twist|wrist/.test(n.name)?'intermediate limb support':'anatomical joint'};
}
const primitive=doc.meshes[0].primitives[0],points=accessor(doc,binary,primitive.attributes.POSITION),sourceIndices=accessor(doc,binary,primitive.indices).flat();
const indices=[],retainedSourceFaces=[];
for(let i=0;i<sourceIndices.length;i+=3){
 const triangle=sourceIndices.slice(i,i+3),center=triangle.reduce((sum,id)=>sum.add(new T.Vector3(...points[id])),new T.Vector3()).multiplyScalar(1/3);
 // Replace the old shorts surface where the new cloth shell lives. Keep the
 // original waist yoke, central crotch bridge and all bare leg geometry.
 if(center.y>.325&&center.y<.520&&Math.abs(center.x)>.030)continue;
 indices.push(...triangle);retainedSourceFaces.push(i/3);
}
const sourceUvs=accessor(doc,binary,primitive.attributes.TEXCOORD_0).flat(),uvs=sourceUvs.map((value,i)=>i%2===0?value*STYLE.sourceUvWidth:value);
const smooth=(a,b,x)=>T.MathUtils.smoothstep(x,a,b),fitted=[],weights=[],joints=[];
function blend(a,b,t){return {[a]:1-t,[b]:t};}
for(const p of points){const [x,y,z]=p,side=x>=0?'l':'r',ax=Math.abs(x);let influences;
 if(y<.54){
  if(y>.43){const thigh=1-smooth(.46,.535,y),crotch=smooth(.018,.050,ax);influences=blend('root',side+'femur',thigh*crotch);}
  else if(y>.275)influences={[side+'femur']:1};
  else if(y>.235)influences=blend(side+'tibia',side+'femur',smooth(.235,.275,y));
  else if(y>.115)influences={[side+'tibia']:1};
  else if(y>.078)influences=blend(side+'foot',side+'tibia',smooth(.078,.115,y));
  else influences={[side+'foot']:1};
 }else if(y>.86&&ax<.09){influences=blend('neck','head',smooth(.860,.887,y));}
 else if(y>.72&&ax>.11){
  if(ax>.425)influences={[side+'hand']:1};
  else if(ax>.39)influences=blend(side+'wrist',side+'hand',smooth(.390,.425,ax));
  else if(ax>.325)influences=blend(side+'elbow',side+'wrist',smooth(.325,.378,ax));
  else if(ax>.272)influences=blend(side+'humerus',side+'elbow',smooth(.272,.309,ax));
  else if(ax>.16)influences={[side+'humerus']:1};
  else influences=blend('thorax',side+'humerus',smooth(.110,.160,ax));
 }else if(y>.805)influences=blend('thorax','neck',smooth(.805,.854,y));
 else if(y>.69)influences=blend('lowback','thorax',smooth(.69,.758,y));
 else if(y>.61)influences=blend('waist','lowback',smooth(.61,.684,y));
 else influences=blend('root','waist',smooth(.545,.603,y));
 const entries=Object.entries(influences).filter(([,w])=>w>1e-8);
 joints.push(...entries.map(([name])=>names.get(name)),...Array(4-entries.length).fill(0));weights.push(...entries.map(([,w])=>w),...Array(4-entries.length).fill(0));
 // Preserve limb lengths: widen clavicles and translate the outer arm chains.
 const cloth=smooth(.545,.585,y)*(1-smooth(.730,.795,y))*(1-smooth(.125,.165,ax));
 const drape=.0035*Math.sin((y-.55)*Math.PI/0.22)*cloth;
 const shoulder=y>.70&&y<.835?(ax>=.16?1:smooth(.70,.765,y)):0;
 fitted.push(x*(1+.16*cloth)+(widenShoulder(x)-x)*shoulder,y,z*(1+.10*cloth)+(z>=0?drape:-drape));
}
const style=addBaggyShorts({positions:fitted,uvs,sourceUvs,indices,joints,weights,landmarks,names});
style.retainedSourceFaces=retainedSourceFaces;
style.baseVertices=fitted.length/3;
style.authoringVertexOrigins=[...new Set(indices)].sort((a,b)=>a-b);
style.geometryHash=crypto.createHash('sha256').update(Buffer.from(new Float32Array(fitted).buffer)).update(Buffer.from(new Uint16Array(indices).buffer)).digest('hex');
const baseGeometry=new T.BufferGeometry();baseGeometry.setAttribute('position',new T.Float32BufferAttribute(fitted,3));baseGeometry.setIndex(indices);baseGeometry.computeVertexNormals();
const normals=Array.from(baseGeometry.attributes.normal.array),origins=Array.from({length:style.baseVertices},(_,i)=>i);
const originalNormals=accessor(doc,binary,primitive.attributes.NORMAL);
for(let i=0;i<style.baseVertices;i++)if(Math.hypot(...normals.slice(i*3,i*3+3))<.5){
 if(i>=points.length)throw new Error('Invalid cloth surface normal');
 const fallback=new T.Vector3(...originalNormals[i]).normalize();
 if(fallback.length()<.5)throw new Error('Invalid source surface normal');
 normals.splice(i*3,3,...fallback.toArray());
}
if(!authoring&&fs.existsSync('art/player-rebuild/selected-player-style-uv.json')){
 const recipe=JSON.parse(fs.readFileSync('art/player-rebuild/selected-player-style-uv.json'));
 if(recipe.geometryHash!==style.geometryHash)throw new Error('Style geometry changed: rebuild authoring and bake its UVs before exporting');
 const seen=new Map(),assigned=new Set(),remapped=[];
 for(const [id,u,v]of recipe.corners){
  const key=[id,u.toFixed(7),v.toFixed(7)].join(',');let next=seen.get(key);
  if(next===undefined){
   next=assigned.has(id)?fitted.length/3:id;
   if(next!==id){fitted.push(...fitted.slice(id*3,id*3+3));normals.push(...normals.slice(id*3,id*3+3));joints.push(...joints.slice(id*4,id*4+4));weights.push(...weights.slice(id*4,id*4+4));sourceUvs.push(...sourceUvs.slice(id*2,id*2+2));origins.push(id);}
   uvs[next*2]=u;uvs[next*2+1]=v;assigned.add(id);seen.set(key,next);
  }
  remapped.push(next);
 }
 if(remapped.length!==indices.length)throw new Error('Packed UV recipe changed triangle count');
 indices.splice(0,indices.length,...remapped);
}
style.vertexOrigins=origins;
// Repack only used data: the old 2048 atlas must not remain embedded in the 512 asset.
const oldImage=doc.images[0],oldImageView=doc.bufferViews[oldImage.bufferView];
fs.writeFileSync('art/player-rebuild/selected-player-source-diffuse.jpg',binary.subarray(oldImageView.byteOffset||0,(oldImageView.byteOffset||0)+oldImageView.byteLength));
const atlasPath='art/player-rebuild/selected-player-ps2-diffuse.png';
const baked=!authoring&&fs.existsSync(atlasPath);
const atlas=baked?fs.readFileSync(atlasPath):binary.subarray(oldImageView.byteOffset||0,(oldImageView.byteOffset||0)+oldImageView.byteLength);
doc.bufferViews=[];doc.accessors=[];const chunks=[];let length=0;
function add(array,type,componentType,count,target){const pad=(4-length%4)%4;chunks.push(Buffer.alloc(pad));length+=pad;const bytes=Buffer.from(array.buffer),view=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,...(target?{target}:{})});chunks.push(bytes);length+=bytes.length;const a={bufferView:view,componentType,type,count};if(type==='VEC3'){a.min=[0,1,2].map(k=>Math.min(...Array.from({length:count},(_,i)=>array[i*3+k])));a.max=[0,1,2].map(k=>Math.max(...Array.from({length:count},(_,i)=>array[i*3+k])));}doc.accessors.push(a);return doc.accessors.length-1;}
const count=fitted.length/3;
primitive.attributes={POSITION:add(new Float32Array(fitted),'VEC3',5126,count,34962),NORMAL:add(new Float32Array(normals),'VEC3',5126,count,34962),TEXCOORD_0:add(new Float32Array(uvs),'VEC2',5126,count,34962),TEXCOORD_1:add(new Float32Array(sourceUvs),'VEC2',5126,count,34962),JOINTS_0:add(new Uint16Array(joints),'VEC4',5123,count,34962),WEIGHTS_0:add(new Float32Array(weights),'VEC4',5126,count,34962)};
primitive.indices=add(new Uint16Array(indices),'SCALAR',5123,indices.length,34963);
const inverse=add(new Float32Array(nodes.flatMap(n=>new T.Matrix4().makeTranslation(...landmarks[n.name]).invert().toArray())),'MAT4',5126,26);
const imagePadding=(4-length%4)%4;chunks.push(Buffer.alloc(imagePadding));length+=imagePadding;const imageView=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:atlas.length});chunks.push(atlas);length+=atlas.length;
doc.images=[{name:'Selected-player-PS2-diffuse',bufferView:imageView,mimeType:baked?'image/png':oldImage.mimeType}];
doc.materials[0].pbrMetallicRoughness.roughnessFactor=.90;delete doc.materials[0].normalTexture;delete doc.materials[0].occlusionTexture;
doc.nodes=[...nodes,{name:'Selected-athlete-neutral',mesh:0,skin:0}];doc.scenes=[{nodes:[0,26]}];doc.scene=0;doc.skins=[{name:'Selected-athlete-anatomical-26',skeleton:0,joints:nodes.map((_,i)=>i),inverseBindMatrices:inverse}];doc.buffers=[{byteLength:length}];doc.asset.extras={basis:'selected-athlete-neutral',motionConnected:false,canonicalRestCompatible:false,retargetRequired:true,skinningRequired:'dual-quaternion',style,sourceHash:crypto.createHash('sha256').update(source).digest('hex')};
const json=Buffer.from(JSON.stringify(doc)),jp=Buffer.alloc((4-json.length%4)%4,32),bin=Buffer.concat(chunks),bp=Buffer.alloc((4-bin.length%4)%4),out=Buffer.alloc(28+json.length+jp.length+bin.length+bp.length);
out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length+jp.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);jp.copy(out,20+json.length);const offset=20+json.length+jp.length;out.writeUInt32LE(bin.length+bp.length,offset);out.writeUInt32LE(0x004e4942,offset+4);bin.copy(out,offset+8);
fs.writeFileSync('art/player-rebuild/'+(authoring?'selected-player-style-authoring.glb':'selected-player-neutral-rig.glb'),out);fs.writeFileSync('art/player-rebuild/selected-neutral-landmarks.json',JSON.stringify({units:'source mesh units',heightScale:PLAYER_HEIGHT_SCALE,landmarks,reviewed:false},null,2));
fs.writeFileSync('art/player-rebuild/selected-player-style.json',JSON.stringify(style,null,2));
const previous=JSON.parse(fs.readFileSync('art/player-rebuild/selected-player-status.json'));
fs.writeFileSync('art/player-rebuild/selected-player-status.json',JSON.stringify({...previous,stage:'neutral-structural-rebuild',revision:4,triangles:indices.length/3,vertices:count,previewEnabled:false,motionConnected:false,approved:false,canonicalRestCompatible:false,retargetRequired:true,skinningRequired:'dual-quaternion',changes:['anatomical neutral skeleton and volume-preserving skin','15 percent wider clavicles with intact arm lengths','shorts hem four inches below each knee','wider separate cloth leg openings','deeper armholes and baked 512 diffuse'],pending:['compound-pose deformation and owner silhouette review','motion retargeting and source selection','gameplay integration and owner approval']},null,2));
console.log({triangles:indices.length/3,bones:26,previewEnabled:false,motionConnected:false});
