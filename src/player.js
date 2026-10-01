import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlayer as createProceduralPlayer } from './player-procedural.js';
import { createPoseAdapter } from './player-pose.js';
import { validateHybridAnimation } from './player-hybrid.js';

// Explicit review link; the ordinary game keeps its accepted player.
const previewLuke = new URLSearchParams(globalThis.location?.search || '').get('player') === 'luke';
const MODEL_URL = import.meta.env.BASE_URL + 'assets/models/player/' +
  (previewLuke ? 'luke-player-preview-v1.glb' : 'fictional-player-v2.glb');
const ANIMATION_URL = import.meta.env.BASE_URL + 'assets/models/player/forward-dribble-v1.glb';
const ANIMATION_MODE = new URLSearchParams(globalThis.location?.search || '').get('animation') === 'hybrid' ? 'hybrid' : 'procedural';
const REQUIRED_BONES = ['root', 'pelvis', 'chest', 'neck', 'head', ...['left', 'right'].flatMap(side =>
  ['upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot'].map(part => `${side}_${part}`))];

// Stable gameplay root and attachments survive asynchronous visual replacement.
export function createPlayer(THREE, {
  modelUrl = MODEL_URL, loadModel = true, animationMode = ANIMATION_MODE, animationUrl = ANIMATION_URL,
} = {}) {
  const fallback = createProceduralPlayer(THREE);
  const group = fallback.group;
  const anchors = {};
  for (const name of ['rightHand', 'leftHand', 'chest', 'head']) {
    anchors[name] = new THREE.Object3D();
    anchors[name].name = `player-${name}-attachment`;
    group.add(anchors[name]);
  }
  let rig = null;
  let animationBindBones = null;
  let lastState = {};
  const temp = new THREE.Vector3();
  const copyFallbackAnchors = () => {
    group.updateMatrixWorld(true);
    for (const name of Object.keys(anchors)) {
      fallback[name].getWorldPosition(temp);
      anchors[name].position.copy(group.worldToLocal(temp));
    }
  };
  const update = (dt = 1 / 60, state = {}) => {
    lastState = state;
    // Retain the existing facing damping and fully functional fallback.
    fallback.update(dt, state);
    if (rig) rig.update(dt, state);
    else copyFallbackAnchors();
  };
  group.userData.assetStatus = loadModel ? 'loading' : 'fallback';
  group.userData.assetReady = loadModel ? loadRig() : Promise.resolve('fallback');
  // The preview uses a different bind pose. Its established pose stays intact.
  const requestAnimation = animationMode === 'hybrid' && !previewLuke && loadModel;
  group.userData.animationStatus = requestAnimation ? 'loading' : 'procedural';
  group.userData.animationReady = requestAnimation ? loadAnimation() : Promise.resolve('procedural');
  async function loadAnimation() {
    try {
      if (await group.userData.assetReady !== 'ready') throw new Error('Player rig unavailable');
      const response = await fetch(animationUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer(), header = new DataView(data);
      if (data.byteLength > 65536 || data.byteLength < 28 || header.getUint32(0, true) !== 0x46546c67 ||
          header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== data.byteLength ||
          header.getUint32(16, true) !== 0x4e4f534a) throw new Error('Invalid or oversized animation GLB');
      const jsonLength = header.getUint32(12, true);
      if (jsonLength > data.byteLength - 20) throw new Error('Invalid animation JSON length');
      const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLength)));
      const metadata = validateHybridAnimation(doc, animationBindBones);
      const gltf = await new GLTFLoader().parseAsync(data, '');
      rig.setHybridAnimation(gltf.animations[0], metadata);
      group.userData.animationAsset = { bytes: data.byteLength, duration: gltf.animations[0].duration,
        tracks: gltf.animations[0].tracks.length, strideDistance: metadata.strideDistance };
      group.userData.animationStatus = 'ready';
      return 'ready';
    } catch (error) {
      group.userData.animationStatus = 'fallback';
      console.warn('Dribble animation unavailable; retaining procedural pose.', error);
      return 'fallback';
    }
  }
  async function loadRig() {
    let visual;
    try {
      const response = await fetch(modelUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (data.byteLength > 800000) throw new Error('Player GLB exceeds 800 KB');
      const gltf = await new GLTFLoader().parseAsync(data, '');
      visual = gltf.scene;
      const bones = new Map(), meshes = [], materials = new Set(), textures = new Set();
      let triangles = 0;
      visual.traverse(node => {
        if (node.isBone) bones.set(node.name, node);
        if (!node.isMesh) return;
        if (!node.isSkinnedMesh) throw new Error('Player geometry must be skinned');
        meshes.push(node);
        const geometry = node.geometry;
        triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
        if (!geometry.attributes.skinIndex || !geometry.attributes.skinWeight) throw new Error('Missing skin');
        const skin = geometry.attributes.skinWeight;
        for (let i = 0; i < skin.count; i++) {
          const w = [skin.getX(i), skin.getY(i), skin.getZ(i), skin.getW(i)];
          if (w.some(v => !Number.isFinite(v) || v < 0) || Math.abs(w.reduce((a, b) => a + b, 0) - 1) > .001)
            throw new Error('Invalid skin weights');
        }
        for (const material of [node.material].flat()) {
          materials.add(material);
          if (material.map) {
            textures.add(material.map);
            if (material.map.image.width > 512 || material.map.image.height > 512) throw new Error('Atlas exceeds 512px');
            material.map.magFilter = THREE.NearestFilter;
            material.map.colorSpace = THREE.SRGBColorSpace;
          }
        }
        node.castShadow = true;
        node.receiveShadow = true;
        node.frustumCulled = false;
      });
      const bounds = new THREE.Box3().setFromObject(visual);
      const size = bounds.getSize(new THREE.Vector3());
      if (triangles > 6000 || triangles === 0 || materials.size > 2 || textures.size > 2 || gltf.animations.length ||
          meshes.length !== 1 || bones.size !== REQUIRED_BONES.length || REQUIRED_BONES.some(name => !bones.has(name)) ||
          Math.abs(bounds.min.y) > .005 || size.y < 1.9 || size.y > 2.2) throw new Error('Player contract validation failed');
      animationBindBones = new Map([...bones].map(([name, bone]) => [name, { position: bone.position.clone() }]));
      const candidate = createPoseAdapter(THREE, visual, bones, anchors);
      candidate.update(0, lastState);
      group.add(visual);
      rig = candidate;
      fallback.group.getObjectByName('player-visual').traverse(node => {
        if (node.isMesh && node.name !== 'player-contact-shadow') node.visible = false;
      });
      group.userData.assetStatus = 'ready';
      group.userData.playerAsset = { triangles, materials: materials.size, bones: bones.size, bytes: data.byteLength };
      return 'ready';
    } catch (error) {
      if (visual) {
        const materials = new Set();
        visual.traverse(node => { if (node.isMesh) { node.geometry.dispose(); [node.material].flat().forEach(m => materials.add(m)); } });
        materials.forEach(m => { m.map?.dispose(); m.dispose(); });
      }
      group.userData.assetStatus = 'fallback';
      console.warn('Player asset unavailable; using procedural player.', error);
      return 'fallback';
    }
  }
  copyFallbackAnchors();
  return {
    group, ...anchors, update,
    updateDribbleContact(state) { rig?.updateDribbleContact(state); },
    getAnimationDiagnostics() {
      return { mode: requestAnimation ? 'hybrid' : 'procedural', status: group.userData.animationStatus,
        ...(rig?.getHybridDiagnostics() || { active: false, weight: 0 }) };
    },
    getRightHandWorldPosition(target = new THREE.Vector3()) { return anchors.rightHand.getWorldPosition(target); },
    getLeftHandWorldPosition(target = new THREE.Vector3()) { return anchors.leftHand.getWorldPosition(target); },
  };
}
export default createPlayer;
