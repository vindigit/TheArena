import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlayerRoot } from './player-root.js';
import { createPolishedPoseAdapter as createPoseAdapter } from './polished-pose.js';
import {createHandShapeAdapter} from './hand-clearance.js';
import handShapes from '../art/animation/hand-shapes.json' with {type:'json'};
import { validateLukeRig } from './luke-rig-contract.js';
import { LOOK } from './look.js';

export const LUKE_MODEL_URL = (import.meta.env?.BASE_URL || '/') + 'assets/models/player/luke-player-v1.glb';
export const LUKE_KIT_TEXTURE_URL = (import.meta.env?.BASE_URL || '/') + 'assets/textures/player/luke-kit-green-v1.jpg';
const requestedAnimation = new URLSearchParams(globalThis.location?.search || '').get('animation');

// Repaint of the same UV atlas (scripts/build-luke-kit-texture.mjs). Only the
// colour image is swapped; mesh, UVs, skin and material settings are untouched.
// A missing repaint keeps the embedded uniform rather than blocking play.
function loadKitTexture(THREE, url) {
  return new THREE.TextureLoader().loadAsync(url).then(texture => {
    texture.flipY = false;
    return texture;
  });
}

// Stable collision/facing root and attachment references are independent of
// Luke's asynchronous visual. The old GLB and old-rig clips have no load path.
export function createPlayer(THREE, {
  modelUrl = LUKE_MODEL_URL,
  animationMode = requestedAnimation === 'hybrid' ? 'hybrid' : 'luke-motion',
  fetchAsset = (...args) => fetch(...args),
  parseModel = data => new GLTFLoader().parseAsync(data, ''),
  kitTextureUrl = LOOK === 'old' || typeof document === 'undefined' ? null : LUKE_KIT_TEXTURE_URL,
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
  group.userData.assetStatus = 'loading';
  group.userData.animationStatus = animationMode === 'hybrid' ? 'superseded' : 'luke-motion';
  group.userData.animationReady = Promise.resolve(group.userData.animationStatus);
  group.userData.assetReady = loadRig();

  async function loadRig() {
    let visual;
    const kitRequest = kitTextureUrl ? loadKitTexture(THREE, kitTextureUrl) : null;
    kitRequest?.catch(() => {});
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
      if (kitRequest) await applyKitTexture(kitRequest, materials);
      handShapesAdapter=createHandShapeAdapter(THREE,meshes[0],handShapes);
      handShapesAdapter.installMorphs();
      // Polished plants/contact use the authoritative root during the first pose.
      group.add(visual);
      const candidate = createPoseAdapter(THREE, visual, bones, anchors);
      candidate.update(0, lastState);
      rig = candidate; rigVisual = visual; rigBones = bones;
      root.shadow.visible = true;
      group.userData.assetStatus = 'ready';
      group.userData.playerAsset = { character: 'Luke', url: modelUrl, triangles,
        materials: materials.size, bones: bones.size, bytes: data.byteLength };
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

  async function applyKitTexture(kitRequest, materials) {
    try {
      const kit = await kitRequest;
      for (const material of materials) {
        const original = material.map;
        if (kit.image.width !== original.image.width || kit.image.height !== original.image.height)
          throw new Error('Kit repaint must match the 512px atlas');
        Object.assign(kit, { magFilter: original.magFilter, minFilter: original.minFilter, wrapS: original.wrapS,
          wrapT: original.wrapT, colorSpace: original.colorSpace });
        kit.needsUpdate = true;
        // glTF gives the emissive slot its own Texture over the same image.
        const emissive = material.emissiveMap;
        if (emissive && (emissive === original || emissive.image === original.image)) {
          if (emissive !== original) emissive.dispose();
          material.emissiveMap = kit;
        }
        material.map = kit;
        material.needsUpdate = true;
        original.dispose();
      }
      group.userData.kit = 'green';
    } catch (error) {
      group.userData.kit = 'original';
      console.warn('Green kit texture unavailable; keeping the original uniform.', error);
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
