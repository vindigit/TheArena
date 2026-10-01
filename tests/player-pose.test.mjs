import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPoseAdapter } from '../src/player-pose.js';
import { captureRest, resetRest, applyStressPose, INSPECTION_POSES } from '../dev/rig-poses.js';
async function fixture(){
  const data=await readFile('public/assets/models/player/luke-player-v1.glb');
  const length=data.readUInt32LE(12),doc=JSON.parse(data.toString('utf8',20,20+length));
  const binary=data.subarray(28+length);doc.images=[];doc.textures=[];doc.samplers=[];
  doc.materials=[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}];
  doc.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
  globalThis.ProgressEvent ||= class {constructor(type,init){Object.assign(this,{type,...init});}};
  const gltf=await new GLTFLoader().parseAsync(JSON.stringify(doc),'');
  const root=new THREE.Group(),visual=gltf.scene;root.add(visual);
  const bones=new Map();let mesh;visual.traverse(n=>{if(n.isBone)bones.set(n.name,n);if(n.isSkinnedMesh)mesh=n;});
  const anchors=Object.fromEntries(['rightHand','leftHand','chest','head'].map(n=>{const a=new THREE.Object3D();root.add(a);return[n,a];}));
  const pose=createPoseAdapter(THREE,visual,bones,anchors);
  const positions=()=>{visual.updateWorldMatrix(true,true);return Object.fromEntries([...bones].map(([n,b])=>[n,b.getWorldPosition(new THREE.Vector3())]));};
  return{root,visual,bones,mesh,anchors,pose,positions};
}
test('Luke moving gather preserves lower-body continuity and exact hand anchors',async()=>{
  let maxFootStep=0,maxPelvisStep=0,maxKneeAngle=0;
  for(const walkFrames of [12,42,83,120]){
    const f=await fixture();
    for(let i=0;i<walkFrames;i++)f.pose.update(1/120,{action:'move',speed:3.38,ballMode:'dribble',dribblePhase:i*.1});
    const before=f.positions(),q=f.bones.get('left_shin').quaternion.clone();
    f.pose.update(1/120,{action:'shoot',speed:3.38,ballMode:'gather',shotProgress:.006});
    const after=f.positions();
    for(const side of ['left','right'])maxFootStep=Math.max(maxFootStep,before[`${side}_foot`].distanceTo(after[`${side}_foot`]));
    maxPelvisStep=Math.max(maxPelvisStep,before.pelvis.distanceTo(after.pelvis));
    maxKneeAngle=Math.max(maxKneeAngle,q.angleTo(f.bones.get('left_shin').quaternion));
    const ball=new THREE.Vector3(.22,1.24+.006/.58*.48,-.37);
    for(const hand of ['rightHand','leftHand'])assert.ok(f.anchors[hand].position.distanceTo(ball)<.006);
    assert.equal(f.pose.diagnostics().hybridWeight,0);assert.equal(f.pose.diagnostics().footCorrection,false);
  }
  assert.ok(maxFootStep<.025,`gather first-frame ankle step ${maxFootStep}`);
  assert.ok(maxPelvisStep<.005,`gather first-frame pelvis step ${maxPelvisStep}`);
  assert.ok(maxKneeAngle<THREE.MathUtils.degToRad(4));
  console.log({maxFootStep,maxPelvisStep,maxKneeDegrees:THREE.MathUtils.radToDeg(maxKneeAngle)});
});
test('Luke crouch knees flex toward -Z, pose rest reset never accumulates, pickup keeps joint ownership',async()=>{
  const f=await fixture();
  f.pose.update(0,{action:'shoot',speed:0,shotProgress:.29,ballMode:'gather'});
  const expected=new Map([...f.bones].map(([n,b])=>[n,{p:b.position.clone(),q:b.quaternion.clone()}]));
  const points=f.positions();
  for(const side of ['left','right']){
    assert.ok(points[`${side}_shin`].z<points[`${side}_thigh`].z,'knee bends behind hip');
    assert.ok(points[`${side}_shin`].z<points[`${side}_foot`].z,'knee bends behind ankle');
    assert.ok(Math.sign(points[`${side}_shin`].x)===Math.sign(points[`${side}_thigh`].x),'knee crosses center');
  }
  for(let i=0;i<500;i++)f.pose.update(0,{action:'shoot',speed:0,shotProgress:.29,ballMode:'gather'});
  for(const[n,b]of f.bones){assert.ok(b.position.distanceTo(expected.get(n).p)<1e-12);assert.ok(b.quaternion.angleTo(expected.get(n).q)<1e-7);}
  f.pose.reset();f.pose.update(0,{action:'move',speed:3.38,ballMode:'loose',dribblePhase:0});
  const loose=new Map([...f.bones].map(([n,b])=>[n,b.quaternion.clone()]));
  f.pose.update(0,{action:'move',speed:3.38,ballMode:'dribble',dribblePhase:0});
  for(const[n,b]of f.bones)assert.ok(b.quaternion.angleTo(loose.get(n))<1e-7,'pickup swaps lower writer');
  assert.deepEqual(f.root.position.toArray(),[0,0,0]);
});
test('repeatable isolated stress poses keep valid skin and uncrossed knees',async()=>{
  const f=await fixture(),rest=captureRest(f.bones);let minFloor=Infinity;
  for(const name of INSPECTION_POSES){
    resetRest(f.bones,rest);applyStressPose(THREE,f.visual,f.bones,rest,name);
    const points=f.positions();
    assert.ok(points.left_shin.x<0&&points.right_shin.x>0,`${name}: knees cross`);
    f.mesh.skeleton.update();
    const pos=f.mesh.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){
      const p=f.mesh.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(pos,i));
      assert.ok(p.toArray().every(Number.isFinite),`${name}: invalid deformation`);
      assert.ok(Math.abs(p.x)<1.8&&p.y>-.1&&p.y<3&&Math.abs(p.z)<1.2,`${name}: escaped stress envelope`);
      minFloor=Math.min(minFloor,p.y);
    }
  }
  console.log({stressPoses:INSPECTION_POSES.length,minFloor});
});
