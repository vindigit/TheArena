// Neutral hand-region triangles against the current displayed ball. This probe
// runs after authoritative world matrices update; morph safety is a later pass.
import metadata from '../art/animation/hand-shapes.json' with {type:'json'};
import {closestPointTriangle} from './hand-clearance.js';
export function createAbsoluteHandProbe(THREE,visual){
 let mesh=null;visual.traverse(o=>{if(o.isSkinnedMesh)mesh=o});
 const geo=mesh.geometry,indices=geo.getAttribute('skinIndex'),weights=geo.getAttribute('skinWeight');
 const joint={right:mesh.skeleton.bones.findIndex(b=>b.name==='right_hand'),left:mesh.skeleton.bones.findIndex(b=>b.name==='left_hand')};
 const sides={right:[],left:[]};
 for(const tri of metadata.handTriangles){const scores={right:0,left:0};for(const v of tri)for(let k=0;k<4;k++)for(const side of ['right','left'])if(indices.getComponent(v,k)===joint[side])scores[side]+=weights.getComponent(v,k);sides[scores.right>=scores.left?'right':'left'].push(tri);}
 const v=new THREE.Vector3();
 function measure(ball,radius=.12,displayed=false){
  visual.updateWorldMatrix(true,true);mesh.updateMatrixWorld(true);mesh.skeleton.update();
  const points=new Map();for(const i of metadata.handVertexIndices){if(displayed)mesh.getVertexPosition(i,v);else{v.fromBufferAttribute(geo.attributes.position,i);mesh.applyBoneTransform(i,v);}v.applyMatrix4(mesh.matrixWorld);points.set(i,v.toArray())}
  const center=ball.toArray(),result={};
  for(const side of ['right','left']){let min=Infinity,point=null,worstTriangle=null;for(const tri of sides[side]){
   // Include any boundary vertex even if it is not a morph-owned vertex.
   for(const i of tri)if(!points.has(i)){if(displayed)mesh.getVertexPosition(i,v);else{v.fromBufferAttribute(geo.attributes.position,i);mesh.applyBoneTransform(i,v);}v.applyMatrix4(mesh.matrixWorld);points.set(i,v.toArray())}
   const q=closestPointTriangle(center,...tri.map(i=>points.get(i))),d=Math.hypot(...q.map((x,k)=>x-center[k]));if(d<min){min=d;point=q;worstTriangle=tri}
  }result[side]={distance:min,penetration:Math.max(0,radius-min),closest:point,triangle:worstTriangle};}
  return result;
 }
 return {measure};
}
