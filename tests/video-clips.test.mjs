import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { POLISHED_PACK, samplePolished } from '../src/polished-motion-data.js';
import { createPolishedPoseAdapter } from '../src/polished-pose.js';

// Video-derived gather / jump shot / layup (scripts/video-mocap). Checks the
// sampled data contract and that the real adapter plays the layup with the
// ball on the captured right palm.
const BONES = ['root', 'pelvis', 'chest', 'left_upper_arm', 'left_forearm', 'left_hand', 'neck', 'head', 'right_upper_arm',
  'right_forearm', 'right_hand', 'left_thigh', 'left_shin', 'left_foot', 'right_thigh', 'right_shin', 'right_foot'];
const RELEASE = { shoot: .2, layup: .4956 };

test('video clips are complete, in place and normalized', () => {
  for (const [name, duration] of [['gather', .5], ['shoot', .7], ['layup', .84]]) {
    const clip = POLISHED_PACK.clips[name];
    assert.ok(clip, name);
    assert.equal(clip.duration, duration); assert.equal(clip.loop, false); assert.match(clip.source, /^video:/);
    assert.equal(clip.samples[0].time, 0); assert.ok(Math.abs(clip.samples.at(-1).time - duration) < 1e-6);
    let previous = -1;
    for (const s of clip.samples) {
      assert.ok(s.time > previous); previous = s.time;
      assert.deepEqual(Object.keys(s.rotations).sort(), [...BONES].sort());
      assert.deepEqual(s.rotations.root, [0, 0, 0, 1], 'root motion is gameplay-owned');
      for (const q of Object.values(s.rotations)) assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-4);
      assert.ok(Number.isFinite(s.visualGroundingY) && Math.abs(s.visualGroundingY) < .3);
      assert.ok(s.ballLocal.every(Number.isFinite));
      if (RELEASE[name] !== undefined)
        assert.equal(s.handShapeState, s.time >= RELEASE[name] - 1e-6 ? 'spread' : 'cupped');
    }
  }
  // The authored shot release point is overhead, where detachJumpShot launches the ball.
  const release = samplePolished(THREE, 'shoot', .2).ballLocal;
  assert.ok(release[1] > 2.0 && release[1] < 2.6, `release height ${release[1]}`);
});

async function loadLuke() {
  const data = await readFile('public/assets/models/player/luke-player-v1.glb');
  const jsonLength = data.readUInt32LE(12), doc = JSON.parse(data.toString('utf8', 20, 20 + jsonLength));
  const binary = data.subarray(28 + jsonLength);
  Object.assign(doc, { images: [], textures: [], samplers: [], materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }] });
  doc.buffers[0].uri = 'data:application/octet-stream;base64,' + binary.toString('base64');
  globalThis.ProgressEvent ||= class { constructor(type, init) { Object.assign(this, { type, ...init }); } };
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(doc), '');
  const bones = new Map(); let mesh;
  gltf.scene.traverse(n => { if (n.isBone) bones.set(n.name, n); if (n.isSkinnedMesh) mesh = n; });
  const group = new THREE.Group(), anchors = {};
  for (const name of ['rightHand', 'leftHand', 'chest', 'head']) { anchors[name] = new THREE.Object3D(); group.add(anchors[name]); }
  group.add(gltf.scene);
  return { group, mesh, adapter: createPolishedPoseAdapter(THREE, gltf.scene, bones, anchors) };
}

test('layup plays the video clip with the ball on the right palm; dunk keeps the legacy pose', async () => {
  const { group, mesh, adapter } = await loadLuke();
  const origin = [.3, .95, -.35], dt = 1 / 60;
  const footBone = mesh.skeleton.bones.findIndex(b => b.name === 'right_foot');
  for (let t = 0; t <= .84 + 1e-9; t += dt) {
    const p = Math.min(1, t / .84), jumpY = Math.sin(Math.PI * p) * .64;
    group.position.y = jumpY; group.updateMatrixWorld(true);
    adapter.update(dt, { action: 'layup', ballMode: p < .59 ? 'finish' : 'flight', speed: 2.75, jump: jumpY / .9,
      finishElapsed: t, finishOriginLocal: origin, shotProgress: p });
    const d = adapter.diagnostics();
    assert.equal(d.clip, 'layup'); assert.equal(d.sourceClip, 'layup');
    const held = adapter.getHeldBallLocal(new THREE.Vector3());
    if (p < .59) {
      assert.ok(held, 'ball is held until release');
      // After the 0.2 s pickup blend from the dribble, the ball follows the captured palm.
      if (t >= .2) {
        assert.ok(held.distanceTo(new THREE.Vector3(...samplePolished(THREE, 'layup', t).ballLocal)) < 1e-6);
        assert.ok(d.contact.right.error < .02, `palm contact error ${d.contact.right.error} at ${t}`);
      }
    }
  }
  // Landing frame: shoes rest on the floor (small numerical tolerance only).
  group.position.y = 0; group.updateMatrixWorld(true); mesh.skeleton.update();
  const g = mesh.geometry, v = new THREE.Vector3(); let low = Infinity;
  for (let i = 0; i < g.attributes.position.count; i++) {
    let w = 0; for (let k = 0; k < 4; k++) if (g.attributes.skinIndex.getComponent(i, k) === footBone) w += g.attributes.skinWeight.getComponent(i, k);
    if (w > .5) low = Math.min(low, mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).y);
  }
  assert.ok(low > -.005 && low < .06, `right sole ${low}`);
  adapter.update(dt, { action: 'dunk', ballMode: 'finish', speed: 3.55, finishElapsed: .1, finishOriginLocal: origin, shotProgress: .13 });
  assert.match(adapter.diagnostics().owner, /legacy/);
});
