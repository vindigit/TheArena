import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRecoveredPoseAdapter, RECOVERED_PRESENTATION } from '../src/nba2k9-motion.js';

function fixture() {
  const root = new THREE.Group(), visual = new THREE.Group(), bones = new Map();
  root.add(visual); visual.scale.setScalar(.01); visual.rotation.y = Math.PI; visual.position.y = 1.05;
  const add = (name, parent, position) => {
    const bone = new THREE.Bone(); bone.name = name; bone.position.fromArray(position);
    (parent ? bones.get(parent) : visual).add(bone); bones.set(name, bone);
  };
  add('root', null, [0, 0, 0]);
  for (const [prefix, sign] of [['l', 1], ['r', -1]]) {
    add(`${prefix}femur`, 'root', [sign * 11, -5, 0]);
    add(`${prefix}tibia`, `${prefix}femur`, [0, -45, 0]);
    add(`${prefix}foot`, `${prefix}tibia`, [0, -45, 0]);
    add(`${prefix}toes`, `${prefix}foot`, [0, -6, 12]);
  }
  add('waist', 'root', [0, 8, 0]); add('lowback', 'waist', [0, 17, 0]);
  add('thorax', 'lowback', [0, 18, 0]); add('neck', 'thorax', [0, 11, 0]); add('head', 'neck', [0, 7, 0]);
  for (const [prefix, sign] of [['l', 1], ['r', -1]]) {
    add(`${prefix}collar`, 'thorax', [sign * 6, 8, 0]);
    add(`${prefix}humerus`, `${prefix}collar`, [sign * 12, 0, 0]);
    add(`${prefix}twist`, `${prefix}humerus`, [sign * 8, -12, 4]);
    add(`${prefix}elbow`, `${prefix}twist`, [sign * 8, -12, 4]);
    add(`${prefix}wrist`, `${prefix}elbow`, [sign * 8, -9, 8]);
    add(`${prefix}hand`, `${prefix}wrist`, [sign * 8, -9, 8]);
  }
  add('cloth', 'root', [0, -10, 0]);
  visual.updateWorldMatrix(true, true);
  const geometry = new THREE.BufferGeometry(), vertices = [], indices = [], weights = [];
  const boneArray = [...bones.values()];
  for (const name of ['lfoot', 'rfoot', 'lhand', 'rhand']) {
    const bone = bones.get(name), center = visual.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    for (const delta of [[-3, -3, -3], [3, -3, -3], [3, 3, 3], [-3, 3, 3]]) {
      vertices.push(center.x + delta[0], center.y + delta[1], center.z + delta[2]);
      indices.push(boneArray.indexOf(bone), 0, 0, 0); weights.push(1, 0, 0, 0);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()); visual.add(mesh);
  mesh.bind(new THREE.Skeleton(boneArray));
  const quat = (axis, angle) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), angle).toArray();
  const clips = [new THREE.AnimationClip('native', 1, [
    new THREE.QuaternionKeyframeTrack('root.quaternion', [0, 1], [...quat([0, 1, 0], .7), ...quat([0, 1, 0], 1.1)]),
    new THREE.QuaternionKeyframeTrack('thorax.quaternion', [0, 1], [...quat([1, 0, 0], .05), ...quat([1, 0, 0], .15)]),
    new THREE.QuaternionKeyframeTrack('rhumerus.quaternion', [0, 1], [...quat([1, 0, 0], .1), ...quat([1, 0, 0], .25)]),
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 300, 200, 100]),
  ])];
  const anchors = Object.fromEntries(['rightHand', 'leftHand', 'chest', 'head'].map(name => {
    const point = new THREE.Object3D(); root.add(point); return [name, point];
  }));
  const motions = Object.fromEntries(['idle', 'move', 'dribble', 'gather', 'shoot', 'layup', 'dunk'].map(name =>
    [name, { clip: 'native', release: .4 }]));
  const adapter = createRecoveredPoseAdapter(THREE, visual, bones, anchors, clips, { motions, height: 2.05 });
  return { root, visual, bones, mesh, clips, anchors, motions, adapter };
}

test('native rotations interpolate while game translation, heading and jump retain ownership', () => {
  const { root, bones, adapter } = fixture();
  root.position.set(2, .3, -4); root.rotation.y = .45;
  const position = root.position.clone(), rotation = root.quaternion.clone();
  for (let i = 0; i < 10; i++) adapter.update(.1, { action: 'move', speed: 3, jump: .3, ballMode: 'flight' });
  assert.ok(root.position.equals(position)); assert.ok(root.quaternion.equals(rotation));
  assert.deepEqual(bones.get('root').position.toArray(), [0, 0, 0]);
  assert.ok(Math.abs(bones.get('root').quaternion.y) < 1e-7, 'native root yaw should be removed');
  assert.deepEqual(bones.get('cloth').position.toArray(), [0, -10, 0], 'extra cloth joints retain source rest');
  assert.ok(Math.abs(bones.get('thorax').quaternion.x) > .02, 'native sample is present');
  assert.equal(adapter.diagnostics().owner, 'nba2k9-recovered-adapted');
});

test('hand contacts use normalized source rig and track the same attached gameplay ball', () => {
  const { adapter, anchors } = fixture();
  const ball = [.35, 1.7, -.25];
  for (let i = 0; i < 10; i++) adapter.update(.02, { action: 'shoot', charging: true, gatherElapsed: .3,
    ballMode: 'gather', ballLocal: ball, ballRadius: .12 });
  const expected = new THREE.Vector3(ball[0], ball[1] - .12, ball[2]);
  assert.ok(anchors.rightHand.position.distanceTo(expected) < .005,
    `right palm missed ball surface: ${anchors.rightHand.position.distanceTo(expected)}`);
  const contact = adapter.diagnostics().contact;
  assert.ok(contact.right.ballSurfaceError < .005);
  assert.ok(contact.left.ballSurfaceError < .005);
  assert.equal(adapter.diagnostics().palms.right.sampledVertices, 4);
});

test('dribble push stays on the upper ball surface and feet remain above parent floor', () => {
  const { adapter, anchors } = fixture(), ball = [.42, .8, -.16];
  for (let i = 0; i < 10; i++) adapter.update(.02, { action: 'idle', speed: 0, dribblePhase: Math.PI / 2,
    ballMode: 'dribble', ballLocal: ball, ballRadius: .12 });
  assert.ok(anchors.rightHand.position.distanceTo(new THREE.Vector3(.42, .92, -.16)) < .005,
    JSON.stringify(adapter.diagnostics().contact));
  assert.equal(adapter.diagnostics().contact.right.required, true);
  for (const foot of Object.values(adapter.diagnostics().footInfo)) assert.ok(foot.displayedSoleMinY >= -1e-6);
});

test('release clock samples the configured native release exactly without releasing possession', () => {
  const { adapter } = fixture();
  adapter.update(0, { action: 'shoot', shootElapsed: RECOVERED_PRESENTATION.shootRelease, ballMode: 'flight' });
  assert.equal(adapter.diagnostics().sourceTime, .4);
  assert.deepEqual(adapter.diagnostics().contact, {});
  assert.equal(adapter.getHeldBallLocal(), null);
  assert.deepEqual(adapter.getPresentationConfig(), RECOVERED_PRESENTATION);
});

test('finish ball follows live source palm, reset discards held ball and source timeline', () => {
  const { adapter, root, anchors } = fixture(); root.position.y = .6;
  adapter.update(0, { action: 'layup', shotProgress: .5, finishElapsed: .5, ballMode: 'finish', ballRadius: .12 });
  const held = adapter.getHeldBallLocal(); assert.ok(held?.toArray().every(Number.isFinite));
  assert.ok(held.distanceTo(anchors.rightHand.position.clone().add(new THREE.Vector3(0, .12, 0))) < .005);
  adapter.reset(); assert.equal(adapter.getHeldBallLocal(), null);
  adapter.update(0, { action: 'idle', ballMode: 'flight' });
  assert.equal(adapter.diagnostics().sourceTime, 0);
});

test('incompatible or missing mappings fail explicitly instead of playing an arbitrary clip', () => {
  const { visual, bones, anchors, clips, motions } = fixture();
  assert.throws(() => createRecoveredPoseAdapter(THREE, visual, bones, anchors, clips), /Missing recovered gameplay mapping/);
  const bad = new THREE.AnimationClip('bad', 1, [new THREE.QuaternionKeyframeTrack('packed_rotation_0.quaternion', [0], [0, 0, 0, 1])]);
  assert.throws(() => createRecoveredPoseAdapter(THREE, visual, bones, anchors, [bad], { motions }), /unavailable joint/);
});

async function parseOffline(path) {
  const bytes = await readFile(path), jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength);
  doc.images = []; doc.textures = []; doc.samplers = [];
  doc.materials = (doc.materials || []).map(() => ({ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  doc.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  globalThis.ProgressEvent ||= class { constructor(type, init) { Object.assign(this, { type, ...init }); } };
  return new GLTFLoader().parseAsync(JSON.stringify(doc), '');
}

test('both shipped recovered players animate, ground, hold and release with finite source skin deformation', async t => {
  const roster = JSON.parse(await readFile(new URL('../src/nba2k9-roster.json', import.meta.url), 'utf8'));
  const motion = await parseOffline(new URL(`../public/${roster.animations.url}`, import.meta.url));
  assert.equal(motion.animations.length, 4);
  const metrics = { maxRequiredContactError: 0, maxDisplayedPalmError: 0, minSoleY: Infinity, checkedVertices: 0, poseFrames: 0, updateMs: 0 };
  for (const player of roster.players) {
    const gltf = await parseOffline(new URL(`../public/${player.url}`, import.meta.url));
    const root = new THREE.Group(), visual = gltf.scene, bones = new Map(), meshes = [];
    visual.scale.setScalar(player.scale); visual.position.y = player.rootOffsetY; visual.rotation.y = player.rotationY;
    root.add(visual);
    visual.traverse(node => { if (node.isBone) bones.set(node.name, node); if (node.isSkinnedMesh) meshes.push(node); });
    const anchors = Object.fromEntries(['rightHand', 'leftHand', 'chest', 'head'].map(name => {
      const anchor = new THREE.Object3D(); root.add(anchor); return [name, anchor];
    }));
    const adapter = createRecoveredPoseAdapter(THREE, visual, bones, anchors, motion.animations, { ...roster.animations, height: player.height });
    assert.equal(bones.size, 33);
    for (const state of [
      { action: 'idle', speed: 0, ballMode: 'dribble', ballLocal: [.42, .8, -.16], dribblePhase: Math.PI / 2 },
      { action: 'move', speed: 3.4, ballMode: 'dribble', ballLocal: [.42, .9, -.16], dribblePhase: Math.PI / 2 },
      { action: 'shoot', charging: true, gatherElapsed: .5, ballMode: 'gather', ballLocal: [.28, 1.75, -.25] },
      { action: 'shoot', shootElapsed: .2, ballMode: 'gather', ballLocal: [.28, 2.05, -.25], jump: .34 },
      { action: 'shoot', shootElapsed: .4, ballMode: 'flight' },
      { action: 'layup', shotProgress: .59, finishElapsed: .5, ballMode: 'finish', jump: .6 },
      { action: 'dunk', shotProgress: .57, finishElapsed: .5, ballMode: 'finish', jump: .9 },
    ]) {
      adapter.reset(); root.position.y = (state.jump || 0) * .9;
      const updateStart = performance.now();
      for (let i = 0; i < 8; i++) { adapter.update(.02, state); metrics.poseFrames++; }
      metrics.updateMs += performance.now() - updateStart;
      for (const anchor of Object.values(anchors)) assert.ok(anchor.position.toArray().every(Number.isFinite));
      for (const mesh of meshes) {
        visual.updateWorldMatrix(true, true); mesh.skeleton.update();
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          metrics.checkedVertices++;
          const vertex = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
          assert.ok(vertex.toArray().every(Number.isFinite), `${player.id} ${state.action} nonfinite skin`);
          assert.ok(vertex.length() < 5, `${player.id} ${state.action} skin escaped game scale`);
        }
      }
      if (state.ballMode === 'gather') assert.ok(adapter.diagnostics().contact.right.ballSurfaceError < .025,
        `${player.id} ${JSON.stringify({ contact: adapter.diagnostics().contact,
          upper: root.worldToLocal(bones.get('rhumerus').getWorldPosition(new THREE.Vector3())).toArray(),
          elbow: root.worldToLocal(bones.get('relbow').getWorldPosition(new THREE.Vector3())).toArray(),
          wrist: root.worldToLocal(bones.get('rhand').getWorldPosition(new THREE.Vector3())).toArray(),
          root: bones.get('root').position.toArray(), visual: visual.position.toArray(), palms: adapter.diagnostics().palms })}`);
      if (state.ballMode === 'finish') assert.ok(adapter.getHeldBallLocal()?.toArray().every(Number.isFinite));
      if (state.action === 'layup' || state.action === 'dunk')
        assert.ok(Math.abs(adapter.diagnostics().sourceTime - roster.animations.mapping[state.action].release) < 1e-7,
          'gameplay finish release should sample its selected native release frame');
      for (const contact of Object.values(adapter.diagnostics().contact)) if (contact.required) {
        metrics.maxRequiredContactError = Math.max(metrics.maxRequiredContactError, contact.error);
        metrics.maxDisplayedPalmError = Math.max(metrics.maxDisplayedPalmError, contact.displayedPalmError);
        assert.ok(contact.error < .025, `${player.id} ${state.action} ${JSON.stringify(contact)}`);
        assert.ok(contact.displayedPalmError < .03, `${player.id} ${state.action} displayed skin ${JSON.stringify(contact)}`);
      }
      for (const foot of Object.values(adapter.diagnostics().footInfo)) {
        metrics.minSoleY = Math.min(metrics.minSoleY, foot.displayedSoleMinY);
        assert.ok(foot.displayedSoleMinY >= -.005);
      }
    }
  }
  t.diagnostic(JSON.stringify(metrics));
});
