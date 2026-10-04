import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlayerRoot } from './player-root.js';
import { createRecoveredPoseAdapter } from './nba2k9-motion.js';
import roster from './nba2k9-roster.json' with { type: 'json' };

export const RECOVERED_ROSTER = roster.players;
export const PLAYER_TIMING = Object.freeze({ shootDuration: .7, shootRelease: .2, shootLanding: .4 });
const base = import.meta.env?.BASE_URL || '/';
const assetUrl = url => base + url.replace(/^\/?(?:public\/)?/, '');
const requested = new URLSearchParams(globalThis.location?.search || '').get('character');

// Gameplay owns the root. Each recovered visual and its animation controller
// can be replaced without changing the court, possession, or free-ball physics.
export function createPlayer(THREE, {
  characterId = requested || RECOVERED_ROSTER[0].id,
  fetchAsset = (...args) => fetch(...args),
  parseModel = data => new GLTFLoader().parseAsync(data, ''),
} = {}) {
  const root = createPlayerRoot(THREE), { group } = root;
  const anchors = Object.fromEntries(['rightHand', 'leftHand', 'chest', 'head'].map(name => {
    const anchor = new THREE.Object3D(); anchor.name = `player-${name}-attachment`; group.add(anchor);
    return [name, anchor];
  }));
  let controller = null, visual = null, bones = null, state = {}, generation = 0;
  let animationRequest = null;
  const dispose = scene => {
    if (!scene) return;
    scene.removeFromParent();
    const materials = new Set(), textures = new Set();
    scene.traverse(node => {
      if (!node.isMesh) return;
      node.geometry.dispose();
      for (const material of [node.material].flat()) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose());
  };
  async function readGlb(url, limit = 12_000_000) {
    const response = await fetchAsset(assetUrl(url));
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const data = await response.arrayBuffer();
    if (data.byteLength > limit) throw new Error('Player asset exceeds its loading budget');
    return { gltf: await parseModel(data), bytes: data.byteLength };
  }
  function getAnimations() {
    if (!animationRequest) animationRequest = readGlb(roster.animations.url).then(({ gltf }) => {
      if (!gltf.animations.length) throw new Error('Recovered motion bundle is empty');
      return gltf.animations;
    }).catch(error => { animationRequest = null; throw error; });
    return animationRequest;
  }
  async function loadCharacter(id) {
    const selection = RECOVERED_ROSTER.find(player => player.id === id) || RECOVERED_ROSTER[0];
    const current = ++generation;
    controller = null; bones = null; root.shadow.visible = false;
    dispose(visual); visual = null;
    Object.assign(group.userData, { character: selection.label, characterId: selection.id,
      assetStatus: 'loading', animationStatus: 'loading', assetError: null });
    let candidate;
    try {
      const modelRequest = readGlb(selection.url).then(model => { candidate = model.gltf.scene; return model; });
      const [model, clips] = await Promise.all([modelRequest, getAnimations()]);
      candidate = model.gltf.scene;
      if (current !== generation) { dispose(candidate); return 'superseded'; }
      const rig = new Map(), meshes = [];
      let triangles = 0;
      candidate.traverse(node => {
        if (node.isBone) {
          if (rig.has(node.name)) throw new Error(`Duplicate player joint: ${node.name}`);
          rig.set(node.name, node);
        }
        if (!node.isMesh) return;
        meshes.push(node);
        triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
        node.castShadow = true; node.receiveShadow = true; node.frustumCulled = false;
        for (const material of [node.material].flat()) {
          material.metalness = 0; material.roughness = .88;
          if (material.map) { material.map.colorSpace = THREE.SRGBColorSpace; material.map.magFilter = THREE.NearestFilter; }
        }
      });
      for (const name of ['root', 'waist', 'lhumerus', 'lelbow', 'lhand', 'rhumerus', 'relbow', 'rhand', 'head']) {
        if (!rig.has(name)) throw new Error(`Recovered player is missing ${name}`);
      }
      if (!meshes.some(mesh => mesh.isSkinnedMesh) || triangles === 0 || triangles > 20_000) {
        throw new Error('Recovered player geometry is incomplete or exceeds the triangle budget');
      }
      const scale = selection.scale ?? 1;
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid recovered player scale');
      candidate.scale.setScalar(scale);
      candidate.rotation.y = selection.rotationY ?? 0;
      candidate.position.y = selection.rootOffsetY ?? 0;
      group.add(candidate); candidate.updateWorldMatrix(true, true);
      const adapter = createRecoveredPoseAdapter(THREE, candidate, rig, anchors, clips, {
        ...roster.animations, motions: roster.animations.mapping, height: selection.height,
        ...(selection.motion || {}), ...PLAYER_TIMING,
      });
      adapter.update(0, state);
      visual = candidate; bones = rig; controller = adapter;
      root.shadow.visible = true;
      Object.assign(group.userData, { assetStatus: 'ready', animationStatus: 'ready',
        playerAsset: { character: selection.label, id: selection.id, url: assetUrl(selection.url),
          triangles, bones: rig.size, meshes: meshes.length, bytes: model.bytes } });
      return 'ready';
    } catch (error) {
      dispose(candidate);
      if (current !== generation) return 'superseded';
      Object.assign(group.userData, { assetStatus: 'error', animationStatus: 'error',
        assetError: 'Player could not be loaded. Reload to try again.' });
      console.error('Recovered player unavailable; play is blocked.', error);
      return 'error';
    }
  }
  const player = {
    group, ...anchors,
    update(dt = 1 / 60, next = {}) { state = next; root.update(dt, next); controller?.update(dt, next); },
    resetPose() { state = {}; controller?.reset(); },
    setCharacter(id) { group.userData.assetReady = loadCharacter(id); return group.userData.assetReady; },
    updateHandShapes() {}, updateDribbleContact() {},
    getAnimationDiagnostics() { return { mode: 'nba2k9-recovered', status: group.userData.animationStatus,
      character: group.userData.characterId, ...(controller?.diagnostics() || {}) }; },
    getRigInspection() { return import.meta.env?.DEV ? { visual, bones } : null; },
    getRightHandWorldPosition(target = new THREE.Vector3()) { return anchors.rightHand.getWorldPosition(target); },
    getLeftHandWorldPosition(target = new THREE.Vector3()) { return anchors.leftHand.getWorldPosition(target); },
    getHeldBallWorldPosition(target = new THREE.Vector3()) {
      const local = controller?.getHeldBallLocal();
      return local ? group.localToWorld(target.copy(local)) : anchors.rightHand.getWorldPosition(target);
    },
  };
  player.setCharacter(characterId);
  return player;
}
