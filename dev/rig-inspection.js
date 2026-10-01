import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPoseAdapter } from '../src/player-pose.js';
import { captureRest, resetRest, applyStressPose } from './rig-poses.js';
if (!import.meta.env.DEV) throw new Error('Rig inspection is development only');
const renderer = new THREE.WebGLRenderer({canvas:document.querySelector('#rig'),antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene = new THREE.Scene();scene.background=new THREE.Color(0xe4e9ed);
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.05,30);
scene.add(new THREE.HemisphereLight(0xffffff,0x7a8591,2.1));
const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(-3,5,-4);scene.add(light);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshStandardMaterial({color:0xc5ced5,roughness:1}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.006;scene.add(floor);
scene.add(new THREE.GridHelper(8,32,0x5c7183,0x9eacb7));
const root=new THREE.Group();scene.add(root);
const gltf=await new GLTFLoader().loadAsync('/assets/models/player/luke-player-v1.glb');
const visual=gltf.scene;root.add(visual);
visual.traverse(n=>{if(n.isMesh){n.frustumCulled=false;if(n.material.map)n.material.map.magFilter=THREE.NearestFilter;}});
const bones=new Map();visual.traverse(n=>{if(n.isBone)bones.set(n.name,n);});
const rest=captureRest(bones);
const anchors=Object.fromEntries(['rightHand','leftHand','chest','head'].map(name=>{const a=new THREE.Object3D();root.add(a);return[name,a];}));
let adapter=createPoseAdapter(THREE,visual,bones,anchors);
const skeleton=new THREE.SkeletonHelper(visual);skeleton.material.depthTest=false;skeleton.material.transparent=true;skeleton.material.opacity=.8;scene.add(skeleton);
const joints=new THREE.Group();scene.add(joints);
const markers=new Map([...bones].map(([name,b])=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.018,10,8),new THREE.MeshBasicMaterial({color:name.includes('shin')?0xde3535:name.includes('foot')?0x246ad0:0xc78612,depthTest:false}));m.renderOrder=10;joints.add(m);return[name,m];}));
const ball=new THREE.Mesh(new THREE.SphereGeometry(.12,16,12),new THREE.MeshStandardMaterial({color:0xbd642c,roughness:.9}));scene.add(ball);
let pose='neutral',writer='isolated',view='front',frame=0,playing=false;
function setView(value){view=value;camera.position.set(...(value==='side'?[4.8,1.8,0]:value==='front'?[0,1.7,-5.2]:[3.8,2,-4.3]));camera.lookAt(0,1.03,0);render();}
function drawPose(name=pose,mode=writer) {
  pose=name;writer=mode;document.querySelector('#pose').value=name;document.querySelector('#writer').value=mode;
  resetRest(bones,rest);adapter=createPoseAdapter(THREE,visual,bones,anchors);
  if(mode==='adapter'||name==='ball hold')adapter.update(0,{action:name==='ball hold'?'shoot':'idle',shotProgress:.29,speed:0,ballMode:name==='ball hold'?'gather':'dribble',dribblePhase:0});
  applyStressPose(THREE,visual,bones,rest,name);
  ball.visible=name==='ball hold';if(ball.visible)ball.position.copy(anchors.rightHand.getWorldPosition(new THREE.Vector3()));
  playing=['move → gather','loose → pickup'].includes(name);frame=0;
  render();return snapshot();
}
function snapshot(){visual.updateWorldMatrix(true,true);return {pose,writer,view,frame,diagnostics:adapter.diagnostics(),bones:Object.fromEntries([...bones].map(([n,b])=>[n,{p:b.position.toArray(),q:b.quaternion.toArray(),world:b.getWorldPosition(new THREE.Vector3()).toArray()}])),anchors:Object.fromEntries(Object.entries(anchors).map(([n,a])=>[n,a.getWorldPosition(new THREE.Vector3()).toArray()]))};}
function render(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  for(const[n,m]of markers)m.position.copy(bones.get(n).getWorldPosition(new THREE.Vector3()));
  skeleton.visible=joints.visible=document.querySelector('#overlay').checked;
  renderer.render(scene,camera);
  const s=snapshot();document.querySelector('#diagnostics').textContent=JSON.stringify({owner:playing?'procedural transition':writer==='adapter'?'adapter base; stress joints applied last':'isolated fixed pose; animation disabled',footCorrection:false,hybridWeight:0,ankles:[s.bones.left_foot.world,s.bones.right_foot.world],...s.diagnostics},null,2);
}
function step(){const gather=pose==='move → gather'&&frame%180>=90;
  adapter.update(1/60,{action:gather?'shoot':'move',shotProgress:gather?Math.min(.58,(frame%180-90)/90*.58):0,speed:gather?0:3.38,ballMode:gather?'gather':pose==='loose → pickup'&&frame%180<90?'loose':'dribble',dribblePhase:frame*.16});
  ball.visible=gather;if(gather)ball.position.copy(anchors.rightHand.getWorldPosition(new THREE.Vector3()));frame++;render();}
document.querySelector('#pose').onchange=e=>drawPose(e.target.value,writer);
document.querySelector('#writer').onchange=e=>drawPose(pose,e.target.value);
document.querySelector('#overlay').onchange=render;
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
addEventListener('resize',render);
document.querySelector('#status').textContent='Canonical Luke loaded · 17 joints · no hybrid or foot correction';
window.lukeRigInspection={drawPose,setView,snapshot,step,stop:()=>playing=false,overlay:value=>{document.querySelector('#overlay').checked=value;render();}};
setView('front');drawPose();renderer.setAnimationLoop(()=>{if(playing)step();});
