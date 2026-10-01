import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlayerRoot } from './player-root.js';
import { createPoseAdapter } from './player-pose.js';
import { validateLukeRig } from './luke-rig-contract.js';

export const LUKE_MODEL_URL = (import.meta.env?.BASE_URL || '/') + 'assets/models/player/luke-player-v1.glb';
const requestedAnimation = new URLSearchParams(globalThis.location?.search || '').get('animation');

// Stable collision/facing root and attachment references are independent of
// Luke's asynchronous visual. The old GLB and old-rig clips have no load path.
export function createPlayer(THREE, {
  modelUrl = LUKE_MODEL_URL,
  animationMode = requestedAnimation === 'hybrid' ? 'hybrid' : 'procedural',
  fetchAsset = (...args) => fetch(...args),
  parseModel = data => new GLTFLoader().parseAsync(data, ''),
} = {}) {
  const root = createPlayerRoot(THREE), { group } = root;
  const anchors = {};
  for (const name of ['rightHand', 'leftHand', 'chest', 'head']) {
    anchors[name] = new THREE.Object3D();
    anchors[name].name = `player-${name}-attachment`;
    group.add(anchors[name]);
  }
  let rig = null, rigVisual = null, rigBones = null, lastState = {};
  const update = (dt = 1 / 60, state = {}) => {
    lastState = state;
    root.update(dt, state);
    rig?.update(dt, state);
  };
  group.userData.character = 'Luke';
  group.userData.assetStatus = 'loading';
  group.userData.animationStatus = animationMode === 'hybrid' ? 'superseded' : 'procedural';
  group.userData.animationReady = Promise.resolve(group.userData.animationStatus);
  group.userData.assetReady = loadRig();

  async function loadRig() {
    let visual;
    try {
      const response = await fetchAsset(modelUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (data.byteLength > 800000) throw new Error('Luke GLB exceeds 800 KB');
      const gltf = await parseModel(data);
      visual = gltf.scene;
      const bones = new Map(), meshes = [], materials = new Set(), textures = new Set();
      let triangles = 0;
      visual.traverse(node => {
        if (node.isBone) {
          if (bones.has(node.name)) throw new Error(`Duplicate Luke bone: ${node.name}`);
          bones.set(node.name, node);
        }
        if (!node.isMesh) return;
        if (!node.isSkinnedMesh) throw new Error('Luke geometry must be skinned');
        meshes.push(node);
        const geometry = node.geometry;
        triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
        const skin = geometry.attributes.skinWeight, indices = geometry.attributes.skinIndex;
        if (!skin || !indices || skin.count !== geometry.attributes.position.count || indices.count !== skin.count)
          throw new Error('Invalid Luke skin attributes');
        for (let i = 0; i < skin.count; i++) {
          const weights = [skin.getX(i), skin.getY(i), skin.getZ(i), skin.getW(i)];
          const joints = [indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)];
          if (weights.some(v => !Number.isFinite(v) || v < 0) ||
              Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > .001 ||
              joints.some(v => !Number.isInteger(v) || v < 0 || v >= node.skeleton.bones.length))
            throw new Error('Invalid Luke skin indices or normalized weights');
        }
        for (const material of [node.material].flat()) {
          materials.add(material);
          if (material.map) {
            textures.add(material.map);
            if (material.map.image.width !== 512 || material.map.image.height !== 512)
              throw new Error('Luke atlas must remain 512px');
            material.map.magFilter = THREE.NearestFilter;
            material.map.colorSpace = THREE.SRGBColorSpace;
          }
        }
        node.castShadow = true;
        node.receiveShadow = true;
        node.frustumCulled = false;
      });
      const bounds = new THREE.Box3().setFromObject(visual), size = bounds.getSize(new THREE.Vector3());
      if (triangles > 6000 || triangles === 0 || materials.size !== 1 || textures.size !== 1 ||
          gltf.animations.length || meshes.length !== 1 || Math.abs(bounds.min.y) > .005 || size.y < 1.9 || size.y > 2.2)
        throw new Error('Luke asset contract validation failed');
      validateLukeRig(THREE, visual, bones, meshes);
      const candidate = createPoseAdapter(THREE, visual, bones, anchors);
      candidate.update(0, lastState);
      group.add(visual);
      rig = candidate; rigVisual = visual; rigBones = bones;
      root.shadow.visible = true;
      group.userData.assetStatus = 'ready';
      group.userData.playerAsset = { character: 'Luke', url: modelUrl, triangles,
        materials: materials.size, bones: bones.size, bytes: data.byteLength };
      return 'ready';
    } catch (error) {
      if (visual) {
        const materials = new Set();
        visual.traverse(node => {
          if (node.isMesh) { node.geometry.dispose(); [node.material].flat().forEach(m => materials.add(m)); }
        });
        materials.forEach(m => { m.map?.dispose(); m.dispose(); });
      }
      group.userData.assetStatus = 'error';
      group.userData.assetError = 'Luke could not be loaded. Reload to try again.';
      console.error('Luke asset unavailable; play is blocked.', error);
      return 'error';
    }
  }

  return {
    group, ...anchors, update,
    resetPose() { rig?.reset(); },
    // The superseded hybrid palm writer has no authority over Luke.
    updateDribbleContact() {},
    getAnimationDiagnostics() {
      return { mode: 'procedural', status: group.userData.animationStatus, requestedMode: animationMode,
        active: false, weight: 0, ...(rig?.diagnostics() || {}),
        ...(animationMode === 'hybrid' ? { superseded: 'Old-rig dribble retired; Luke clips pending Part 2.' } : {}) };
    },
    getRigInspection() {
      return import.meta.env?.DEV ? { visual: rigVisual, bones: rigBones } : null;
    },
    getRightHandWorldPosition(target = new THREE.Vector3()) { return anchors.rightHand.getWorldPosition(target); },
    getLeftHandWorldPosition(target = new THREE.Vector3()) { return anchors.leftHand.getWorldPosition(target); },
  };
}
export default createPlayer;
