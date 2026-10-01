import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPoseAdapter } from '../src/player-pose.js';
import { createHybridPose } from '../src/player-hybrid.js';

// Exercise the shipped animation and mesh, including the final IK transforms.
// No synthesized rotation tracks or mocked skeleton participate in this check.
const modelPath = 'public/assets/models/player/fictional-player-v2.glb';
const animationPath = process.argv[2] || 'public/assets/models/player/forward-dribble-v1.glb';
const requiredBones = ['root', 'pelvis', 'chest', 'neck', 'head', ...['left', 'right'].flatMap(side =>
  ['upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot'].map(part => `${side}_${part}`))];
const sides = ['left', 'right'];
const radius = .12;
const apexWindow = .35;

function unpack(data) {
  assert.equal(data.toString('ascii', 0, 4), 'glTF');
  assert.equal(data.readUInt32LE(4), 2);
  assert.equal(data.readUInt32LE(8), data.length);
  const jsonLength = data.readUInt32LE(12);
  assert.equal(data.readUInt32LE(16), 0x4e4f534a);
  return {
    json: JSON.parse(data.toString('utf8', 20, 20 + jsonLength)),
    binary: data.subarray(28 + jsonLength),
  };
}

async function parseWithoutTextures(document) {
  const json = structuredClone(document.json);
  // Node has no image decoder; the existing player check separately validates
  // the embedded atlas. Removing textures does not change skinning or motion.
  json.images = []; json.textures = []; json.samplers = [];
  if (json.materials?.length) json.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }];
  json.buffers[0].uri = 'data:application/octet-stream;base64,' + document.binary.toString('base64');
  globalThis.ProgressEvent ||= class { constructor(type, init) { Object.assign(this, { type, ...init }); } };
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}

const [modelData, animationData] = await Promise.all([readFile(modelPath), readFile(animationPath)]);
const modelDocument = unpack(modelData), animationDocument = unpack(animationData);
const doc = animationDocument.json;
assert.ok(animationData.length <= 65536, 'animation exceeds 64 KiB');
for (const collection of ['meshes', 'materials', 'textures', 'images', 'skins']) {
  assert.equal(doc[collection]?.length || 0, 0, `animation unexpectedly contains ${collection}`);
}
assert.equal(doc.animations?.length, 1, 'expected one forward-dribble animation');
assert.ok(!doc.buffers.some(buffer => buffer.uri), 'animation must embed its buffer');
const targetNodes = new Map(modelDocument.json.nodes.map(node => [node.name, node]));
const animationNodes = new Map(doc.nodes.map(node => [node.name, node]));
assert.equal(animationNodes.size, requiredBones.length, 'animation skeleton must contain exactly 17 named joints');
for (const name of requiredBones) {
  const node = animationNodes.get(name), target = targetNodes.get(name);
  assert.ok(node && target, `missing target joint ${name}`);
  const translation = node.translation || [0, 0, 0], expected = target.translation || [0, 0, 0];
  for (let component = 0; component < 3; component++) {
    assert.ok(Math.abs(translation[component] - expected[component]) < 1e-6, `${name}: bind translation differs`);
  }
  assert.ok(!node.rotation || node.rotation.every((value, index) => Math.abs(value - [0, 0, 0, 1][index]) < 1e-6), `${name}: nonidentity bind rotation`);
  assert.ok(!node.scale || node.scale.every(value => value === 1), `${name}: animated bind scale`);
  const children = (node.children || []).map(index => doc.nodes[index].name).sort();
  const expectedChildren = (target.children || []).map(index => modelDocument.json.nodes[index].name).filter(child => requiredBones.includes(child)).sort();
  assert.deepEqual(children, expectedChildren, `${name}: hierarchy differs`);
}
for (const channel of doc.animations[0].channels) {
  const name = doc.nodes[channel.target.node]?.name;
  assert.ok(requiredBones.includes(name) && name !== 'root', `disallowed animated joint ${name}`);
  assert.equal(channel.target.path, 'rotation', `${name}: gameplay translation/scale channel`);
}

const [model, animation] = await Promise.all([parseWithoutTextures(modelDocument), parseWithoutTextures(animationDocument)]);
const clip = animation.animations[0], metadata = doc.animations[0].extras;
assert.ok(metadata && metadata.version === 1 && metadata.strideDistance > 0);
assert.ok(metadata.contacts?.length && sides.every(side => metadata.plants?.[side]?.length), 'missing curated motion markers');
assert.ok(clip.duration > 0 && clip.duration <= 3, 'unexpected experiment cycle duration');
let maxEndpointAngle = 0, keyframes = 0;
for (const track of clip.tracks) {
  assert.ok(track.name.endsWith('.quaternion'), `disallowed runtime track ${track.name}`);
  assert.ok(track.times.length >= 2 && track.values.length === track.times.length * 4);
  assert.ok(Math.abs(track.times[0]) < 1e-6 && Math.abs(track.times.at(-1) - clip.duration) < 1e-5);
  for (let index = 0; index < track.times.length; index++) {
    assert.ok(Number.isFinite(track.times[index]) && (index === 0 || track.times[index] > track.times[index - 1]));
    if (index > 0) assert.ok(track.times[index] - track.times[index - 1] <= 1 / 30 + 1e-5, 'motion sample rate below 30 Hz');
    const values = Array.from(track.values.subarray(index * 4, index * 4 + 4));
    assert.ok(values.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...values) - 1) < 1e-4, `${track.name}: nonunit quaternion`);
    keyframes++;
  }
  const first = new THREE.Quaternion().fromArray(track.values, 0);
  const last = new THREE.Quaternion().fromArray(track.values, track.values.length - 4);
  maxEndpointAngle = Math.max(maxEndpointAngle, first.angleTo(last));
}
assert.ok(maxEndpointAngle <= THREE.MathUtils.degToRad(.5), 'loop endpoint exceeds 0.5 degrees');

const bones = new Map(); let mesh;
model.scene.traverse(node => { if (node.isBone) bones.set(node.name, node); if (node.isSkinnedMesh) mesh = node; });
assert.ok(mesh && requiredBones.every(name => bones.has(name)));
const gameplayRoot = new THREE.Group();
gameplayRoot.position.set(0, 0, 3.9);
gameplayRoot.add(model.scene);
const anchors = Object.fromEntries(['rightHand', 'leftHand', 'chest', 'head'].map(name => {
  const anchor = new THREE.Object3D(); gameplayRoot.add(anchor); return [name, anchor];
}));
const bindPositions = new Map([...bones].map(([name, bone]) => [name, bone.position.clone()]));
const hybrid = createHybridPose(THREE, model.scene, bones, clip, metadata);
const pose = createPoseAdapter(THREE, model.scene, bones, anchors, { hybrid });
assert.equal(typeof pose.updateDribbleContact, 'function');
assert.equal(typeof pose.getHybridDiagnostics, 'function');

// Include all authored sole vertices, rather than just the IK's reference point.
const soleVertices = [];
const positions = mesh.geometry.attributes.position;
for (let index = 0; index < positions.count; index++) {
  const point = new THREE.Vector3().fromBufferAttribute(positions, index);
  if (point.y < .025 && Math.abs(point.x) > .05) soleVertices.push({ index, point });
}
assert.ok(soleVertices.length > 10);
const temp = new THREE.Vector3(), palm = new THREE.Vector3(), ball = new THREE.Vector3(), top = new THREE.Vector3();
let phase = 0, frames = 0, minFloor = Infinity, maxContactError = 0, maxSurfaceError = 0, contactFrames = 0;
let maxPlantDrift = 0, plantedFrames = 0, plantCount = 0;
const plantStarts = { left: null, right: null };
const scenarios = {};
const poseCosts = [];

function wrappedApex(phase) { return Math.atan2(Math.sin(phase - Math.PI / 2), Math.cos(phase - Math.PI / 2)); }
function step(dt, { speed = 3.38, direction = new THREE.Vector3(0, 0, -1), action = 'move', move = true, yaw = gameplayRoot.rotation.y, measure = false } = {}) {
  if (move) gameplayRoot.position.addScaledVector(direction, speed * dt);
  gameplayRoot.rotation.y = yaw;
  const expectedRoot = gameplayRoot.position.clone(), expectedRotation = gameplayRoot.quaternion.clone();
  gameplayRoot.updateMatrixWorld(true);
  const state = { speed, facing: yaw, action, jump: 0, shotProgress: 0, dribblePhase: phase, ballMode: 'dribble' };
  let started = performance.now();
  pose.update(dt, state);
  let poseCost = performance.now() - started;
  // Same radius, phase rate, offsets, and height as main.js updateDribble().
  phase += dt * (speed > .2 ? 11.3 : 7);
  const bob = .5 + Math.sin(phase) * .5;
  ball.set(.42, 0, -.16).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(gameplayRoot.position);
  ball.y = radius + bob * (speed > .2 ? .8 : .68);
  const expectedBall = ball.clone();
  started = performance.now();
  pose.updateDribbleContact({ ballPosition: ball, ballRadius: radius, dribblePhase: phase, ballMode: 'dribble' });
  poseCost += performance.now() - started;
  poseCosts.push(poseCost);
  gameplayRoot.updateMatrixWorld(true); mesh.skeleton.update();
  assert.ok(gameplayRoot.position.equals(expectedRoot), 'pose moved the gameplay root');
  assert.ok(gameplayRoot.quaternion.equals(expectedRotation), 'pose rotated the gameplay root');
  assert.ok(ball.equals(expectedBall), 'contact IK mutated authoritative ball position');
  for (const [name, bone] of bones) {
    assert.ok([...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.matrixWorld.elements].every(Number.isFinite), `${name}: nonfinite pose`);
    if (name === 'pelvis') {
      assert.ok(Math.abs(bone.position.x - bindPositions.get(name).x) < 1e-8 && Math.abs(bone.position.z - bindPositions.get(name).z) < 1e-8, 'pelvis carries gameplay root motion');
    } else assert.ok(bone.position.distanceTo(bindPositions.get(name)) < 1e-8, `${name}: bind length changed`);
  }
  assert.ok(bones.get('root').quaternion.angleTo(new THREE.Quaternion()) < 1e-8, 'animation rotates skeleton root');
  const diagnostics = pose.getHybridDiagnostics();
  assert.ok(diagnostics && Number.isFinite(diagnostics.gaitPhase));
  if (measure && diagnostics.active && diagnostics.weight > .95) {
    for (const { index, point } of soleVertices) {
      mesh.applyBoneTransform(index, temp.copy(point)); mesh.localToWorld(temp);
      minFloor = Math.min(minFloor, temp.y);
    }
    for (const side of sides) {
      const foot = diagnostics.feet[side];
      if (foot.planted && foot.plantWeight > .995) {
        const position = bones.get(`${side}_foot`).localToWorld(new THREE.Vector3().fromArray(foot.soleOffset));
        if (!plantStarts[side]) { plantStarts[side] = position.clone(); plantCount++; }
        maxPlantDrift = Math.max(maxPlantDrift, position.distanceTo(plantStarts[side]));
        plantedFrames++;
      } else plantStarts[side] = null;
    }
    if (Math.abs(wrappedApex(phase)) <= apexWindow) {
      anchors.rightHand.getWorldPosition(palm);
      top.copy(ball).y += radius;
      maxContactError = Math.max(maxContactError, palm.distanceTo(top));
      maxSurfaceError = Math.max(maxSurfaceError, Math.abs(palm.distanceTo(ball) - radius));
      contactFrames++;
    }
  } else for (const side of sides) plantStarts[side] = null;
  frames++;
  return diagnostics;
}

pose.update(0, { action: 'idle', speed: 0, dribblePhase: 0, ballMode: 'dribble' });
for (const [name, speed] of [['walk', 3.38], ['sprint', 5.45]]) {
  for (let frame = 0; frame < 90; frame++) step(1 / 60, { speed });
  const plantsBefore = plantCount, contactBefore = contactFrames;
  for (let frame = 0; frame < 360; frame++) step(1 / 60, { speed, measure: true });
  scenarios[name] = { plants: plantCount - plantsBefore, contactFrames: contactFrames - contactBefore };
  assert.ok(scenarios[name].plants >= 4, `${name}: insufficient complete foot plants measured`);
  const expectedPlants = 6 * speed / metadata.strideDistance * 2;
  assert.ok(Math.abs(scenarios[name].plants - expectedPlants) <= 4, `${name}: excessive plant release/reacquisition during steady movement`);
  assert.ok(scenarios[name].contactFrames >= 10, `${name}: insufficient contact samples measured`);
}
assert.ok(maxPlantDrift <= .03, `steady planted sole drift ${maxPlantDrift.toFixed(5)} m exceeds 3 cm`);
assert.ok(minFloor >= -.005, `rendered sole floor penetration ${minFloor.toFixed(5)} m exceeds 5 mm`);
assert.ok(maxContactError <= .02, `actual palm contact error ${maxContactError.toFixed(5)} m exceeds 2 cm`);

// Nonzero reported speed must not advance gait when no translation occurs.
const clampStart = step(1 / 60, { speed: 5.45, move: false });
for (let frame = 0; frame < 60; frame++) {
  const current = step(1 / 60, { speed: 5.45, move: false });
  assert.ok(Math.abs(current.gaitPhase - clampStart.gaitPhase) < 1e-8, 'gait advanced against a clamped root');
}
scenarios.boundaryClamp = true;
const stoppedRoot = gameplayRoot.position.clone();
for (let frame = 0; frame < 90; frame++) step(1 / 60, { speed: 5.45 * Math.exp(-frame / 4), move: false, action: 'idle' });
assert.ok(gameplayRoot.position.equals(stoppedRoot), 'stop pose moved root');
scenarios.stop = true;
for (const [name, direction, yaw] of [
  ['turn90', new THREE.Vector3(1, 0, 0), -Math.PI / 2],
  ['turn180', new THREE.Vector3(-1, 0, 0), Math.PI / 2],
]) {
  const before = gameplayRoot.position.clone();
  step(1 / 60, { speed: 5.45, direction, yaw });
  assert.ok(gameplayRoot.position.clone().sub(before).dot(direction) > 0, `${name}: root did not reverse immediately`);
  for (let frame = 0; frame < 60; frame++) step(1 / 60, { speed: 5.45, direction, yaw });
  scenarios[name] = true;
}
gameplayRoot.position.set(0, 0, 3.9); gameplayRoot.rotation.y = 0; phase = 0;
step(0, { speed: 0, action: 'idle', move: false, yaw: 0 });
for (let frame = 0; frame < 90; frame++) step(1 / 60, { speed: 3.38, yaw: 0 });
scenarios.reset = true;
const variableSteps = [1 / 120, 1 / 60, 1 / 30, .05];
for (let frame = 0; frame < 160; frame++) step(variableSteps[frame % variableSteps.length], { speed: 3.38, yaw: 0 });
scenarios.variableFrames = true;

// Turn replants deliberately discard a world plant to preserve responsiveness.
// Measure their discontinuity separately from steady planted-foot sliding.
const turnReplants = {};
for (const [name, direction] of [
  ['turn90', new THREE.Vector3(1, 0, 0)],
  ['turn180', new THREE.Vector3(0, 0, 1)],
]) {
  gameplayRoot.position.set(0, 0, 3.9); gameplayRoot.rotation.y = 0; phase = 0;
  step(0, { speed: 0, action: 'idle', move: false, yaw: 0 });
  let before;
  for (let frame = 0; frame < 120; frame++) {
    const diagnostics = step(1 / 60, { speed: 3.38, yaw: 0 });
    const foot = diagnostics.feet.left;
    if (foot.planted && diagnostics.gaitPhase > .4 && diagnostics.gaitPhase < .55) {
      before = {
        root: gameplayRoot.position.clone(),
        target: new THREE.Vector3().fromArray(foot.target),
        sole: bones.get('left_foot').localToWorld(new THREE.Vector3().fromArray(foot.soleOffset)),
      };
      break;
    }
  }
  assert.ok(before, `${name}: did not reach a fully planted stance`);
  assert.ok(before.sole.distanceTo(before.target) <= .03, `${name}: pre-turn sole was not held at the old plant`);
  // The game translates immediately while the original facing damping catches
  // up. Holding visual yaw here tests that same first-frame mismatch directly.
  const diagnostics = step(1 / 60, { speed: 3.38, direction, yaw: 0 });
  const foot = diagnostics.feet.left;
  assert.ok(foot.target, `${name}: missing fresh replant target`);
  const freshTarget = new THREE.Vector3().fromArray(foot.target);
  const actualSole = bones.get('left_foot').localToWorld(new THREE.Vector3().fromArray(foot.soleOffset));
  const rootStep = gameplayRoot.position.clone().sub(before.root);
  const targetChange = freshTarget.distanceTo(before.target);
  const soleToOldTarget = actualSole.distanceTo(before.target);
  const soleToFreshTarget = actualSole.distanceTo(freshTarget);
  assert.ok(rootStep.dot(direction) > 0, `${name}: planted foot delayed the new movement direction`);
  assert.equal(gameplayRoot.rotation.y, 0, `${name}: probe did not preserve first-frame facing lag`);
  assert.ok(targetChange > .03, `${name}: old world plant was retained`);
  assert.ok(soleToOldTarget > .03, `${name}: actual sole remained locked to old plant`);
  assert.ok(soleToFreshTarget <= .03, `${name}: actual sole did not follow the fresh target`);
  turnReplants[name] = {
    rootStep: rootStep.toArray(),
    targetChange,
    soleReplantDistance: actualSole.distanceTo(before.sole),
    soleToOldTarget,
    soleToFreshTarget,
    visualYaw: gameplayRoot.rotation.y,
  };
}
scenarios.sharpTurnOldPlantRelease = true;

// A post-ball pass must never replace a gather/finish/flight pose with dribble IK.
for (const [action, ballMode] of [['shoot', 'gather'], ['dunk', 'finish'], ['move', 'flight'], ['move', 'loose']]) {
  pose.update(1 / 60, { speed: action === 'move' ? 3.38 : 0, action, shotProgress: .4, dribblePhase: Math.PI / 2, ballMode });
  gameplayRoot.updateMatrixWorld(true);
  const beforeBones = new Map([...bones].map(([name, bone]) => [name, bone.quaternion.clone()]));
  const beforeHand = anchors.rightHand.getWorldPosition(new THREE.Vector3());
  pose.updateDribbleContact({ ballPosition: ball, ballRadius: radius, dribblePhase: Math.PI / 2, ballMode });
  for (const [name, bone] of bones) assert.ok(bone.quaternion.equals(beforeBones.get(name)), `${ballMode}: dribble contact changed ${name}`);
  assert.ok(anchors.rightHand.getWorldPosition(new THREE.Vector3()).distanceTo(beforeHand) < 1e-8, `${ballMode}: dribble contact moved hand`);
}
scenarios.nonDribbleContactIsolation = true;

poseCosts.sort((a, b) => a - b);

console.log(JSON.stringify({
  pass: true,
  animation: animationPath,
  bytes: animationData.length,
  sha256: createHash('sha256').update(animationData).digest('hex'),
  duration: clip.duration,
  tracks: clip.tracks.length,
  keyframes,
  maxEndpointDegrees: THREE.MathUtils.radToDeg(maxEndpointAngle),
  maxPlantDrift,
  minFloor,
  maxContactError,
  maxSurfaceError,
  plantedFrames,
  contactFrames,
  frames,
  turnReplants,
  nodePoseCpuMs: {
    mean: poseCosts.reduce((total, cost) => total + cost, 0) / poseCosts.length,
    p95: poseCosts[Math.floor((poseCosts.length - 1) * .95)],
    max: poseCosts.at(-1),
    note: 'Whole pose plus contact on Node; excludes test assertions, skin-vertex checks, rendering, and asset parsing.',
  },
  scenarios,
}, null, 2));
