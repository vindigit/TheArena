import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlayerRoot } from './player-root.js';
import { createPolishedPoseAdapter as createPoseAdapter } from './polished-pose.js';
import {createHandShapeAdapter} from './hand-clearance.js';
import handShapes from '../art/animation/hand-shapes.json' with {type:'json'};
import { validateLukeRig } from './luke-rig-contract.js';

export const LUKE_MODEL_URL = (import.meta.env?.BASE_URL || '/') + 'assets/models/player/luke-player-v1.glb';
export const LEGACY_LUKE_RIG_CONTRACT = 'legacy-luke-v1';
export const STAGED_PLAYER_RIG_CONTRACT = 'game-humanoid-v2';
export const REQUIRED_BONES = Object.freeze([
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
]);
const REQUIRED_BONE_SET = new Set(REQUIRED_BONES);
const STAGED_LIMITS = Object.freeze({ maxBytes: 1_500_000, maxTriangles: 8_000, minHeight: 1.9, maxHeight: 2.2 });

export function normalizePlayerBoneName(name) {
  return name.startsWith('mixamorig:') ? name.slice('mixamorig:'.length) : name;
}

// This validates the versioned v2 contract without enabling it for production.
// Tests use the same function with small fixtures; the opt-in loader path below
// supplies measurements from an actual parsed GLB.
export function validateStagedPlayerRigContract({
  boneNames, bytes, triangles, height, meshCount, skinCount,
}) {
  if (bytes > STAGED_LIMITS.maxBytes) throw new Error('game-humanoid-v2 GLB exceeds 1.5 MB');
  if (triangles <= 0 || triangles > STAGED_LIMITS.maxTriangles)
    throw new Error('game-humanoid-v2 triangle count must be 1-8000');
  if (height < STAGED_LIMITS.minHeight || height > STAGED_LIMITS.maxHeight)
    throw new Error('game-humanoid-v2 height must be 1.9-2.2 m');
  if (meshCount !== 1) throw new Error('game-humanoid-v2 requires exactly one skinned mesh');
  if (skinCount !== 1) throw new Error('game-humanoid-v2 requires exactly one skin');
  const normalized = boneNames.map(normalizePlayerBoneName);
  if (new Set(normalized).size !== normalized.length)
    throw new Error('game-humanoid-v2 contains duplicate normalized bone names');
  for (const group of [
    ['three-spine chain', ['Spine', 'Spine1', 'Spine2']],
    ['shoulders', ['LeftShoulder', 'RightShoulder']],
    ['toe bases', ['LeftToeBase', 'RightToeBase']],
  ]) {
    const absent = group[1].filter(name => !normalized.includes(name));
    if (absent.length) throw new Error(`game-humanoid-v2 ${group[0]} missing: ${absent.join(', ')}`);
  }
  const missing = REQUIRED_BONES.filter(name => !normalized.includes(name));
  const extra = normalized.filter(name => !REQUIRED_BONE_SET.has(name));
  if (missing.length || extra.length) {
    throw new Error(`game-humanoid-v2 requires exactly 22 bones; missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`);
  }
  return { contract: STAGED_PLAYER_RIG_CONTRACT, bones: normalized, ...STAGED_LIMITS };
}
const requestedAnimation = new URLSearchParams(globalThis.location?.search || '').get('animation');

// Stable collision/facing root and attachment references are independent of
// Luke's asynchronous visual. The old GLB and old-rig clips have no load path.
export function createPlayer(THREE, {
  modelUrl = LUKE_MODEL_URL,
  rigContract = LEGACY_LUKE_RIG_CONTRACT,
  animationMode = requestedAnimation === 'hybrid' ? 'hybrid' : 'luke-motion',
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
  let rig = null, rigVisual = null, rigBones = null, lastState = {}, handShapesAdapter = null, handWeights = [0,0,0,0], handDiagnostics = null;
  const update = (dt = 1 / 60, state = {}) => {
    lastState = state;
    root.update(dt, state);
    rig?.update(dt, state);
  };
  group.userData.character = 'Luke';
  group.userData.rigContract = rigContract;
  group.userData.assetStatus = 'loading';
  group.userData.animationStatus = animationMode === 'hybrid' ? 'superseded' : 'luke-motion';
  group.userData.animationReady = Promise.resolve(group.userData.animationStatus);
  group.userData.assetReady = loadRig();

  async function loadRig() {
    let visual;
    try {
      const response = await fetchAsset(modelUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (data.byteLength > STAGED_LIMITS.maxBytes) throw new Error('Player GLB exceeds 1.5 MB');
      const gltf = await parseModel(data);
      visual = gltf.scene;
      const bones = new Map(), meshes = [], skins = new Set(), materials = new Set(), textures = new Set();
      let triangles = 0;
      visual.traverse(node => {
        if (node.isBone) {
          if (bones.has(node.name)) throw new Error(`Duplicate Luke bone: ${node.name}`);
          bones.set(node.name, node);
        }
        if (!node.isMesh) return;
        if (!node.isSkinnedMesh) throw new Error('Luke geometry must be skinned');
        meshes.push(node);
        skins.add(node.skeleton);
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
      if (materials.size !== 1 || textures.size !== 1 || gltf.animations.length || Math.abs(bounds.min.y) > .005)
        throw new Error('Player GLB requires one material/texture, no embedded clips, and floor-aligned bounds');
      let runtimeBones = bones;
      if (rigContract === STAGED_PLAYER_RIG_CONTRACT) {
        validateStagedPlayerRigContract({ boneNames: [...bones.keys()], bytes: data.byteLength, triangles,
          height: size.y, meshCount: meshes.length, skinCount: skins.size });
        runtimeBones = new Map();
        for (const [name, bone] of bones) {
          const normalized = normalizePlayerBoneName(name);
          bone.name = normalized;
          runtimeBones.set(normalized, bone);
        }
      } else if (rigContract === LEGACY_LUKE_RIG_CONTRACT) {
        if (triangles > 8000 || triangles === 0 || meshes.length !== 1 || skins.size !== 1 || size.y < 1.9 || size.y > 2.2)
          throw new Error('legacy-luke-v1 requires one mesh/skin, 1-8000 triangles, and 1.9-2.2 m height');
        validateLukeRig(THREE, visual, bones, meshes);
      } else {
        throw new Error(`Unknown player rig contract: ${rigContract}`);
      }
      handShapesAdapter=createHandShapeAdapter(THREE,meshes[0],handShapes);
      handShapesAdapter.installMorphs();
      // Polished plants/contact use the authoritative root during the first pose.
      group.add(visual);
      const candidate = rigContract === LEGACY_LUKE_RIG_CONTRACT
        ? createPoseAdapter(THREE, visual, runtimeBones, anchors) : null;
      candidate?.update(0, lastState);
      rig = candidate; rigVisual = visual; rigBones = runtimeBones;
      root.shadow.visible = true;
      group.userData.assetStatus = 'ready';
      group.userData.playerAsset = { character: 'Luke', url: modelUrl, rigContract, triangles,
        materials: materials.size, bones: runtimeBones.size, bytes: data.byteLength };
      return 'ready';
    } catch (error) {
      if (visual) {
        visual.removeFromParent();
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
    resetPose() { rig?.reset(); handWeights.fill(0); handShapesAdapter?.applyWeights(handWeights); },
    updateHandShapes(dt, ballWorld, ballMode) {
      if (!handShapesAdapter) return;
      rig?.resolveBallClearance?.(dt,ballWorld,.12);
      const diag=rig?.diagnostics(), clip=diag?.clip;
      const desired=clip==='gather'||(clip==='shoot'&&ballMode==='gather')?[.7,0,.65,0]
        : clip==='shoot'?[0,.8,0,0]
          : ballMode==='dribble'&&diag?.contact?.right?.required?[.6,0,0,0]:[0,0,0,0];
      const a=1-Math.exp(-24*Math.max(0,dt));
      handWeights=handWeights.map((v,i)=>v+(desired[i]-v)*a);
      handDiagnostics=handShapesAdapter.limitWeights(handWeights,ballWorld,.12);
      handShapesAdapter.applyWeights(handDiagnostics.applied);
      rig?.recordDisplayedHandClearance?.(ballWorld,.12);
    },
    // The superseded hybrid palm writer has no authority over Luke.
    updateDribbleContact() {},
    getAnimationDiagnostics() {
      return { mode: 'luke-authored-parametric', status: group.userData.animationStatus, requestedMode: animationMode,
        active: false, weight: 0, ...(rig?.diagnostics() || {}), handShapes:handDiagnostics,
        ...(animationMode === 'hybrid' ? { superseded: 'Old-rig dribble retired; Part 2 uses only Luke-authored motion.' } : {}) };
    },
    getRigInspection() {
      return import.meta.env?.DEV ? { visual: rigVisual, bones: rigBones } : null;
    },
    getRightHandWorldPosition(target = new THREE.Vector3()) { return anchors.rightHand.getWorldPosition(target); },
    getLeftHandWorldPosition(target = new THREE.Vector3()) { return anchors.leftHand.getWorldPosition(target); },
    getHeldBallWorldPosition(target = new THREE.Vector3()) {
      const local = rig?.getHeldBallLocal?.();
      return local ? group.localToWorld(target.copy(local)) : anchors.rightHand.getWorldPosition(target);
    },
  };
}
export default createPlayer;
