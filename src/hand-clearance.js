/** Reversible canonical Luke morphs and exact per-primitive sphere-clearance.
 * No dependencies: provide the same THREE instance used by the caller.
 * Use AFTER current pose and displayed ball are established, every rendered frame.
 * Smooth desired weights BEFORE limitWeights; never smooth its returned result.
 */
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const addScale=(a,b,s)=>[a[0]+b[0]*s,a[1]+b[1]*s,a[2]+b[2]*s];
function segmentClosest(p,a,b){const ab=sub(b,a),den=dot(ab,ab);return addScale(a,ab,den>0?clamp(dot(sub(p,a),ab)/den):0);}
/** Ericson closest-point regions, with explicit degenerate triangle fallback. */
export function closestPointTriangle(p,a,b,c){
 const ab=sub(b,a),ac=sub(c,a),cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
 if(dot(cross,cross)<1e-28){return [segmentClosest(p,a,b),segmentClosest(p,b,c),segmentClosest(p,c,a)].sort((x,y)=>dot(sub(p,x),sub(p,x))-dot(sub(p,y),sub(p,y)))[0];}
 const ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return [...a];
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return [...b];
 const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return addScale(a,ab,d1/(d1-d3));
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return [...c];
 const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return addScale(a,ac,d2/(d2-d6));
 const va=d3*d6-d5*d4;if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0)return addScale(b,sub(c,b),(d4-d3)/((d4-d3)+(d5-d6)));
 const den=1/(va+vb+vc),v=vb*den,w=vc*den;return addScale(addScale(a,ab,v),ac,w);
}
const pointAt=(positions,i)=>positions.subarray?positions.subarray(i*3,i*3+3):positions[i];
/** Accept flat typed position buffers OR arrays of [x,y,z], in one shared metric space. */
export function analyzeHandClearance({neutralPositions,morphedPositions,triangles,triangleIds=null,vertexIndices=null,ballCenter,ballRadius=.12,tolerance=1e-6}){
 const center=ballCenter.toArray?ballCenter.toArray():ballCenter;
 if(!(ballRadius>0)||center.length!==3||!center.every(Number.isFinite))throw Error('Invalid ball sphere');
 let maxAddedPenetration=0,maxNeutralPenetration=0,maxMorphedPenetration=0,violatingTriangleCount=0,worstTriangle=null,maxAddedVertexPenetration=0,violatingVertexCount=0;
 const resultFor=(q)=>Math.max(0,ballRadius-Math.hypot(q[0]-center[0],q[1]-center[1],q[2]-center[2]));
 triangles.forEach((tri,ti)=>{
  const n=tri.map(i=>pointAt(neutralPositions,i)),m=tri.map(i=>pointAt(morphedPositions,i));
  const np=resultFor(closestPointTriangle(center,...n)),mp=resultFor(closestPointTriangle(center,...m)),added=mp-np;
  if(!Number.isFinite(np+mp))throw Error('Nonfinite hand triangle');
  maxNeutralPenetration=Math.max(maxNeutralPenetration,np);maxMorphedPenetration=Math.max(maxMorphedPenetration,mp);
  if(added>maxAddedPenetration){maxAddedPenetration=added;worstTriangle={triangleId:triangleIds?.[ti]??ti,indices:[...tri],neutralPenetration:np,morphedPenetration:mp,addedPenetration:added};}
  if(added>tolerance)violatingTriangleCount++;
 });
 if(vertexIndices)for(const i of vertexIndices){const np=resultFor(pointAt(neutralPositions,i)),mp=resultFor(pointAt(morphedPositions,i)),add=mp-np;if(!Number.isFinite(np+mp))throw Error('Nonfinite hand vertex');maxAddedVertexPenetration=Math.max(maxAddedVertexPenetration,add);if(add>tolerance)violatingVertexCount++;}
 return {safe:violatingTriangleCount===0&&violatingVertexCount===0,tolerance,maxAddedPenetration,maxAddedVertexPenetration,maxNeutralPenetration,maxMorphedPenetration,violatingTriangleCount,violatingVertexCount,worstTriangle};
}
export function normalizeHandWeights(weights){
 const w=Array.from({length:4},(_,i)=>Number.isFinite(weights?.[i])?clamp(weights[i]):0);
 for(const i of [0,2]){const sum=w[i]+w[i+1];if(sum>1){w[i]/=sum;w[i+1]/=sum;}}
 return w;
}
export function createHandShapeAdapter(THREE,mesh,metadata){
 if(!mesh.isSkinnedMesh)throw Error('Expected THREE.SkinnedMesh');
 const geometry=mesh.geometry,base=geometry.getAttribute('position'),count=base.count;
 if(count!==metadata.baseVertexCount)throw Error('Canonical Luke vertex count differs');
 const baseArray=Float64Array.from(base.array),deltas=metadata.targets.map(t=>{const a=new Float64Array(count*3);for(const [i,x,y,z]of t.positionDeltas){a.set([x,y,z],i*3);}return a;});
 const handVertices=metadata.handVertexIndices,triangles=metadata.handTriangles;
 const evaluationVertices=[...new Set(triangles.flat())];
 const index=geometry.getIndex();
 for(let n=0;n<triangles.length;n++)for(let k=0;k<3;k++)if(index.getX(metadata.handTriangleIndices[n]*3+k)!==triangles[n][k])throw Error("Canonical Luke hand topology differs");
 const v=new THREE.Vector3();let installed=false;
 function installMorphs(){
  if(installed)return;
  if(geometry.morphAttributes.position?.length){
   const names=metadata.targetNames;for(let i=0;i<names.length;i++)if(mesh.morphTargetDictionary?.[names[i]]!==i)throw Error('Unexpected preexisting morph targets');
  }else{
   geometry.morphTargetsRelative=true;
   geometry.morphAttributes.position=metadata.targets.map((t,k)=>{const attr=new THREE.Float32BufferAttribute(deltas[k],3);attr.name=t.name;return attr;});
   geometry.morphAttributes.normal=metadata.targets.map(t=>{const a=new Float32Array(count*3);for(const [i,x,y,z] of t.normalDeltas)a.set([x,y,z],i*3);const attr=new THREE.Float32BufferAttribute(a,3);attr.name=t.name;return attr;});
   mesh.updateMorphTargets();geometry.computeBoundingBox();geometry.computeBoundingSphere();
   // Three recompiles shaders when the material is marked dirty after targets are installed.
   for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.needsUpdate=true;
  }
  installed=true;mesh.morphTargetInfluences.fill(0);
 }
 function preparePose(){mesh.updateWorldMatrix(true,false);for(const bone of mesh.skeleton.bones)bone.updateWorldMatrix(true,false);
  // SkinnedMesh overrides updateMatrixWorld, not updateWorldMatrix. Refresh its attached
  // bind inverse after root/visual motion, before sampling the current visible geometry.
  mesh.updateMatrixWorld(true);mesh.skeleton.update();}
 function posedPositions(weights,positions=new Float64Array(count*3)){
  const w=normalizeHandWeights(weights);
  for(const i of evaluationVertices){const j=i*3;v.set(baseArray[j],baseArray[j+1],baseArray[j+2]);for(let k=0;k<4;k++)if(w[k]){v.x+=w[k]*deltas[k][j];v.y+=w[k]*deltas[k][j+1];v.z+=w[k]*deltas[k][j+2];}mesh.applyBoneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);positions.set(v.toArray(),j);}
  return positions;
 }
 const neutralScratch=new Float64Array(count*3),deltaScratch=Array.from({length:4},()=>new Float64Array(count*3)),trialScratch=new Float64Array(count*3);
 function evaluator(ballCenter,ballRadius){
  preparePose();const neutral=posedPositions([0,0,0,0],neutralScratch);
  const worldDeltas=deltas.map((_,k)=>{const w=[0,0,0,0];w[k]=1;const p=posedPositions(w,deltaScratch[k]);for(const i of evaluationVertices)for(let c=0;c<3;c++)p[i*3+c]-=neutral[i*3+c];return p;});
  const sphere=ballCenter.toArray?ballCenter.toArray():ballCenter;
  const getPen=(positions,tri)=>{const point=closestPointTriangle(sphere,...tri.map(i=>pointAt(positions,i)));return Math.max(0,ballRadius-Math.hypot(point[0]-sphere[0],point[1]-sphere[1],point[2]-sphere[2]));};
  const neutralPen=triangles.map(tri=>getPen(neutral,tri));
  const vertexPen=handVertices.map(i=>{const j=i*3;return Math.max(0,ballRadius-Math.hypot(neutral[j]-sphere[0],neutral[j+1]-sphere[1],neutral[j+2]-sphere[2]));});
  const masks=triangles.map(tri=>worldDeltas.reduce((mask,delta,k)=>mask|(tri.some(i=>delta[i*3]!==0||delta[i*3+1]!==0||delta[i*3+2]!==0)?1<<k:0),0));
  const makePositions=weights=>{const w=normalizeHandWeights(weights),morphed=trialScratch;morphed.set(neutral);for(const i of evaluationVertices)for(let c=0;c<3;c++){const j=i*3+c;for(let k=0;k<4;k++)morphed[j]+=w[k]*worldDeltas[k][j];}return morphed;};
  const check=weights=>analyzeHandClearance({neutralPositions:neutral,morphedPositions:makePositions(weights),triangles,triangleIds:metadata.handTriangleIndices,vertexIndices:handVertices,ballCenter,ballRadius,tolerance:metadata.maxAdditionalPenetrationMetres??1e-6});
  let lastFailed=-1;
  check.withinBudget=weights=>{
   const positions=makePositions(weights),activeMask=weights.reduce((mask,w,k)=>mask|(w?1<<k:0),0),budget=.25*(metadata.maxAdditionalPenetrationMetres??1e-6);
   if(lastFailed>=0&&(masks[lastFailed]&activeMask)&&getPen(positions,triangles[lastFailed])-neutralPen[lastFailed]>budget)return false;
   for(let t=0;t<triangles.length;t++)if((masks[t]&activeMask)&&getPen(positions,triangles[t])-neutralPen[t]>budget){lastFailed=t;return false;}
   for(let v=0;v<handVertices.length;v++){const i=handVertices[v]*3,pen=Math.max(0,ballRadius-Math.hypot(positions[i]-sphere[0],positions[i+1]-sphere[1],positions[i+2]-sphere[2]));if(pen-vertexPen[v]>budget)return false;}
   return true;
  };
  return check;
 }
 function evaluate(weights,ballCenter,ballRadius=.12){return evaluator(ballCenter,ballRadius)(weights);}
 function limitWeights(requested,ballCenter,ballRadius=.12){
  const desired=normalizeHandWeights(requested),check=evaluator(ballCenter,ballRadius),requestedAudit=check(desired);
  // Use only a quarter of the public 1 µm differential budget, leaving numerical headroom.
  const withinBudget=r=>r.safe&&Math.max(r.maxAddedPenetration,r.maxAddedVertexPenetration)<=.25*(metadata.maxAdditionalPenetrationMetres??1e-6);
  if(withinBudget(requestedAudit))return{requested:desired,applied:[...desired],scales:[1,1],limited:false,requestedAudit,audit:requestedAudit};
  let applied=[0,0,0,0];const scales=[0,0];
  // Independent hands cannot mask each other's unsafe primitives. Start from exact neutral,
  // then sample from neutral outward for each hand.
  // 16 ordered probes find the first observed unsafe interval; refinement always retains
  // a tested safe endpoint. This does not claim continuous-time collision coverage.
  for(const [s,offset]of [[0,0],[1,2]]){
   if(desired[offset]+desired[offset+1]===0){scales[s]=1;continue;}
   let lo=0,hi=1,hit=false;
   for(let step=1;step<=16;step++){
    const scale=step/16,trial=[...applied];trial[offset]=desired[offset]*scale;trial[offset+1]=desired[offset+1]*scale;
    if(!check.withinBudget(trial)){hi=scale;hit=true;break;}lo=scale;
   }
   if(hit)for(let n=0;n<16;n++){const mid=(lo+hi)/2,trial=[...applied];trial[offset]=desired[offset]*mid;trial[offset+1]=desired[offset+1]*mid;if(check.withinBudget(trial))lo=mid;else hi=mid;}
   // Rounding safety margin: return slightly within the checked bound.
   const scale=lo<1?Math.max(0,lo-1e-5):lo;scales[s]=scale;applied[offset]=desired[offset]*scale;applied[offset+1]=desired[offset+1]*scale;
  }
  let audit=check(applied);if(!withinBudget(audit)){applied=[0,0,0,0];scales.fill(0);audit=check(applied);}
  return{requested:desired,applied,scales,limited:true,requestedAudit,audit};
 }
 function applyWeights(weights){installMorphs();const w=normalizeHandWeights(weights);for(let i=0;i<4;i++)mesh.morphTargetInfluences[i]=w[i];return w;}
 return {installMorphs,preparePose,posedPositions,evaluate,limitWeights,applyWeights,metadata};
}
