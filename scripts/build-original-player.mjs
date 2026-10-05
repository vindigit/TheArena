// Original editable character construction. Only rig transforms come from recovery.
import fs from 'node:fs';
import * as THREE from 'three';
import {parseGlb} from './luke-rig-tools.mjs';
import crypto from 'node:crypto';
const {doc:reference}=parseGlb(fs.readFileSync('public/assets/models/player/nba2k9/player-one.glb'));
const names=['root','lfemur','ltibia','lfoot','ltoes','rfemur','rtibia','rfoot','rtoes','waist','lowback','thorax','neck','head','lcollar','lhumerus','ltwist','lelbow','lwrist','lhand','rcollar','rhumerus','rtwist','relbow','rwrist','rhand'];
const index=new Map(names.map((n,i)=>[n,i])),source=names.map(name=>reference.nodes.find(n=>n.name===name));
const nodes=source.map(n=>({name:n.name,translation:n.translation||[0,0,0],...(n.rotation?{rotation:n.rotation}:{}),children:(n.children||[]).map(i=>index.get(reference.nodes[i].name)).filter(i=>i!==undefined)}));
const parents=new Map();nodes.forEach((n,i)=>n.children.forEach(c=>parents.set(c,i)));
const matrices=[];function matrix(i){if(matrices[i])return matrices[i];const n=nodes[i],m=new THREE.Matrix4().compose(new THREE.Vector3(...n.translation),new THREE.Quaternion(...n.rotation||[0,0,0,1]),new THREE.Vector3(1,1,1));if(parents.has(i))m.premultiply(matrix(parents.get(i)));return matrices[i]=m;}
const p=name=>new THREE.Vector3().setFromMatrixPosition(matrix(index.get(name))),joint=name=>index.get(name);
const materials=[['skin',[.43,.245,.145,1]],['uniform',[.17,.11,.28,1]],['trim',[.88,.80,.61,1]],['shoe',[.86,.87,.83,1]],['rubber',[.075,.075,.08,1]],['hair',[.035,.026,.022,1]],['eye',[.82,.78,.72,1]]].map(([name,baseColorFactor])=>({name,doubleSided:false,pbrMetallicRoughness:{baseColorFactor,metallicFactor:0,roughnessFactor:.92}}));
const parts=[];
function part(name,material){const o={name,material,positions:[],uvs:[],joints:[],weights:[],indices:[]};parts.push(o);return o;}
function vertex(o,v,weights,uv=[0,0]){o.positions.push(...v);o.uvs.push(...uv);const entries=Object.entries(weights).filter(([,w])=>w>0).slice(0,4),sum=entries.reduce((a,[,w])=>a+w,0);o.joints.push(...entries.map(([n])=>joint(n)),...Array(4-entries.length).fill(0));o.weights.push(...entries.map(([,w])=>w/sum),...Array(4-entries.length).fill(0));return o.positions.length/3-1;}
function loft(o,rings,weights,sides=20){
 const start=o.positions.length/3;
 rings.forEach(([x,y,z,rx,rz],r)=>{for(let k=0;k<sides;k++){const a=k/sides*Math.PI*2;vertex(o,[x+rx*Math.cos(a),y,z+rz*Math.sin(a)],weights(r),[k/sides,r/(rings.length-1)]);}});
 for(let r=0;r<rings.length-1;r++)for(let k=0;k<sides;k++){const a=start+r*sides+k,b=start+r*sides+(k+1)%sides,c=b+sides,d=a+sides;o.indices.push(a,d,b,b,d,c);}
 for(const [r,reverse]of [[0,true],[rings.length-1,false]]){const center=vertex(o,rings[r].slice(0,3),weights(r),[.5,.5]);for(let k=0;k<sides;k++){const a=start+r*sides+k,b=start+r*sides+(k+1)%sides;o.indices.push(...(reverse?[center,b,a]:[center,a,b]));}}
}
function ellipsoid(o,center,radii,bone,segments=20,rings=12){const start=o.positions.length/3;for(let j=0;j<=rings;j++)for(let k=0;k<segments;k++){const v=j/rings*Math.PI,a=k/segments*Math.PI*2;vertex(o,[center[0]+radii[0]*Math.sin(v)*Math.cos(a),center[1]+radii[1]*Math.cos(v),center[2]+radii[2]*Math.sin(v)*Math.sin(a)],{[bone]:1},[k/segments,j/rings]);}for(let j=0;j<rings;j++)for(let k=0;k<segments;k++){const a=start+j*segments+k,b=start+j*segments+(k+1)%segments,c=b+segments,d=a+segments;o.indices.push(a,b,d,b,c,d);}}
function tube(o,points,radii,bones,sides=16){const start=o.positions.length/3;points.forEach((point,r)=>{const direction=(r===points.length-1?point.clone().sub(points[r-1]):points[r+1].clone().sub(point)).normalize(),u=new THREE.Vector3(0,0,1).cross(direction).normalize(),v=direction.clone().cross(u).normalize();for(let k=0;k<sides;k++){const a=k/sides*Math.PI*2,q=point.clone().addScaledVector(u,Math.cos(a)*radii[r]).addScaledVector(v,Math.sin(a)*radii[r]*.85);vertex(o,q.toArray(),bones[r],[k/sides,r/(points.length-1)]);}});for(let r=0;r<points.length-1;r++)for(let k=0;k<sides;k++){const a=start+r*sides+k,b=start+r*sides+(k+1)%sides,c=b+sides,d=a+sides;o.indices.push(a,b,d,b,c,d);}}
const torso=part('Arena-athlete-torso',0);loft(torso,[[0,-15,0,22,12],[0,-4,0,20,12],[0,8,-2,18,11],[0,20,-4,20,12],[0,34,-5,24,13],[0,44,-3,25,12],[0,51,-2,18,10]],r=>r<2?{root:1}:r<4?{waist:.4,lowback:.6}:{thorax:1},24);
const jersey=part('Arena-original-jersey',1);loft(jersey,[[0,-6,0,21,13],[0,7,-1,20,12],[0,21,-3,22,13],[0,34,-4,25,14],[0,45,-2,25.5,12.8],[0,49,-2,18,11]],r=>r<2?{root:.3,waist:.7}:r<4?{lowback:.5,thorax:.5}:{thorax:1},24);
loft(part('Arena-neck',0),[[0,48,-2,7.5,7],[0,58,-3,6.5,6],[0,64,-2,7,6]],()=>({neck:1}),20);
for(const side of ['l','r']){
 const hip=p(side+'femur'),knee=p(side+'tibia'),ankle=p(side+'foot'),sign=side==='l'?1:-1;
 const leg=part('Arena-'+side+'-leg',0),points=[hip,hip.clone().lerp(knee,.25),hip.clone().lerp(knee,.6),knee,knee.clone().lerp(ankle,.25),knee.clone().lerp(ankle,.65),ankle];
 tube(leg,points,[10,10,8.5,6.5,7.5,5.4,4],points.map((_,i)=>i<3?{[side+'femur']:1}:i===3?{[side+'femur']:.5,[side+'tibia']:.5}:{[side+'tibia']:1}),20);
 const shorts=part('Arena-'+side+'-shorts',1);tube(shorts,[hip.clone().add(new THREE.Vector3(0,5,0)),hip.clone().lerp(knee,.28),hip.clone().lerp(knee,.55)],[13,13,12],[{root:.6,[side+'femur']:.4},{[side+'femur']:1},{[side+'femur']:1}],20);
 tube(part('Arena-'+side+'-shorts-trim',2),[hip.clone().lerp(knee,.53),hip.clone().lerp(knee,.58)],[12.1,12.1],[{[side+'femur']:1},{[side+'femur']:1}],20);
 const shoulder=p(side+'humerus'),elbow=p(side+'elbow'),wrist=p(side+'wrist'),hand=p(side+'hand');
 const armPoints=[shoulder,shoulder.clone().lerp(elbow,.22),shoulder.clone().lerp(elbow,.65),elbow,elbow.clone().lerp(wrist,.3),elbow.clone().lerp(wrist,.72),wrist];
 tube(part('Arena-'+side+'-arm',0),armPoints,[8.6,9,7.2,5.2,6.3,4.3,3.2],armPoints.map((_,i)=>i<3?{[side+'humerus']:1}:i===3?{[side+'humerus']:.5,[side+'elbow']:.5}:{[side+'elbow']:1}),20);
 ellipsoid(part('Arena-'+side+'-palm',0),hand.toArray(),[4.8,3.2,6.2],side+'hand',16,10);
 for(let finger=0;finger<4;finger++)ellipsoid(part('Arena-'+side+'-finger-'+finger,0),[hand.x+sign*(finger-1.5)*2.2,hand.y-1,hand.z+5.5],[1.2,1.45,4.2],side+'hand',10,8);
 ellipsoid(part('Arena-'+side+'-thumb',0),[hand.x+sign*5,hand.y-1.4,hand.z+1],[1.8,1.8,3.4],side+'hand',10,8);
 const x=ankle.x,z=ankle.z;
 loft(part('Arena-'+side+'-shoe-upper',3),[[x,-106,z+5,6.7,13],[x,-103,z+5,7.1,13.2],[x,-98,z+2,6.5,11],[x,-93,z-2,4.8,5.5]],()=>({[side+'foot']:1}),20);
 loft(part('Arena-'+side+'-sole',4),[[x,-108,z+5,6.8,13.3],[x,-105,z+5,7.2,13.5]],()=>({[side+'foot']:1}),20);
 loft(part('Arena-'+side+'-sock',2),[[x,-96,z,4,4.5],[x,-87,z,4.7,4.5]],()=>({[side+'tibia']:.3,[side+'foot']:.7}),16);
}
const head=p('head');ellipsoid(part('Arena-original-head',0),[0,head.y+5,head.z+1],[9.8,13.8,10.2],'head',32,20);
for(const sign of [-1,1]){
 ellipsoid(part('Arena-ear-'+sign,0),[sign*9.5,head.y+5,head.z+.5],[2,3.3,1.8],'head',12,10);
 ellipsoid(part('Arena-eye-'+sign,6),[sign*3.9,head.y+8.2,head.z+10.2],[2.05,.85,.6],'head',16,8);
 ellipsoid(part('Arena-pupil-'+sign,5),[sign*3.9,head.y+8.2,head.z+10.75],[.72,.72,.2],'head',12,8);
 ellipsoid(part('Arena-brow-'+sign,5),[sign*3.9,head.y+10,head.z+9.3],[2.6,.48,.7],'head',12,8);
}
ellipsoid(part('Arena-nose',0),[0,head.y+4.8,head.z+11],[1.85,3.4,2.3],'head',16,12);
ellipsoid(part('Arena-upper-lip',0),[0,head.y+.4,head.z+10.1],[3,.65,.6],'head',16,8);
ellipsoid(part('Arena-mouth-line',5),[0,head.y-.1,head.z+10.45],[2.8,.22,.15],'head',16,8);
ellipsoid(part('Arena-lower-lip',0),[0,head.y-.7,head.z+10],[2.8,.65,.6],'head',16,8);
loft(part('Arena-cropped-hair',5),[[0,head.y+13,head.z,8.7,8.4],[0,head.y+16,head.z,6.8,6.8],[0,head.y+19,head.z,1,1]],()=>({head:1}),28);
// Original number 07, mesh lettering (no recovered identity, logos or textures).
const digits={'0':['111','101','101','101','111'],'7':['111','001','001','010','010']},number=part('Arena-number-07',2);
for(const [d,glyph]of Object.entries(digits))glyph.forEach((line,r)=>[...line].forEach((bit,c)=>{if(bit==='0')return;const x=(d==='0'?-5:1)+c*1.6,y=34-r*1.8,z=10.4;const a=vertex(number,[x,y,z],{thorax:1}),b=vertex(number,[x+1.4,y,z],{thorax:1}),c1=vertex(number,[x+1.4,y-1.6,z],{thorax:1}),e=vertex(number,[x,y-1.6,z],{thorax:1});number.indices.push(a,e,b,b,e,c1);}));
const chunks=[],bufferViews=[],accessors=[];let length=0;
function accessor(array,componentType,type,count,target){const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),view=bufferViews.length;bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,...(target?{target}:{})});chunks.push(bytes);length+=bytes.length;const a={bufferView:view,componentType,type,count};if(type==='VEC3'){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<count;i++)for(let j=0;j<3;j++){a.min[j]=Math.min(a.min[j],array[i*3+j]);a.max[j]=Math.max(a.max[j],array[i*3+j]);}}accessors.push(a);return accessors.length-1;}
const meshes=parts.map(o=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(o.positions,3));geometry.setIndex(o.indices);geometry.computeVertexNormals();return {name:o.name,primitives:[{attributes:{POSITION:accessor(new Float32Array(o.positions),5126,'VEC3',o.positions.length/3,34962),NORMAL:accessor(geometry.attributes.normal.array,5126,'VEC3',o.positions.length/3,34962),TEXCOORD_0:accessor(new Float32Array(o.uvs),5126,'VEC2',o.positions.length/3,34962),JOINTS_0:accessor(new Uint16Array(o.joints),5123,'VEC4',o.positions.length/3,34962),WEIGHTS_0:accessor(new Float32Array(o.weights),5126,'VEC4',o.positions.length/3,34962)},indices:accessor(new Uint16Array(o.indices),5123,'SCALAR',o.indices.length,34963),material:o.material}]};});
const inverses=new Float32Array(names.length*16);names.forEach((_,i)=>matrix(i).clone().invert().toArray(inverses,i*16));const inverseBindMatrices=accessor(inverses,5126,'MAT4',names.length);
const meshNodes=meshes.map((m,i)=>({name:m.name,mesh:i,skin:0})),rootNodes=[0,...meshNodes.map((_,i)=>nodes.length+i)];
const output={asset:{version:'2.0',generator:'TheArena original athlete construction'},scene:0,scenes:[{nodes:rootNodes}],nodes:[...nodes,...meshNodes],meshes,materials,skins:[{name:'Verified-canonical-26',joints:names.map((_,i)=>i),skeleton:0,inverseBindMatrices}],buffers:[{byteLength:length}],bufferViews,accessors};
const jsonBytes=Buffer.from(JSON.stringify(output)),jsonPad=Buffer.alloc((4-jsonBytes.length%4)%4,32),binary=Buffer.concat(chunks),binaryPad=Buffer.alloc((4-binary.length%4)%4),glb=Buffer.alloc(28+jsonBytes.length+jsonPad.length+binary.length+binaryPad.length);
glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(jsonBytes.length+jsonPad.length,12);glb.writeUInt32LE(0x4e4f534a,16);jsonBytes.copy(glb,20);jsonPad.copy(glb,20+jsonBytes.length);const offset=20+jsonBytes.length+jsonPad.length;glb.writeUInt32LE(binary.length+binaryPad.length,offset);glb.writeUInt32LE(0x004e4942,offset+4);binary.copy(glb,offset+8);
fs.mkdirSync('art/player-rebuild',{recursive:true});fs.writeFileSync('art/player-rebuild/athlete-blockout.glb',glb);
fs.writeFileSync('art/player-rebuild/model-status.json',JSON.stringify({stage:'original-deformation-blockout',finished:false,sourceGeometryReused:false,sourceTexturesReused:false,rig:'canonical-26',triangles:parts.reduce((n,p)=>n+p.indices.length/3,0),sha256:crypto.createHash('sha256').update(glb).digest('hex'),pending:['visual proportion review','joined deformation topology refinement','painted texture atlas','final model approval']},null,2));
console.log(fs.readFileSync('art/player-rebuild/model-status.json','utf8'));
