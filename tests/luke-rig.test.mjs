import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { parseGlb, loadLukeScene, validateLukeAsset } from '../scripts/luke-rig-tools.mjs';
import { LUKE_BONES, validateLukeRig } from '../src/luke-rig-contract.js';

const contract = JSON.parse(await readFile(new URL('../docs/rig/luke-rig-contract.json', import.meta.url), 'utf8'));
const data = await readFile(new URL('../public/assets/models/player/luke-player-v1.glb', import.meta.url));

test('supplied canonical Luke has exact rest transforms, bind matrices and normalized weights', async () => {
  const metrics = await validateLukeAsset(data, contract);
  assert.equal(metrics.bones, 17);
  assert.equal(metrics.vertices, 3286);
  assert.equal(metrics.triangles, 4754);
  assert.equal(metrics.maxInfluences, 2);
  assert.ok(metrics.maxBindError < 1e-6);
  assert.ok(metrics.maxWeightError < 1e-6);
  assert.deepEqual(contract.bones, LUKE_BONES, 'runtime and offline rest contracts must agree');
});

test('retained historical Luke stays canonical alongside the recovered roster', async () => {
  const filenames = await readdir(new URL('../public/assets/models/player/', import.meta.url));
  assert.deepEqual(filenames.filter(name => name.endsWith('.glb')), ['luke-player-v1.glb']);
  const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
  const players = manifest.assets.filter(asset => asset.runtime.some(file => file.path.startsWith('assets/models/player/')));
  const luke = players.find(asset => asset.id === 'luke-player-v1');
  assert.ok(luke, 'Historical canonical binary remains registered');
  assert.equal(luke.runtime[0].sha256, contract.asset.sha256);
  const roster = JSON.parse(await readFile(new URL('../src/nba2k9-roster.json', import.meta.url), 'utf8'));
  assert.equal(players.length, roster.players.length + 1);
  for (const character of roster.players) {
    assert.ok(players.some(asset => asset.runtime.some(file => file.path === character.url)), 'Every selectable player is registered');
  }
});

test('motion configuration pins Luke and makes no claim of migrated clips', async () => {
  const config = JSON.parse(await readFile(new URL('../scripts/luke-retarget-config.json', import.meta.url), 'utf8'));
  assert.equal(config.targetAsset, contract.asset.path);
  assert.equal(config.targetSha256, contract.asset.sha256);
  assert.equal(config.status, 'luke-authored-motion-part-2');
  assert.equal(config.motionSource, 'art/animation/luke-motion-v1.json');
  assert.equal(config.clipInventory.length, 11);
  assert.equal(config.rootMotion, 'none-gameplay-owned');
  const names = new Set(LUKE_BONES.map(bone => bone.name));
  assert.ok(Object.values(config.sourceToTarget).every(name => names.has(name)));
  assert.equal(Object.values(config.sourceToTarget).length, 16);
});

test('matching names do not permit a different hip rest position or rotated joint frame', async () => {
  const scene = await loadLukeScene(data);
  scene.bones.get('right_thigh').position.x += .01;
  assert.throws(() => validateLukeRig(THREE, scene.gltf.scene, scene.bones, scene.meshes), /right_thigh rest translation differs/);
  scene.bones.get('right_thigh').position.x -= .01;
  scene.bones.get('left_shin').rotation.x = .1;
  assert.throws(() => validateLukeRig(THREE, scene.gltf.scene, scene.bones, scene.meshes), /left_shin rest rotation differs/);
});

test('an incorrect inverse bind matrix fails validation even with identical bone names', async () => {
  const scene = await loadLukeScene(data);
  scene.meshes[0].skeleton.boneInverses[12].elements[13] += .04;
  assert.throws(() => validateLukeRig(THREE, scene.gltf.scene, scene.bones, scene.meshes), /left_shin inverse bind matrix differs/);
});

test('unnormalized skin weights fail before accepting the asset checksum', async () => {
  const corrupt = Buffer.from(data), { doc } = parseGlb(corrupt);
  const entry = doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0];
  assert.equal(entry.componentType, 5126);
  const view = doc.bufferViews[entry.bufferView];
  corrupt.writeFloatLE(.25, 28 + corrupt.readUInt32LE(12) + (view.byteOffset || 0) + (entry.byteOffset || 0));
  await assert.rejects(validateLukeAsset(corrupt, contract), /Normalized skin weights/);
});

test('out-of-range skin indices are rejected independently of names and weights', async () => {
  const corrupt = Buffer.from(data), { doc } = parseGlb(corrupt);
  const entry = doc.accessors[doc.meshes[0].primitives[0].attributes.JOINTS_0];
  const view = doc.bufferViews[entry.bufferView];
  const offset = 28 + corrupt.readUInt32LE(12) + (view.byteOffset || 0) + (entry.byteOffset || 0);
  if (entry.componentType === 5121) corrupt.writeUInt8(17, offset);
  else corrupt.writeUInt16LE(17, offset);
  await assert.rejects(validateLukeAsset(corrupt, contract), /Skin index in range/);
});
