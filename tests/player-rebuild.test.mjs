import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {parseGlb,accessor} from '../scripts/luke-rig-tools.mjs';
import {parseRecoveredScene} from '../scripts/recovered-game-harness.mjs';
const audit=JSON.parse(fs.readFileSync(new URL('../art/player-rebuild/motion-audit.json',import.meta.url)));
test('rebuild audit includes all canonical clips and explicitly excludes unresolved bindings',()=>{
 assert.equal(audit.clips.length,976);assert.equal(audit.excluded.length,572);
 assert.equal(new Set([...audit.clips,...audit.excluded].map(c=>c.id)).size,1548);
 assert.ok(audit.clips.every(c=>c.rig==='3165_8d61b035_070'&&c.action===null&&c.reviewStatus==='unreviewed'));
 assert.ok(audit.clips.every(c=>/^[a-f0-9]{64}$/.test(c.glbHash)&&/^[a-f0-9]{64}$/.test(c.metadataHash)));
});
test('original deformation blockout has 26 joints, finite UVs and normalized skin weights within budget',()=>{
 const {doc,binary}=parseGlb(fs.readFileSync(new URL('../art/player-rebuild/athlete-blockout.glb',import.meta.url)));
 assert.equal(doc.skins.length,1);assert.equal(doc.skins[0].joints.length,26);
 let triangles=0;
 for(const mesh of doc.meshes)for(const primitive of mesh.primitives){
  triangles+=doc.accessors[primitive.indices].count/3;
  for(const key of ['POSITION','NORMAL','TEXCOORD_0','WEIGHTS_0']){
   const a=doc.accessors[primitive.attributes[key]],v=doc.bufferViews[a.bufferView],width={VEC2:2,VEC3:3,VEC4:4}[a.type];
   for(let i=0;i<a.count;i++){
    let sum=0;for(let j=0;j<width;j++){const value=binary.readFloatLE((v.byteOffset||0)+i*width*4+j*4);assert.ok(Number.isFinite(value));sum+=value;}
    if(key==='WEIGHTS_0')assert.ok(Math.abs(sum-1)<1e-6);
   }
  }
 }
 assert.ok(triangles>0&&triangles<=20000);
});
test('selected player preserves canonical rest transforms and source texture bytes',()=>{
 const fit=parseGlb(fs.readFileSync(new URL('../art/player-rebuild/selected-player-fit.glb',import.meta.url)));
 const original=parseGlb(fs.readFileSync(new URL('../art/player-rebuild/selected-player-source.glb',import.meta.url)));
 const reference=parseGlb(fs.readFileSync(new URL('../art/player-rebuild/athlete-blockout.glb',import.meta.url)));
 assert.deepEqual(fit.doc.nodes.slice(0,26),reference.doc.nodes.slice(0,26));
 assert.equal(fit.doc.skins[0].joints.length,26);
 const p=fit.doc.meshes[0].primitives[0];assert.equal(fit.doc.accessors[p.indices].count/3,4824);
 for(const w of accessor(fit.doc,fit.binary,p.attributes.WEIGHTS_0))assert.ok(w.every(x=>x>=0)&&Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-6);
 for(const j of accessor(fit.doc,fit.binary,p.attributes.JOINTS_0))assert.ok(j.every(x=>x>=0&&x<26));
 for(const v of accessor(fit.doc,fit.binary,p.attributes.POSITION))assert.ok(v.every(Number.isFinite));
 assert.deepEqual(fit.doc.images,original.doc.images);
 const image=original.doc.bufferViews[original.doc.images[0].bufferView];assert.deepEqual(fit.binary.subarray(image.byteOffset,image.byteOffset+image.byteLength),original.binary.subarray(image.byteOffset,image.byteOffset+image.byteLength));
});
test('upper shoulder vertices are not bound to the head',()=>{
 const source=parseGlb(fs.readFileSync(new URL('../art/player-rebuild/selected-player-source.glb',import.meta.url)));
 const fit=parseGlb(fs.readFileSync(new URL('../art/player-rebuild/selected-player-fit.glb',import.meta.url)));
 const primitive=fit.doc.meshes[0].primitives[0],points=accessor(source.doc,source.binary,source.doc.meshes[0].primitives[0].attributes.POSITION);
 const indices=accessor(fit.doc,fit.binary,primitive.attributes.JOINTS_0),weights=accessor(fit.doc,fit.binary,primitive.attributes.WEIGHTS_0),head=fit.doc.nodes.findIndex(n=>n.name==='head');
 let checked=0;
 points.forEach((p,i)=>{if(Math.abs(p[0])>.095&&p[1]>.825&&p[1]<.85){checked++;for(let j=0;j<4;j++)assert.ok(indices[i][j]!==head||weights[i][j]===0,'shoulder vertex must not follow the head');}});
 assert.ok(checked>0,'fixture contains the formerly misclassified shoulder vertices');
});
for(const file of ['athlete-blockout.glb','selected-player-fit.glb'])test(`${file} plays actual source rotations consistently at 30, 60 and 120 Hz`,async()=>{
 const model=fs.readFileSync(new URL('../art/player-rebuild/'+file,import.meta.url));
 const source=fs.readFileSync('art/player-rebuild/source-motion/4188_a0c36f23_000n_001.glb');
 const clip=(await parseRecoveredScene(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength))).animations[0];
 const poses=[];
 for(const hz of [30,60,120]){
  const scene=(await parseRecoveredScene(model.buffer.slice(model.byteOffset,model.byteOffset+model.byteLength))).scene;
  const mixer=new THREE.AnimationMixer(scene);mixer.clipAction(clip).play();for(let i=0;i<hz;i++)mixer.update(1/hz);
  const bones=[];scene.traverse(o=>{if(o.isBone)bones.push(o);});assert.equal(bones.length,26);
  for(const bone of bones)assert.ok(Math.abs(bone.quaternion.lengthSq()-1)<1e-6,'source quaternion is within float32 unit tolerance');
  poses.push(bones.map(b=>b.quaternion.clone().normalize()));
 }
 for(let i=0;i<26;i++)assert.ok(poses[0][i].angleTo(poses[1][i])<1e-6&&poses[1][i].angleTo(poses[2][i])<1e-6);
});
