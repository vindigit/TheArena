import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlayer, STAGED_PLAYER_RIG_CONTRACT } from '../src/player.js';
import { parseGlb } from '../scripts/luke-rig-tools.mjs';

globalThis.ProgressEvent ||= class { constructor(type, init) { Object.assign(this, { type, ...init }); } };

async function parseForNode(data) {
  const { doc, binary } = parseGlb(data);
  const parseDoc = structuredClone(doc);
  parseDoc.images = [];
  parseDoc.textures = [];
  parseDoc.samplers = [];
  parseDoc.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }];
  parseDoc.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(parseDoc), '');
  gltf.scene.traverse(node => {
    if (!node.isMesh) return;
    node.material.map = new THREE.Texture();
    node.material.map.image = { width: 512, height: 512 };
  });
  return gltf;
}

for (const [character, filename] of [
  ['Fictional Player', 'fictional-player-v2.glb'],
  ['Luke', 'luke-player-preview.glb'],
]) {
  test(`${character} v2 loads without fallback and survives temporary gameplay poses`, async () => {
    const data = await readFile(new URL(`../public/assets/models/player/${filename}`, import.meta.url));
    const gltf = await parseForNode(data);
    const player = createPlayer(THREE, {
      modelUrl: `/assets/models/player/${filename}`,
      rigContract: STAGED_PLAYER_RIG_CONTRACT,
      character,
      fetchAsset: async () => ({ ok: true, arrayBuffer: async () => data }),
      parseModel: async () => gltf,
    });
    assert.equal(await player.group.userData.assetReady, 'ready');
    assert.equal(player.group.userData.assetStatus, 'ready');
    assert.equal(player.group.userData.playerAsset.bones, 22);
    assert.equal(player.group.userData.playerAsset.rigContract, STAGED_PLAYER_RIG_CONTRACT);
    for (const state of [
      { action: 'idle', speed: 0, ballMode: 'dribble', ballLocal: [.47, 1.1, -.23], dribblePhase: 0 },
      { action: 'move', speed: 3, ballMode: 'dribble', ballLocal: [.47, .9, -.23], dribblePhase: 2 },
      { action: 'shoot', speed: 0, charging: true, gatherElapsed: .2, ballMode: 'gather', ballLocal: [.22, 1.55, -.37] },
      { action: 'layup', speed: 2, shotProgress: .5, ballMode: 'gather', ballLocal: [.2, 1.9, -.4] },
    ]) player.update(1 / 60, state);
    for (const point of [player.getRightHandWorldPosition(), player.getLeftHandWorldPosition()])
      assert.ok(point.toArray().every(Number.isFinite));
  });
}
