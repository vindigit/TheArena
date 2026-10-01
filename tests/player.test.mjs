import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPoseAdapter } from '../src/player-pose.js';
import { validateLukeRig } from '../src/luke-rig-contract.js';

// Offline contract/deformation checks on the actual shipped binary. Image
// decoding is tested separately; remove textures only for Node's scene parser.
const path = process.argv[2] || 'public/assets/models/player/luke-player-v1.glb';
const data = await readFile(path);
assert.equal(data.toString('ascii',0,4),'glTF');assert.equal(data.readUInt32LE(8),data.length);
assert.ok(data.length<=800000);
const jsonLength=data.readUInt32LE(12);
const doc=JSON.parse(data.toString('utf8',20,20+jsonLength));
const binary=data.subarray(28+jsonLength);
assert.equal(doc.skins.length,1);assert.equal(doc.skins[0].joints.length,17);
assert.ok(!doc.animations?.length);assert.equal(doc.materials.length,1);assert.equal(doc.images.length,1);
const imageView=doc.bufferViews[doc.images[0].bufferView];
const texture=await sharp(binary.subarray(imageView.byteOffset,imageView.byteOffset+imageView.byteLength)).metadata();
assert.deepEqual([texture.width,texture.height],[512,512]);assert.equal(texture.hasAlpha,false);
assert.ok(!doc.buffers.some(b=>b.uri));assert.ok(!doc.images.some(i=>i.uri));
for(const n of doc.nodes){assert.ok(!n.scale||n.scale.every(v=>v===1));assert.ok(!n.rotation);assert.ok(!n.matrix);}
const parseDoc=structuredClone(doc);parseDoc.images=[];parseDoc.textures=[];parseDoc.samplers=[];
parseDoc.materials=[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}];
parseDoc.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
globalThis.ProgressEvent ||= class { constructor(type,init){Object.assign(this,{type,...init});} };
const gltf=await new GLTFLoader().parseAsync(JSON.stringify(parseDoc),'');
const bones=new Map();let mesh;
gltf.scene.traverse(n=>{if(n.isBone)bones.set(n.name,n);if(n.isSkinnedMesh)mesh=n;});
validateLukeRig(THREE,gltf.scene,bones,[mesh]);
const geometry=mesh.geometry, pos=geometry.attributes.position;
assert.ok(geometry.index.count/3<=6000);
const bindBounds=new THREE.Box3().setFromObject(gltf.scene);
assert.ok(Math.abs(bindBounds.min.y)<1e-6);assert.ok(bindBounds.max.y>2&&bindBounds.max.y<2.1);
let maxInfluences=0,maxBindError=0;
mesh.skeleton.update();
for(let i=0;i<pos.count;i++){
 const point=new THREE.Vector3().fromBufferAttribute(pos,i),actual=mesh.applyBoneTransform(i,point.clone());
 maxBindError=Math.max(maxBindError,actual.distanceTo(point));
 const w=Array.from({length:4},(_,k)=>geometry.attributes.skinWeight.array[i*4+k]);
 assert.ok(w.every(x=>Number.isFinite(x)&&x>=0));assert.ok(Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-6);
 maxInfluences=Math.max(maxInfluences,w.filter(x=>x>0).length);
 const normal=new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal,i);assert.ok(Math.abs(normal.length()-1)<1e-5);
 for(let k=0;k<2;k++)assert.ok(geometry.attributes.uv.array[i*2+k]>=0&&geometry.attributes.uv.array[i*2+k]<=1);
}
assert.ok(maxInfluences<=4);assert.ok(maxBindError<1e-6);
const anchors=Object.fromEntries(['rightHand','leftHand','chest','head'].map(n=>[n,new THREE.Object3D()]));
const pose=createPoseAdapter(THREE,gltf.scene,bones,anchors);
const rootTransform=gltf.scene.position.clone();
let maxGatherError=0,minPoseY=Infinity,maxPoseRadius=0,minGameFloorY=Infinity,maxDunkGripError=0;
const minYByAction={};
for(const action of ['idle','move','shoot','layup','dunk'])for(let f=0;f<=60;f++){
 const progress=f/60;
 pose.update(1/60,{action,speed:action==='move'?5.45:0,shotProgress:progress,dribblePhase:f*.2});
 gltf.scene.updateMatrixWorld(true);mesh.skeleton.update();
 assert.ok(gltf.scene.position.equals(rootTransform));
 if(action==='shoot'&&progress<=.58){const ball=new THREE.Vector3(.22,1.24+progress/.58*.48,-.37);maxGatherError=Math.max(maxGatherError,anchors.rightHand.position.distanceTo(ball),anchors.leftHand.position.distanceTo(ball));}
 if(action==='dunk')maxDunkGripError=Math.max(maxDunkGripError,anchors.rightHand.position.distanceTo(anchors.leftHand.position));
 for(const a of Object.values(anchors))assert.ok(a.position.toArray().every(Number.isFinite));
 for(let i=0;i<pos.count;i++){
  const v=mesh.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(pos,i));
  assert.ok(v.toArray().every(Number.isFinite));minPoseY=Math.min(minPoseY,v.y);maxPoseRadius=Math.max(maxPoseRadius,v.length());
  minYByAction[action]=Math.min(minYByAction[action]??Infinity,v.y);
  const gameJump=(action==='layup'||action==='dunk')?Math.sin(progress*Math.PI)*(action==='dunk'?.86:.64):0;
  minGameFloorY=Math.min(minGameFloorY,v.y+gameJump);
  assert.ok(Math.abs(v.x)<1.3&&v.y>-.15&&v.y<2.8&&Math.abs(v.z)<1.2,'deformation escaped envelope');
 }
}
assert.ok(maxGatherError<.006,`gather error ${maxGatherError}`);
assert.ok(minGameFloorY>-.005,`floor penetration ${minGameFloorY}`);
assert.ok(maxDunkGripError<.015,`dunk grip ${maxDunkGripError}`);
console.log(JSON.stringify({pass:true,character:'Luke',bytes:data.length,triangles:geometry.index.count/3,vertices:pos.count,bones:bones.size,materials:1,maxInfluences,maxBindError,maxGatherError,maxDunkGripError,minGameFloorY,minPoseY,minYByAction,maxPoseRadius,poses:305},null,2));
