// Original skinned player, locally authored from the Scenario concept recorded
// in the manifest. No source image pixels or third-party mesh are embedded.
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import * as THREE from 'three';

const out = process.argv[2] || '.tmp/player/fictional-player-v1.glb';
const bones = [];
function bone(name, parent, position) {
  const index = bones.length;
  bones.push({ name, parent, position });
  return index;
}
const root = bone('root', null, [0, 0, 0]);
const pelvis = bone('pelvis', root, [0, 1.03, 0]);
const chest = bone('chest', pelvis, [0, 1.47, 0]);
const neck = bone('neck', chest, [0, 1.76, 0]);
const head = bone('head', neck, [0, 1.88, 0]);
const limbs = {};
for (const side of [-1, 1]) {
  const name = side === 1 ? 'right' : 'left';
  limbs[name] = {
    shoulder: bone(`${name}_upper_arm`, chest, [side * .335, 1.66, 0]),
    elbow: bone(`${name}_forearm`, null, [side * .445, 1.31, 0]),
    wrist: bone(`${name}_hand`, null, [side * .51, .97, -.005]),
    hip: bone(`${name}_thigh`, pelvis, [side * .17, 1.03, 0]),
    knee: bone(`${name}_shin`, null, [side * .19, .55, 0]),
    foot: bone(`${name}_foot`, null, [side * .19, .145, 0]),
  };
  const l = limbs[name];
  bones[l.elbow].parent = l.shoulder;
  bones[l.wrist].parent = l.elbow;
  bones[l.knee].parent = l.hip;
  bones[l.foot].parent = l.knee;
}
const tiles = {skin:0, jersey:1, purple:2, gold:3, hair:4, shoe:5, sole:6, white:7, eye:8, lip:9, front:10, back:11, sock:12, skinDark:13};
const colors = ['#986747','#e5decb','#443b6c','#b7964f','#201c1c','#292f3b','#cfc5ae','#d3c9ad','#272326','#694530','#e5decb','#e5decb','#d9d3c1','#845539'];
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="shade" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".1"/><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient></defs>';
for(let t=0;t<16;t++) {
  const x=t%4*128,y=Math.floor(t/4)*128;
  svg += `<g transform="translate(${x},${y})"><rect width="128" height="128" fill="${colors[t]||colors[0]}"/><rect width="128" height="128" fill="url(#shade)"/>`;
  for(let j=5;j<124;j+=5) for(let i=5;i<124;i+=5) svg += `<rect x="${i}" y="${j}" width="1" height="${[1,10,11,12].includes(t)?2:1}" fill="#000" opacity=".045"/>`;
  if(t===10 || t===11) svg += `<path d="M18 13 L40 13 L34 20 L18 20 Z" fill="#443b6c"/><text x="64" y="${t===10?89:96}" font-family="sans-serif" font-size="${t===10?51:76}" font-weight="900" text-anchor="middle" fill="#443b6c">27</text>`;
  if(t===5) svg += '<path d="M15 105 Q65 55 114 88" stroke="#7b8090" stroke-width="7" fill="none"/><path d="M18 111 Q65 64 110 93" stroke="#171b26" stroke-width="3" fill="none"/>';
  if(t===12) for(let i=8;i<128;i+=6) svg += `<path d="M${i} 4V124" stroke="#fff" opacity=".1"/>`;
  svg+='</g>';
}
svg+='</svg>';
const atlas = await sharp(Buffer.from(svg)).png({palette:true,colours:128,dither:0}).toBuffer();
const positions=[],normals=[],uvs=[],joints=[],weights=[],indices=[];
function emit(points, tile, skin, coords) {
  const a=new THREE.Vector3(...points[0]),b=new THREE.Vector3(...points[1]),c=new THREE.Vector3(...points[2]);
  const n=b.sub(a).cross(c.sub(a)).normalize();
  if(n.lengthSq()<.1) throw new Error('Degenerate face');
  const base=positions.length/3;
  points.forEach((p,i)=>{
    positions.push(...p); normals.push(...n.toArray());
    const uv=coords?.[i]||[[0,0],[1,0],[1,1],[0,1]][i];
    uvs.push((tile%4+.055+uv[0]*.89)/4,(Math.floor(tile/4)+.055+uv[1]*.89)/4);
    const w=typeof skin==='function'?skin(p):[[skin,1]];
    const sum=w.reduce((v,pair)=>v+pair[1],0);
    for(let k=0;k<4;k++){joints.push(w[k]?.[1]>0?w[k][0]:0);weights.push((w[k]?.[1]||0)/sum);}
  });
  indices.push(base,base+1,base+2);
  if(points.length===4)indices.push(base,base+2,base+3);
}
// Horizontal elliptical rings, ordered bottom to top. Facet normals preserve
// broad PS2-style planes; extra rings at elbows/knees support smooth skinning.
function rings(rows, segments, tile, skin, caps=true) {
  const point=(r,i)=>{const a=i/segments*Math.PI*2;return [r[0]+Math.cos(a)*r[3],r[1],r[2]+Math.sin(a)*r[4]];};
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<segments;i++) {
    const t=typeof tile==='function'?tile(i,j):tile;
    emit([point(rows[j],i),point(rows[j+1],i),point(rows[j+1],i+1),point(rows[j],i+1)],t,skin,
      [[i/segments,1-j/(rows.length-1)],[i/segments,1-(j+1)/(rows.length-1)],[(i+1)/segments,1-(j+1)/(rows.length-1)],[(i+1)/segments,1-j/(rows.length-1)]]);
  }
  if(caps)for(let i=0;i<segments;i++) {
    emit([rows[0].slice(0,3),point(rows[0],i),point(rows[0],i+1)],typeof tile==='function'?tile(i,0):tile,skin);
    const last=rows.at(-1);
    emit([last.slice(0,3),point(last,i+1),point(last,i)],typeof tile==='function'?tile(i,rows.length-2):tile,skin);
  }
}
function ellipsoid(center, size, tile, skin, segments=10, levels=6) {
  const rows=[];
  for(let j=0;j<=levels;j++){const a=.04+(Math.PI-.08)*j/levels; rows.push([center[0],center[1]-Math.cos(a)*size[1],center[2],Math.sin(a)*size[0],Math.sin(a)*size[2]]);}
  rings(rows,segments,tile,skin);
}
const smooth=(x)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
function blend(a,b,y,width){return p=>{const w=smooth((p[1]-y+width)/(2*width));return [[a,w],[b,1-w]];};}
const torsoSkin=blend(chest,pelvis,1.23,.19);
rings([[0,1.04,0,.255,.165],[0,1.10,0,.275,.18],[0,1.30,0,.25,.17],[0,1.49,0,.295,.183],[0,1.66,0,.31,.165],[0,1.70,0,.26,.14]],16,(i,j)=>((i===0||i===7||i===8||i===15)?tiles.purple:tiles.jersey),torsoSkin);
rings([[0,1.047,0,.277,.183],[0,1.067,0,.278,.183]],16,tiles.gold,torsoSkin);
// Neckline: shoulders slope into a real opening around the neck.
rings([[0,1.70,0,.26,.14],[0,1.72,0,.112,.1]],16,tiles.jersey,chest,false);
rings([[0,1.714,0,.117,.103],[0,1.727,0,.112,.1]],16,tiles.purple,chest,false);
rings([[0,1.69,0,.095,.092],[0,1.82,0,.085,.085]],12,tiles.skin,neck);
// Conform the original number islands to the polygonal jersey, including its
// skin weights, so printed cloth never floats or z-fights through the torso.
for(const s of [-1,1])for(let j=0;j<4;j++)for(let i=0;i<6;i++){
  const point=(u,v)=>{
    const x=(u-.5)*.34,y=1.30+v*.32;
    const t=y<=1.49?(y-1.30)/.19:(y-1.49)/.17;
    const rx=y<=1.49?.25+t*.045:.295+t*.015,rz=y<=1.49?.17+t*.013:.183-t*.018;
    // Linear interpolation along the 16-sided cross-section.
    const a=Math.acos(x/rx),k=Math.floor(a/(Math.PI/8)),a0=k*Math.PI/8,a1=(k+1)*Math.PI/8;
    const mix=(x-rx*Math.cos(a0))/(rx*Math.cos(a1)-rx*Math.cos(a0));
    const z=rz*(Math.sin(a0)+(Math.sin(a1)-Math.sin(a0))*mix)+.0015;
    return [x,y,s*z];
  };
  const u=i/6,v=j/4,un=(i+1)/6,vn=(j+1)/4;
  const coords=s===-1?[[u,v],[u,vn],[un,vn],[un,v]]:[[un,v],[un,vn],[u,vn],[u,v]];
  emit(coords.map(([a,b])=>point(a,b)),s===-1?tiles.front:tiles.back,torsoSkin,coords.map(([a,b])=>[s===-1?1-a:a,1-b]));
}
rings([[0,.993,0,.294,.181],[0,1.059,0,.278,.183]],16,tiles.purple,pelvis);
// Angular jaw, temples and cranium; distinct eyelids, brow, nose and ears.
rings([[0,1.77,-.013,.064,.065],[0,1.80,-.025,.095,.082],[0,1.88,0,.125,.111],[0,1.97,.007,.123,.113],[0,2.035,.013,.105,.10],[0,2.062,.015,.065,.066]],12,tiles.skin,head);
rings([[0,1.989,.01,.124,.112],[0,2.043,.013,.108,.103],[0,2.069,.015,.062,.06]],12,tiles.hair,head);
for(const s of [-1,1]) {
  ellipsoid([s*.124,1.917,.006],[.028,.047,.029],tiles.skin,head,8,4);
  ellipsoid([s*.128,1.916,-.009],[.014,.026,.013],tiles.skinDark,head,6,3);
  ellipsoid([s*.047,1.935,-.099],[.032,.021,.015],tiles.skinDark,head,8,3);
  ellipsoid([s*.047,1.935,-.112],[.022,.009,.008],tiles.white,head,8,3);
  ellipsoid([s*.045,1.936,-.119],[.008,.008,.004],tiles.eye,head,8,3);
  ellipsoid([s*.047,1.958,-.106],[.037,.009,.011],tiles.hair,head,8,3);
}
emit([[-.018,1.952,-.107],[-.025,1.898,-.135],[0,1.887,-.151],[.025,1.898,-.135]],tiles.skin,head);
emit([[-.018,1.952,-.107],[0,1.887,-.151],[.018,1.952,-.107]],tiles.skin,head);
ellipsoid([0,1.864,-.107],[.039,.007,.012],tiles.lip,head,10,3);
ellipsoid([0,1.846,-.099],[.048,.014,.014],tiles.skin,head,10,3);
for(const s of [-1,1]){
  const l=limbs[s===1?'right':'left'];
  const armSkin=p=>{
    if(p[1]<1.10)return blend(l.elbow,l.wrist,1.01,.055)(p);
    return blend(l.shoulder,l.elbow,1.31,.075)(p);
  };
  rings([[s*.51,.97,-.005,.062,.063],[s*.5,1.06,0,.071,.07],[s*.48,1.17,0,.09,.083],[s*.451,1.27,0,.082,.082],[s*.445,1.31,0,.078,.081],[s*.431,1.36,0,.09,.089],[s*.395,1.49,0,.111,.107],[s*.35,1.61,0,.124,.12],[s*.335,1.69,0,.11,.11],[s*.327,1.727,0,.065,.075]],12,tiles.skin,armSkin);
  // Palm and four fingers with a separate opposable thumb, all attached to
  // the hand bone. Finger articulation is unnecessary for these five actions.
  rings([[s*.512,.818,-.016,.073,.028],[s*.514,.86,-.011,.078,.039],[s*.512,.925,-.006,.069,.041],[s*.51,.975,-.005,.059,.055]],10,tiles.skin,l.wrist);
  for(let f=0;f<4;f++){
    const x=s*(.459+f*.035),end=.75+Math.abs(f-1.3)*.017;
    rings([[x,end,-.034,.012,.016],[x,end+.028,-.02,.015,.018],[x,.824,-.013,.017,.02],[x,.852,-.01,.016,.02]],6,tiles.skin,l.wrist);
  }
  ellipsoid([s*.44,.865,-.025],[.025,.064,.026],tiles.skin,l.wrist,8,4);
  // Shorts follow the pelvis at the waistband and each thigh below the crotch.
  const legSkin=p=>p[1]>.82?blend(pelvis,l.hip,.97,.12)(p):[[l.hip,1]];
  rings([[s*.174,.59,0,.194,.19],[s*.174,.63,0,.198,.19],[s*.167,.81,0,.193,.192],[s*.139,1.02,0,.157,.172]],12,(i,j)=> j===0?tiles.purple:((s===1?(i===0||i===11):(i===5||i===6))?tiles.purple:tiles.jersey),legSkin);
  rings([[s*.174,.618,0,.201,.193],[s*.174,.628,0,.201,.193]],12,tiles.gold,l.hip,false);
  rings([[s*.19,.16,0,.067,.072],[s*.19,.31,.008,.082,.084],[s*.19,.43,.015,.099,.102],[s*.19,.51,0,.09,.097],[s*.19,.55,-.005,.093,.098],[s*.185,.59,0,.106,.103],[s*.18,.69,0,.122,.115]],12,tiles.skin,blend(l.hip,l.knee,.55,.065));
  rings([[s*.19,.135,0,.072,.08],[s*.19,.29,0,.077,.085]],12,tiles.sock,l.knee);
  // Shoe silhouette: broad toe box, angular heel, padded high top and sole.
  rings([[s*.19,.038,-.079,.116,.206],[s*.19,.076,-.084,.12,.211],[s*.19,.125,-.078,.118,.199],[s*.19,.174,-.041,.102,.148],[s*.19,.222,.008,.083,.094]],12,tiles.shoe,l.foot);
  rings([[s*.19,0,-.079,.113,.202],[s*.19,.017,-.079,.124,.212],[s*.19,.047,-.079,.123,.212]],12,tiles.sole,l.foot);
  for(let i=0;i<4;i++) {
    const y=.156+i*.019,z=-.228+i*.036;
    emit([[s*.19-.063,y,z],[s*.19-.063,y+.008,z],[s*.19+.063,y+.008,z],[s*.19+.063,y,z]],tiles.sole,l.foot);
  }
}
const doc={asset:{version:'2.0',generator:'TheArena original player authoring script'},scene:0,scenes:[{nodes:[0, bones.length]}],nodes:[],meshes:[],materials:[{name:'fictional_cream_purple_27',pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:.88}}],textures:[{source:0,sampler:0}],samplers:[{magFilter:9728,minFilter:9987,wrapS:33071,wrapT:33071}],images:[],skins:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}]};
const chunks=[];let offset=0;
function bytes(data,target){const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}const i=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length,...(target?{target}: {})});chunks.push(data);offset+=data.length;return i;}
function accessor(array,componentType,type,width,target){const ctor=componentType===5126?Float32Array:Uint16Array;const buffer=Buffer.from(new ctor(array).buffer);const entry={bufferView:bytes(buffer,target),componentType,count:array.length/width,type};if(type==='VEC3'){entry.min=[0,1,2].map(k=>Math.min(...array.filter((_,i)=>i%3===k)));entry.max=[0,1,2].map(k=>Math.max(...array.filter((_,i)=>i%3===k)));}doc.accessors.push(entry);return doc.accessors.length-1;}
doc.nodes=bones.map((b,i)=>({name:b.name,translation:b.position.map((v,k)=>v-(b.parent===null?0:bones[b.parent].position[k])),children:bones.map((c,j)=>c.parent===i?j:null).filter(v=>v!==null)}));
doc.nodes.forEach(node=>{if(!node.children.length)delete node.children;});
const inverse=bones.flatMap(b=>new THREE.Matrix4().makeTranslation(...b.position.map(v=>-v)).elements);
doc.skins.push({name:'basketball_rig',skeleton:0,joints:bones.map((_,i)=>i),inverseBindMatrices:accessor(inverse,5126,'MAT4',16)});
doc.meshes.push({name:'fictional_player',primitives:[{attributes:{POSITION:accessor(positions,5126,'VEC3',3,34962),NORMAL:accessor(normals,5126,'VEC3',3,34962),TEXCOORD_0:accessor(uvs,5126,'VEC2',2,34962),JOINTS_0:accessor(joints,5123,'VEC4',4,34962),WEIGHTS_0:accessor(weights,5126,'VEC4',4,34962)},indices:accessor(indices,5123,'SCALAR',1,34963),material:0,mode:4}]});
doc.nodes.push({name:'player_skinned_mesh',mesh:0,skin:0});
doc.images.push({name:'player_atlas_512',bufferView:bytes(atlas),mimeType:'image/png'});
doc.buffers[0].byteLength=offset;
const rawJson=Buffer.from(JSON.stringify(doc));const json=Buffer.concat([rawJson,Buffer.alloc((4-rawJson.length%4)%4,32)]);
const binary=Buffer.concat([...chunks,Buffer.alloc((4-offset%4)%4)]);
const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length);binHeader.write('BIN\0',4);
const glb=Buffer.concat([header,json,binHeader,binary]);
if(indices.length/3>6000||glb.length>800000)throw new Error('Player exceeds budget');
await mkdir(new URL('../.tmp/player/',import.meta.url),{recursive:true});
await writeFile(out,glb);
await writeFile('.tmp/player/atlas.png',atlas);
await writeFile('.tmp/player/rig.json',JSON.stringify({bones,limbs},null,2));
console.log(JSON.stringify({path:out,bytes:glb.length,triangles:indices.length/3,vertices:positions.length/3,bones:bones.length,materials:1,atlasBytes:atlas.length,atlasDimensions:[512,512],maxInfluences:2}));
