import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlayer, LUKE_MODEL_URL } from '../src/player.js';

const data = await readFile('public/assets/models/player/luke-player-v1.glb');
globalThis.ProgressEvent ||= class { constructor(type, init) { Object.assign(this, { type, ...init }); } };
const response = { ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };

// Parse the real skeleton and mesh offline. The existing binary test decodes
// the embedded atlas; Node has no browser image decoder, so retain its measured
// texture dimensions in a Three texture here rather than fetching another file.
async function parseNodeModel() {
  const jsonLength = data.readUInt32LE(12);
  const doc = JSON.parse(data.toString('utf8', 20, 20 + jsonLength));
  const binary = data.subarray(28 + jsonLength);
  doc.images = []; doc.textures = []; doc.samplers = [];
  doc.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }];
  doc.buffers[0].uri = 'data:application/octet-stream;base64,' + binary.toString('base64');
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(doc), '');
  gltf.scene.traverse(node => {
    if (node.isMesh) node.material.map = new THREE.Texture({ width: 512, height: 512 });
  });
  return gltf;
}
const visibleMeshes = group => {
  const meshes = [];
  group.traverseVisible(node => { if (node.isMesh) meshes.push(node); });
  return meshes;
};
async function quietFailure(run) {
  const original = console.error;
  console.error = () => {};
  try { return await run(); } finally { console.error = original; }
}

test('ordinary loading requests Luke once and renders no loading substitute', async () => {
  let resolveFetch;
  const urls = [];
  const player = createPlayer(THREE, {
    fetchAsset: url => { urls.push(url); return new Promise(resolve => { resolveFetch = resolve; }); },
    parseModel: parseNodeModel,
  });
  const refs = [player.group, player.rightHand, player.leftHand, player.chest, player.head];
  assert.equal(player.group.userData.assetStatus, 'loading');
  assert.deepEqual(visibleMeshes(player.group), []);
  assert.deepEqual(urls, [LUKE_MODEL_URL]);
  assert.ok(LUKE_MODEL_URL.endsWith('/assets/models/player/luke-player-v1.glb'));
  player.group.position.set(3, 0, -2);
  player.update(1 / 60, { action: 'move', speed: 3, facing: 1 });
  resolveFetch(response);
  assert.equal(await player.group.userData.assetReady, 'ready');
  assert.equal(player.group.userData.playerAsset.character, 'Luke');
  assert.equal(visibleMeshes(player.group).filter(node => node.isSkinnedMesh).length, 1);
  assert.ok(refs.every((ref, i) => ref === [player.group, player.rightHand, player.leftHand, player.chest, player.head][i]));
  player.update(1 / 60, { action: 'shoot', shotProgress: .3, facing: 1 });
  assert.deepEqual(player.group.position.toArray(), [3, 0, -2]);
  assert.ok(player.getRightHandWorldPosition().toArray().every(Number.isFinite));
  player.resetPose();
  player.update(0, { action: 'idle', facing: 0 });
  assert.equal(player.group.userData.assetStatus, 'ready');
  assert.equal(player.getRigInspection(), null, 'production/Node does not expose mutable inspection handles');
});

test('obsolete hybrid option never requests an old-rig clip', async () => {
  const urls = [];
  const player = createPlayer(THREE, {
    animationMode: 'hybrid',
    fetchAsset: async url => { urls.push(url); return response; },
    parseModel: parseNodeModel,
  });
  assert.equal(await player.group.userData.assetReady, 'ready');
  assert.equal(await player.group.userData.animationReady, 'superseded');
  assert.deepEqual(urls, [LUKE_MODEL_URL]);
  assert.equal(player.getAnimationDiagnostics().mode, 'procedural');
  assert.equal(player.getAnimationDiagnostics().weight, 0);
  assert.match(player.getAnimationDiagnostics().superseded, /Part 2/);
});

test('Luke HTTP failure remains empty and explicit through updates and resets', async () => {
  await quietFailure(async () => {
    const urls = [];
    const player = createPlayer(THREE, {
      fetchAsset: async url => { urls.push(url); return { ok: false, status: 404 }; },
    });
    assert.equal(await player.group.userData.assetReady, 'error');
    assert.match(player.group.userData.assetError, /Luke.*Reload/);
    for (const action of ['idle', 'move', 'shoot', 'layup', 'dunk']) {
      player.update(1 / 60, { action, shotProgress: .4, speed: 3 });
      player.resetPose();
      assert.deepEqual(visibleMeshes(player.group), []);
    }
    assert.deepEqual(urls, [LUKE_MODEL_URL]);
  });
});

test('matching names cannot bypass Luke rest-frame validation', async () => {
  await quietFailure(async () => {
    const player = createPlayer(THREE, {
      fetchAsset: async () => response,
      parseModel: async () => {
        const gltf = await parseNodeModel();
        gltf.scene.getObjectByName('pelvis').position.x += .01;
        return gltf;
      },
    });
    assert.equal(await player.group.userData.assetReady, 'error');
    assert.deepEqual(visibleMeshes(player.group), []);
  });
});

test('runtime has no old model selector, fallback construction, or animation import', async () => {
  const source = await readFile('src/player.js', 'utf8');
  assert.doesNotMatch(source, /fictional-player|player-procedural|previewLuke|forward-dribble|player-hybrid|loadAnimation/);
  assert.doesNotMatch(source, /get\(['"]player['"]\)/);
  const main = await readFile('src/main.js', 'utf8');
  assert.match(main, /assetStatus !== 'ready'\) return/);
  assert.match(main, /CHARACTER LOAD FAILED/);
});
