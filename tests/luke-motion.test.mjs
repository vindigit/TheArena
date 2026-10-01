import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { loadLukeScene, parseGlb, accessor } from '../scripts/luke-rig-tools.mjs';
import { validateMotionSource, REQUIRED_CLIPS } from '../scripts/validate-luke-motion.mjs';
import { createPoseAdapter } from '../src/player-pose.js';
import { LUKE_MOTION_PACK, sampleLukeMotion, selectLukeMotion, validateLukeMotionPack } from '../src/luke-motion.js';
import { dribbleBallLocal, pickupBallLocal, gatherBallLocal, PICKUP_SECONDS, GATHER_SECONDS } from '../src/player-ball-presentation.js';

const contract = JSON.parse(await readFile(new URL('../docs/rig/luke-rig-contract.json', import.meta.url), 'utf8'));
const glb = await readFile(new URL('../public/assets/models/player/luke-player-v1.glb', import.meta.url));
const motion = JSON.parse(await readFile(new URL('../art/animation/luke-motion-v1.json', import.meta.url), 'utf8'));
const { doc: meshDocument, binary: meshBinary } = parseGlb(glb);
const primitive = meshDocument.meshes[0].primitives[0];
const skinJoints = accessor(meshDocument, meshBinary, primitive.attributes.JOINTS_0);
const skinWeights = accessor(meshDocument, meshBinary, primitive.attributes.WEIGHTS_0);
const meshIndices = accessor(meshDocument, meshBinary, primitive.indices).flat();
const rigidHandTriangles = Object.fromEntries(['right', 'left'].map(side => {
  const handId = contract.bones.findIndex(bone => bone.name === `${side}_hand`);
  const weight = vertex => skinWeights[vertex].reduce((sum, value, slot) => sum + (skinJoints[vertex][slot] === handId ? value : 0), 0);
  const triangles = [];
  for (let index = 0; index < meshIndices.length; index += 3) {
    const triangle = meshIndices.slice(index, index + 3);
    if (triangle.every(vertex => Math.abs(weight(vertex) - 1) < 1e-7)) triangles.push(triangle);
  }
  return [side, triangles];
}));
async function fixture() {
  const { gltf, bones, meshes } = await loadLukeScene(glb);
  const root = new THREE.Group(), visual = gltf.scene;
  root.add(visual);
  const anchors = Object.fromEntries(['rightHand', 'leftHand', 'chest', 'head'].map(name => {
    const anchor = new THREE.Object3D(); root.add(anchor); return [name, anchor];
  }));
  const adapter = createPoseAdapter(THREE, visual, bones, anchors);
  const pose = { ...adapter, update: (dt, state) => adapter.update(dt, { motionPack: 'authored', ...state }) };
  return { root, visual, bones, mesh: meshes[0], anchors, pose };
}
function snapshot(f) {
  return Object.fromEntries([...f.bones].map(([name, b]) => [name, [...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()]]));
}
function positions(f) {
  f.visual.updateWorldMatrix(true, true);
  return Object.fromEntries([...f.bones].map(([name, b]) => [name, b.getWorldPosition(new THREE.Vector3())]));
}
function physicalPalm(f, side = 'right') {
  const point = f.pose.diagnostics().contact?.[side]?.actual;
  assert.ok(Array.isArray(point) && point.length === 3 && point.every(Number.isFinite), 'authored physical palm diagnostic');
  return new THREE.Vector3(...point);
}
function assertRigFrame(f) {
  for (const [name, b] of f.bones) {
    assert.ok([...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()].every(Number.isFinite), `${name}: finite pose`);
    assert.ok(Math.abs(b.quaternion.length() - 1) < 1e-6, `${name}: normalized rotation`);
    assert.deepEqual(b.scale.toArray(), [1, 1, 1], `${name}: unchanged scale`);
    if (name !== 'pelvis') assert.deepEqual(b.position.toArray(), contract.bones.find(bone => bone.name === name).translation, `${name}: canonical translation`);
  }
  assert.deepEqual(f.root.position.toArray(), [0, 0, 0], 'animation cannot move gameplay root');
  assert.deepEqual(f.root.quaternion.toArray(), [0, 0, 0, 1], 'animation cannot turn gameplay root');
  assert.deepEqual(f.visual.position.toArray(), [0, 0, 0], 'animation cannot offset scene container');
  assert.deepEqual(f.bones.get('root').quaternion.toArray(), [0, 0, 0, 1], 'animation cannot turn skeleton root');
}

test('source inventory pins exact Luke target, owned channels and in-place loop endpoints', () => {
  assert.deepEqual(LUKE_MOTION_PACK, motion, 'runtime source must be the maintained pack');
  assert.equal(validateMotionSource(motion, contract).clipCount, 11);
  assert.doesNotThrow(() => validateLukeMotionPack());
  for (const name of REQUIRED_CLIPS) for (let n = 0; n <= 120; n++) {
    const sample = sampleLukeMotion(name, n / 120);
    const values = Object.values(sample).flat();
    assert.ok(values.every(Number.isFinite), `${name}: finite sampled channels`);
  }
});

const corruptions = [
  ['different rig identity', pack => { pack.targetSha256 = '0'.repeat(64); }],
  ['root motion', pack => { pack.inPlace = false; }],
  ['wrong forward axis', pack => { pack.axes.forward = '+Z'; }],
  ['missing required state', pack => { delete pack.clips.pickup; }],
  ['root track', pack => { pack.clips.pickup.joints.push('root'); }],
  ['unowned channel', pack => { pack.clips.pickup.joints = pack.clips.pickup.joints.filter(j => j !== 'right_hand'); }],
  ['missing derived foot owner', pack => { pack.clips.pickup.joints = pack.clips.pickup.joints.filter(j => j !== 'left_foot'); }],
  ['undeclared translation channel', pack => { pack.clips.gather.keyframes[0].values.rootTranslation = [0, 0, 1]; }],
  ['invalid vector', pack => { pack.clips.gather.keyframes[0].values.rightTarget = [0, NaN, 0]; }],
  ['invalid duration', pack => { pack.clips.gather.duration = Infinity; }],
  ['mismatched gameplay action clock', pack => { pack.clips.dunk.duration += .1; }],
  ['duplicate key time', pack => { pack.clips.gather.keyframes[1].time = 0; }],
  ['loop boundary pop', pack => { pack.clips['idle-ready'].keyframes.at(-1).values.chestX += .2; }],
];
for (const [name, mutate] of corruptions) test(`independent motion validator rejects ${name}`, () => {
  const pack = structuredClone(motion); mutate(pack);
  assert.throws(() => validateMotionSource(pack, contract));
});

test('pickup and gather presentation preserve interrupted ball positions and current bounce endpoint', () => {
  for (const origin of [[.22, .12, -.24], [-.34, .23, -.30], [.57, .83, -.16]]) {
    const dribble = dribbleBallLocal(1.73, 3.38);
    assert.deepEqual(pickupBallLocal(origin, 0, dribble), origin, 'pickup begins at actual loose ball');
    assert.deepEqual(pickupBallLocal(origin, 1, dribble), dribble, 'pickup ends at current live dribble');
    for (const charge of [0, .18, .63, 1]) {
      assert.deepEqual(gatherBallLocal(origin, charge, 0), origin, 'gather interruption begins at actual ball');
      const settled = gatherBallLocal(origin, charge, GATHER_SECONDS);
      assert.ok(Math.abs(settled[0] - .22) < 1e-12 && Math.abs(settled[2] + .37) < 1e-12);
      assert.ok(settled[1] >= 1.24 - 1e-12 && settled[1] <= 1.92 + 1e-12, 'gather remains within reachable set-point range');
    }
  }
  assert.ok(PICKUP_SECONDS > GATHER_SECONDS, 'pickup has a distinct reach and transfer duration');
  const onTime = gatherBallLocal(null, .51, GATHER_SECONDS);
  assert.ok(onTime[1] > 1.90, 'on-time shooting reaches the elevated set point');
  assert.deepEqual(gatherBallLocal(null, .6, GATHER_SECONDS), gatherBallLocal(null, 1, GATHER_SECONDS),
    'overcharging holds the set point instead of overextending the rig');
});

test('animation selection distinguishes existing possession and action states', () => {
  const cases = [
    [{ action: 'idle', speed: 0, ballMode: 'loose' }, 'idle-ready'],
    [{ action: 'move', speed: 3, ballMode: 'loose' }, 'locomotion'],
    [{ action: 'move', speed: 3, ballMode: 'loose', motionTransition: 'start' }, 'locomotion-start'],
    [{ action: 'idle', speed: 0, ballMode: 'loose', motionTransition: 'stop' }, 'locomotion-stop'],
    [{ action: 'idle', speed: 0, ballMode: 'dribble' }, 'stationary-dribble'],
    [{ action: 'move', speed: 3, ballMode: 'dribble' }, 'moving-dribble'],
    [{ action: 'move', speed: 3, ballMode: 'dribble', pickupProgress: .2 }, 'pickup'],
    [{ action: 'shoot', ballMode: 'gather', shotProgress: .2, gatherElapsed: .1 }, 'gather'],
    [{ action: 'shoot', ballMode: 'shot', shotProgress: .7, releaseProgress: .2 }, 'release-follow-through'],
    [{ action: 'layup', shotProgress: .2 }, 'layup'],
    [{ action: 'dunk', shotProgress: .2 }, 'dunk'],
  ];
  for (const [state, expected] of cases) {
    const selection = selectLukeMotion(state);
    assert.equal(typeof selection === 'string' ? selection : selection.name, expected);
  }
});

test('interrupted pickup/gather/release and finish reset reproduce fresh Luke poses', async () => {
  const interrupted = await fixture(), fresh = await fixture();
  for (let cycle = 0; cycle < 5; cycle++) {
    for (let i = 0; i < 13; i++) interrupted.pose.update(1 / 60, { action: 'move', speed: 3.38,
      ballMode: 'dribble', ballLocal: [.47, 1.08, -.23], dribblePhase: i * .18 });
    interrupted.pose.update(1 / 60, { action: 'idle', ballMode: 'dribble', pickupProgress: .4, ballLocal: [.34, .68, -.30] });
    interrupted.pose.update(1 / 60, { action: 'shoot', ballMode: 'gather', shotProgress: .14,
      gatherElapsed: .07, ballLocal: [.30, 1.34, -.35] });
    interrupted.pose.update(1 / 60, { action: 'shoot', ballMode: 'shot', shotProgress: .7,
      releaseProgress: .2, releaseLocal: [.22, 1.5, -.37] });
    interrupted.pose.update(1 / 60, { action: cycle % 2 ? 'dunk' : 'layup', shotProgress: .7 });
    assertRigFrame(interrupted);
  }
  interrupted.pose.reset();
  const state = { action: 'idle', speed: 0, ballMode: 'dribble', ballLocal: [.47, 1.12, -.23], dribblePhase: 0 };
  interrupted.pose.update(0, state); fresh.pose.update(0, state);
  assert.deepEqual(snapshot(interrupted), snapshot(fresh), 'reset removes all clip/blend history');
  const fixed = snapshot(interrupted);
  for (let i = 0; i < 100; i++) interrupted.pose.update(0, state);
  assert.deepEqual(snapshot(interrupted), fixed, 'rest-derived transforms do not accumulate at a paused frame');
});

test('ordinary authored finish states expose their ball center without falling back or equating palms to the center', async () => {
  const f = await fixture();
  for (const action of ['layup', 'dunk']) {
    f.pose.reset();
    for (const shotProgress of [.1, .35, .55]) {
      f.pose.update(1 / 60, { action, ballMode: 'finish', shotProgress, ballLocal: null, ballRadius: .12 });
      const diagnostics = f.pose.diagnostics();
      assert.equal(diagnostics.owner, 'luke-authored');
      assert.equal(diagnostics.clip, action);
      assert.equal(diagnostics.fallback, null);
      const center = f.pose.getHeldBallLocal(new THREE.Vector3());
      assert.ok(center && center.toArray().every(Number.isFinite), 'finish ball has a finite dedicated center');
      assert.ok(physicalPalm(f).distanceTo(center) > .08, 'finish physical palm cannot become the ball center');
      assert.ok(diagnostics.contact.right.required, 'finish support contact is explicitly owned');
    }
  }
});

test('reset-seeded dribble histories acquire both existing finishes through the original .22 second handoff', async () => {
  let cases = 0, frames = 0, requiredSamples = 0;
  let maxRequiredTargetError = 0, maxRequiredSurfaceError = 0, minRequiredNormalDot = 1;
  let maxApproachTargetError = 0, maxApproachSurfaceError = 0, minFloorY = Infinity, maxFirstPalmStep = 0;
  const smooth = progress => { const t = Math.max(0, Math.min(1, progress)); return t * t * (3 - 2 * t); };
  for (const hz of [30, 60, 120]) for (const targetSpeed of [0, 3.38]) for (const incomingSeconds of [0, .1, .5, .7]) {
    for (const action of ['layup', 'dunk']) {
      const f = await fixture(), dt = 1 / hz;
      let speed = 0, phase = 0;
      f.pose.update(0, { action: 'idle', speed: 0, ballMode: 'dribble', dribblePhase: 0,
        ballLocal: dribbleBallLocal(0, 0), ballRadius: .12 });
      for (let frame = 0; frame < Math.round(incomingSeconds * hz); frame++) {
        speed += (targetSpeed - speed) * (1 - Math.exp(-12 * dt));
        phase += dt * (speed > .2 ? 11.3 : 7);
        f.pose.update(dt, { action: targetSpeed ? 'move' : 'idle', speed, ballMode: 'dribble', dribblePhase: phase,
          ballLocal: dribbleBallLocal(phase, speed), ballRadius: .12 });
      }
      const origin = dribbleBallLocal(phase, speed), duration = action === 'dunk' ? .76 : .84;
      const releaseAt = action === 'dunk' ? .57 : .59, ownedSides = action === 'dunk' ? ['right', 'left'] : ['right'];
      const incomingPalms = ownedSides.map(side => physicalPalm(f, side));
      for (let frame = 1; frame <= Math.ceil(duration * hz); frame++) {
        const elapsed = frame * dt, progress = Math.min(1, elapsed / duration), complete = elapsed >= duration;
        const held = !complete && progress < releaseAt;
        f.pose.update(dt, { action: complete ? 'idle' : action, speed: action === 'dunk' ? 3.55 : 2.75,
          ballMode: held ? 'finish' : 'flight', ballLocal: null, shotProgress: complete ? 0 : progress,
          finishOriginLocal: origin, finishElapsed: elapsed, dribblePhase: phase + dt * 11.3, ballRadius: .12 });
        assertRigFrame(f);
        const diagnostics = f.pose.diagnostics();
        if (!complete) assert.equal(diagnostics.clip, action, 'runtime finish ownership remains authored');
        const center = diagnostics.ballCenter && new THREE.Vector3(...diagnostics.ballCenter);
        // Preserve the historical .22 s acquisition gate, including its
        // pre-update clock. A generic .32 s free recovery cannot postpone it.
        const acquired = smooth((frame - 1) * dt / .22) >= .99;
        for (const [index, side] of ownedSides.entries()) {
          const contact = diagnostics.contact[side], palm = physicalPalm(f, side);
          const label = `${action}/${side}/${hz}/${targetSpeed}/${incomingSeconds}/${elapsed}`;
          assert.ok([contact.error, ...contact.actual, ...contact.physicalNormal].every(Number.isFinite), `${label}: finite physical contact`);
          assert.equal(contact.required, held && acquired, `${label}: exact existing finish contact acquisition gate`);
          if (frame === 1) maxFirstPalmStep = Math.max(maxFirstPalmStep, incomingPalms[index].distanceTo(palm));
          if (!complete) {
            assert.ok(center, `${label}: actual held center remains available for physical measurements`);
            const surfaceError = Math.abs(palm.distanceTo(center) - .12);
            const normalDot = new THREE.Vector3(...contact.physicalNormal).dot(center.clone().sub(palm).normalize());
            if (contact.required) {
              maxRequiredTargetError = Math.max(maxRequiredTargetError, contact.error);
              maxRequiredSurfaceError = Math.max(maxRequiredSurfaceError, surfaceError);
              minRequiredNormalDot = Math.min(minRequiredNormalDot, normalDot); requiredSamples++;
            } else if (held) {
              // Approach gaps are reported, rather than relabelled as owned contact.
              maxApproachTargetError = Math.max(maxApproachTargetError, contact.error);
              maxApproachSurfaceError = Math.max(maxApproachSurfaceError, surfaceError);
            }
          }
        }
        f.mesh.skeleton.update();
        const position = f.mesh.geometry.attributes.position;
        const jump = complete ? 0 : Math.sin(progress * Math.PI) * (action === 'dunk' ? .86 : .64);
        for (let vertex = 0; vertex < position.count; vertex += 7) {
          const point = f.mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(position, vertex));
          assert.ok(point.toArray().every(Number.isFinite), 'finish-entry skin remains finite');
          minFloorY = Math.min(minFloorY, point.y + jump);
        }
        frames++;
      }
      cases++;
    }
  }
  console.log(JSON.stringify({ finishEntryCases: cases, finishEntryFrames: frames, finishEntryRequiredContactSamples: requiredSamples,
    maxFinishEntryRequiredTargetError: maxRequiredTargetError, maxFinishEntryRequiredSurfaceError: maxRequiredSurfaceError,
    minFinishEntryRequiredNormalDot: minRequiredNormalDot, maxFinishEntryFirstPalmStep: maxFirstPalmStep,
    minFinishEntryFloorY: minFloorY, maxFinishApproachTargetError: maxApproachTargetError,
    maxFinishApproachSurfaceError: maxApproachSurfaceError,
    note: 'Existing .22s acquisition approach gaps are measured; required contact gate is neither shortened nor extended.' }));
  assert.ok(requiredSamples > 100, 'finish test must inspect actual acquired frames through both release cutoffs');
  assert.ok(maxRequiredTargetError < .015, `finish entry physical target error ${maxRequiredTargetError}`);
  assert.ok(maxRequiredSurfaceError < .015, `finish entry sphere error ${maxRequiredSurfaceError}`);
  assert.ok(minRequiredNormalDot >= .95, `finish entry palm alignment ${minRequiredNormalDot}`);
  assert.ok(minFloorY >= -.005, `finish entry floor penetration ${minFloorY}`);
  assert.ok(maxFirstPalmStep < .10, `finish entry first physical palm step ${maxFirstPalmStep}`);
});

test('authored physical contact preserves the public attachment objects and exact legacy bind-local anchor convention', async () => {
  const f = await fixture(), references = { ...f.anchors };
  for (const state of [
    { action: 'idle', ballMode: 'dribble', dribblePhase: Math.PI / 2, ballLocal: dribbleBallLocal(Math.PI / 2) },
    { action: 'shoot', ballMode: 'gather', shotProgress: .3, gatherElapsed: .6, ballLocal: gatherBallLocal(null, .3 / .58, .6) },
    { action: 'dunk', ballMode: 'finish', shotProgress: .4, ballLocal: null },
  ]) {
    f.pose.reset(); f.pose.update(0, state);
    f.visual.updateWorldMatrix(true, true);
    for (const side of ['right', 'left']) {
      const offset = new THREE.Vector3(...contract.handAnchors[`${side}LocalOffset`]);
      const expected = f.visual.worldToLocal(f.bones.get(`${side}_hand`).localToWorld(offset));
      assert.equal(f.anchors[`${side}Hand`], references[`${side}Hand`], 'stable public anchor object');
      assert.ok(f.anchors[`${side}Hand`].position.distanceTo(expected) < 1e-10, 'unchanged bind-local public anchor');
      assert.ok(physicalPalm(f, side).distanceTo(expected) > .08, 'physical palm must not be the legacy offset renamed');
    }
  }
});

test('physical palm landmarks lie on the actual canonical rigid hand surface through authored contact poses', async () => {
  const f = await fixture(), bindLandmarks = {}, states = [];
  for (const speed of [0, 3.38]) states.push({ action: speed ? 'move' : 'idle', speed, ballMode: 'dribble',
    dribblePhase: Math.PI / 2, ballLocal: dribbleBallLocal(Math.PI / 2, speed) });
  for (const pickupProgress of [.35, .55, .72]) states.push({ action: 'idle', speed: 0, ballMode: 'dribble', pickupProgress,
    ballLocal: pickupBallLocal([.42, .12, -.16], pickupProgress, dribbleBallLocal(Math.PI / 2)), dribblePhase: Math.PI / 2 });
  for (const charge of [0, .5, .9]) states.push({ action: 'shoot', ballMode: 'gather', shotProgress: charge * .58,
    gatherElapsed: GATHER_SECONDS, ballLocal: gatherBallLocal(null, charge, GATHER_SECONDS) });
  states.push({ action: 'shoot', ballMode: 'flight', shotProgress: .7, releaseProgress: .2,
    releaseLocal: gatherBallLocal(null, .5, GATHER_SECONDS), ballLocal: null });
  for (const action of ['layup', 'dunk']) for (const shotProgress of [.1, .35, .55]) {
    states.push({ action, ballMode: 'finish', shotProgress, ballLocal: null });
  }
  let maxHandSurfaceDistance = 0, minRequiredPalmNormalDot = 1, maxRequiredSurfaceError = 0;
  for (const state of states) {
    f.pose.reset(); f.pose.update(0, { ...state, ballRadius: .12 });
    f.visual.updateWorldMatrix(true, true); f.mesh.skeleton.update();
    for (const side of ['right', 'left']) {
      const point = physicalPalm(f, side), hand = f.bones.get(`${side}_hand`);
      const bindLocal = hand.worldToLocal(f.visual.localToWorld(point.clone()));
      if (!bindLandmarks[side]) bindLandmarks[side] = bindLocal.clone();
      assert.ok(bindLocal.distanceTo(bindLandmarks[side]) < 1e-9, 'physical landmark is fixed in the hand bone frame');
      assert.ok(Math.abs(bindLocal.x) >= .06 && Math.abs(bindLocal.x) <= .11 && Math.abs(bindLocal.z) < .025,
        'landmark lies in the broad central palm region, not a fingertip or forearm');
      assert.ok(rigidHandTriangles[side].length > 10, 'canonical hand has independent rigid surface triangles');
      const skinned = new Map();
      const skinVertex = index => {
        if (!skinned.has(index)) {
          const value = f.mesh.applyBoneTransform(index, new THREE.Vector3().fromBufferAttribute(f.mesh.geometry.attributes.position, index));
          skinned.set(index, f.visual.worldToLocal(f.mesh.localToWorld(value)));
        }
        return skinned.get(index);
      };
      let distance = Infinity, surfaceNormal = null;
      for (const vertices of rigidHandTriangles[side]) {
        const triangle = new THREE.Triangle(...vertices.map(skinVertex));
        const candidate = triangle.closestPointToPoint(point, new THREE.Vector3()).distanceTo(point);
        if (candidate < distance) { distance = candidate; surfaceNormal = triangle.getNormal(new THREE.Vector3()); }
      }
      maxHandSurfaceDistance = Math.max(maxHandSurfaceDistance, distance);
      assert.ok(distance < 1e-5, `${side}: physical contact point misses actual rigid hand surface by ${distance}m`);
      const contact = f.pose.diagnostics().contact[side];
      if (contact.required) {
        assert.ok(contact.error < .015, `${side}: physical mesh palm does not reach owned ball contact`);
        const center = f.pose.diagnostics().ballCenter || state.ballLocal;
        assert.ok(Array.isArray(center), 'required contact exposes its actual ball center');
        maxRequiredSurfaceError = Math.max(maxRequiredSurfaceError, Math.abs(point.distanceTo(new THREE.Vector3(...center)) - .12));
        const normalDot = surfaceNormal.dot(new THREE.Vector3(...center).sub(point).normalize());
        minRequiredPalmNormalDot = Math.min(minRequiredPalmNormalDot, normalDot);
        assert.ok(normalDot >= .95, `${side}: actual palm surface faces away from ball (dot ${normalDot})`);
      }
    }
  }
  console.log(JSON.stringify({ physicalMeshContactCases: states.length, physicalMeshHandSamples: states.length * 2,
    maxPalmTriangleDistance: maxHandSurfaceDistance, maxRequiredSurfaceError, minRequiredPalmNormalDot,
    physicalBindLandmarks: Object.fromEntries(Object.entries(bindLandmarks).map(([side, point]) => [side, point.toArray()])) }));
});

test('early, medium and late release interruptions extend continuously from the actual gather palm', async () => {
  let maxPalmStep = 0, maxArmDegrees = 0;
  for (const hz of [30, 60, 120]) for (const charge of [.03, .31, .88]) {
    const f = await fixture(), dt = 1 / hz, origin = dribbleBallLocal(Math.PI / 2, 3.38);
    for (let frame = 0; frame < 20; frame++) f.pose.update(dt, { action: 'move', speed: 3.38,
      ballMode: 'dribble', dribblePhase: Math.PI / 2, ballLocal: origin, ballRadius: .12 });
    const frames = Math.max(1, Math.round(charge * 1.3 * hz));
    let ball;
    for (let frame = 1; frame <= frames; frame++) {
      const elapsed = Math.min(charge * 1.3, frame * dt), currentCharge = elapsed / 1.3;
      ball = gatherBallLocal(origin, currentCharge, elapsed);
      f.pose.update(dt, { action: 'shoot', speed: 0, ballMode: 'gather', shotProgress: currentCharge * .58,
        gatherElapsed: elapsed, ballLocal: ball, ballRadius: .12 });
    }
    const beforePalm = physicalPalm(f), beforeArm = f.bones.get('right_upper_arm').quaternion.clone();
    f.pose.update(dt, { action: 'shoot', speed: 0, ballMode: 'flight', releaseProgress: dt / .44,
      shotProgress: .57 + dt / .44 * .43, releaseLocal: ball, ballLocal: null, ballRadius: .12 });
    assert.equal(f.pose.diagnostics().clip, 'release-follow-through'); assertRigFrame(f);
    maxPalmStep = Math.max(maxPalmStep, beforePalm.distanceTo(physicalPalm(f)));
    maxArmDegrees = Math.max(maxArmDegrees, THREE.MathUtils.radToDeg(beforeArm.angleTo(f.bones.get('right_upper_arm').quaternion)));
  }
  console.log(JSON.stringify({ releaseInterruptions: 9, maxReleasePalmStep: maxPalmStep, maxReleaseArmDegrees: maxArmDegrees }));
  assert.ok(maxPalmStep < .10, `release first-frame palm step ${maxPalmStep}`);
  assert.ok(maxArmDegrees < 35, `release first-frame upper-arm angle ${maxArmDegrees}`);
});

test('dedicated pickup deforms safely and reaches the late carry surface without changing the root', async () => {
  let minFloorY = Infinity, maxLateSurfaceError = 0, maxApproachSurfaceError = 0;
  const f = await fixture(), origin = [.42, .12, -.16];
  for (let frame = 0; frame <= 90; frame++) {
    const progress = frame / 90, phase = frame / 60 * 4.4;
    const ball = new THREE.Vector3(...pickupBallLocal(origin, progress, dribbleBallLocal(phase)));
    f.pose.update(PICKUP_SECONDS / 90, { action: 'idle', speed: 0, ballMode: 'dribble', pickupProgress: progress,
      ballLocal: ball.toArray(), ballRadius: .12, dribblePhase: phase });
    assertRigFrame(f);
    const error = Math.abs(physicalPalm(f).distanceTo(ball) - .12);
    if (progress >= .66 && progress <= .76) maxLateSurfaceError = Math.max(maxLateSurfaceError, error);
    if (progress <= .28) maxApproachSurfaceError = Math.max(maxApproachSurfaceError, error);
    f.visual.updateWorldMatrix(true, true); f.mesh.skeleton.update();
    const pos = f.mesh.geometry.attributes.position;
    for (let vertex = 0; vertex < pos.count; vertex++) {
      const point = f.mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(pos, vertex));
      assert.ok(point.toArray().every(Number.isFinite) && Math.abs(point.x) < 1.4 && point.y < 2.8 && Math.abs(point.z) < 1.4,
        'pickup stays in canonical skin envelope');
      minFloorY = Math.min(minFloorY, point.y);
    }
  }
  assert.ok(minFloorY >= -.005, `pickup sole floor penetration ${minFloorY}`);
  assert.ok(maxLateSurfaceError < .015, `late pickup carry surface error ${maxLateSurfaceError}`);
  console.log(JSON.stringify({ pickupPoses: 91, minPickupFloorY: minFloorY, maxLatePickupSurfaceError: maxLateSurfaceError,
    maxApproachSurfaceError, note: 'approach reach error is measured, not represented as continuous palm contact' }));
});

test('every pickup frame preserves physical contact through floor origins and movement interruptions at 30/60/120 Hz', async () => {
  // The first origin reproduces the sprint-left pickup from the actual 60 Hz
  // gameplay replay, after the loose ball has been converted into player space.
  // Sample incoming movement and the loose-ball frame as well as the whole
  // pickup; an isolated late-carry pose cannot expose the cross-body miss.
  const origins = [
    ['replay-left', [-.35, .12, -.00935]],
    ['replay-right', [.35, .12, -.00935]],
    ['forward-left', [-.35, .12, -.35]],
    ['forward-right', [.35, .12, -.35]],
    ['front', [.2, .12, -.35]],
  ];
  const histories = origins.flatMap(([name, origin]) => [0, 3.38, 5.45].map(targetSpeed => ({ name, origin, targetSpeed })));
  for (const [name, origin] of origins.slice(0, 2)) for (const interruptAt of [.2, .5, .7]) {
    histories.push({ name: `${name}-start-${interruptAt}`, origin, targetSpeed: 0, interruptAt, nextSpeed: 5.45 });
    histories.push({ name: `${name}-stop-${interruptAt}`, origin, targetSpeed: 5.45, interruptAt, nextSpeed: 0 });
  }
  let sweeps = 0, interruptionSweeps = 0, frames = 0, requiredFrames = 0, skinSamples = 0;
  let maxTargetError = 0, maxSurfaceError = 0, minNormalDot = 1, minFloorY = Infinity;
  let maxPalmVelocity = 0, maxFirstFootStep = 0, maxFirstPelvisStep = 0, maxFirstArmDegrees = 0;
  let worstCase = null, maxVelocityCase = null, maxPelvisCase = null;
  for (const hz of [30, 60, 120]) for (const { name, origin, targetSpeed, interruptAt, nextSpeed } of histories) {
    const f = await fixture(), dt = 1 / hz;
    let speed = 0, phase = 7 / 120;
    f.pose.update(0, { action: 'idle', speed, ballMode: 'dribble', dribblePhase: phase,
      ballLocal: dribbleBallLocal(phase, speed), ballRadius: .12 });
    for (let frame = 0; frame < Math.round(.5 * hz); frame++) {
      speed += (targetSpeed - speed) * (1 - Math.exp(-12 * dt));
      phase += dt * (speed > .2 ? 11.3 : 7);
      f.pose.update(dt, { action: targetSpeed ? 'move' : 'idle', speed, ballMode: 'dribble',
        dribblePhase: phase, ballLocal: dribbleBallLocal(phase, speed), ballRadius: .12 });
    }
    // In main.js, updatePlayer runs before updateLooseBall registers pickup.
    // Its incoming pose is therefore a real loose-ball locomotion frame.
    speed += (targetSpeed - speed) * (1 - Math.exp(-12 * dt));
    f.pose.update(dt, { action: targetSpeed ? 'move' : 'idle', speed, ballMode: 'loose', ballLocal: null,
      dribblePhase: phase + dt * (speed > .2 ? 11.3 : 7), ballRadius: .12 });
    assert.equal(f.pose.diagnostics().owner, 'luke-authored', 'loose-ball incoming pose keeps the runtime motion owner');
    assert.equal(f.pose.diagnostics().fallback, null, 'pickup cannot be tested through a baseline history reset');
    let previousPalm = physicalPalm(f), previous = positions(f);
    const incomingArm = f.bones.get('right_upper_arm').quaternion.clone();
    const attributes = f.mesh.geometry.attributes.position;
    const vertices = Array.from({ length: attributes.count }, (_, index) => index)
      .filter(index => index % 7 === 0 || attributes.getY(index) < .23);
    for (let frame = 1; frame <= Math.ceil((PICKUP_SECONDS + .1) * hz); frame++) {
      const elapsed = frame * dt, progress = elapsed / PICKUP_SECONDS;
      // Movement changes during pickup keep the same clip. They must not
      // restart its body blend from the stale standing pose captured at entry.
      const currentTarget = Number.isFinite(interruptAt) && progress >= interruptAt ? nextSpeed : targetSpeed;
      speed += (currentTarget - speed) * (1 - Math.exp(-(currentTarget ? 12 : 15) * dt));
      phase += dt * (speed > .2 ? 11.3 : 7);
      const dribble = dribbleBallLocal(phase, speed);
      const ball = progress < 1 ? pickupBallLocal(origin, progress, dribble) : dribble;
      f.pose.update(dt, { action: currentTarget ? 'move' : 'idle', speed, ballMode: 'dribble',
        pickupProgress: progress < 1 ? progress : null, dribblePhase: phase, ballLocal: ball, ballRadius: .12 });
      assertRigFrame(f);
      const contact = f.pose.diagnostics().contact.right, palm = physicalPalm(f), current = positions(f);
      assert.ok([contact.error, contact.ballSurfaceError, contact.normalDot, ...contact.physicalNormal].every(Number.isFinite),
        `${name}/${hz}/${targetSpeed}/${progress}: finite actual physical contact measurements`);
      if (progress < 1) {
        assert.equal(f.pose.diagnostics().clip, 'pickup');
        assert.equal(contact.required, progress >= .35 && progress <= .76,
          'the existing pickup contact window cannot be shortened to mask missed reach');
      }
      if (contact.required) {
        const surfaceError = Math.abs(palm.distanceTo(new THREE.Vector3(...ball)) - .12);
        const normalDot = new THREE.Vector3(...contact.physicalNormal)
          .dot(new THREE.Vector3(...ball).sub(palm).normalize());
        assert.ok(Math.abs(normalDot - contact.normalDot) < 1e-9, 'reported alignment matches posed palm and actual ball');
        if (contact.error > maxTargetError) {
          maxTargetError = contact.error;
          worstCase = { name, hz, targetSpeed, progress, target: contact.target, actual: contact.actual };
        }
        maxSurfaceError = Math.max(maxSurfaceError, surfaceError);
        minNormalDot = Math.min(minNormalDot, normalDot);
        requiredFrames++;
      }
      const palmVelocity = previousPalm.distanceTo(palm) / dt;
      if (palmVelocity > maxPalmVelocity) {
        maxPalmVelocity = palmVelocity;
        maxVelocityCase = { name, hz, targetSpeed, progress, previous: previousPalm.toArray(), actual: palm.toArray() };
      }
      if (frame === 1) {
        maxFirstFootStep = Math.max(maxFirstFootStep, previous.left_foot.distanceTo(current.left_foot), previous.right_foot.distanceTo(current.right_foot));
        const pelvisStep = previous.pelvis.distanceTo(current.pelvis);
        if (pelvisStep > maxFirstPelvisStep) { maxFirstPelvisStep = pelvisStep; maxPelvisCase = { name, hz, targetSpeed }; }
        maxFirstArmDegrees = Math.max(maxFirstArmDegrees, THREE.MathUtils.radToDeg(incomingArm.angleTo(f.bones.get('right_upper_arm').quaternion)));
      }
      f.mesh.skeleton.update();
      for (const vertex of vertices) {
        const point = f.mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(attributes, vertex));
        assert.ok(point.toArray().every(Number.isFinite) && Math.abs(point.x) < 1.5 && point.y < 3 && Math.abs(point.z) < 1.5,
          `${name}: finite bounded pickup skin`);
        minFloorY = Math.min(minFloorY, point.y); skinSamples++;
      }
      previousPalm = palm; previous = current; frames++;
    }
    if (Number.isFinite(interruptAt)) interruptionSweeps++;
    sweeps++;
  }
  console.log(JSON.stringify({ pickupContactSweeps: sweeps, pickupMovementInterruptions: interruptionSweeps, pickupContactFrameSamples: frames,
    pickupRequiredContactSamples: requiredFrames, pickupSweepSkinSamples: skinSamples,
    maxPickupRequiredTargetError: maxTargetError, maxPickupRequiredSurfaceError: maxSurfaceError,
    minPickupRequiredPalmNormalDot: minNormalDot, minPickupSweepFloorY: minFloorY,
    maxPickupPalmVelocity: maxPalmVelocity, maxPickupFirstFootStep: maxFirstFootStep,
    maxPickupFirstPelvisStep: maxFirstPelvisStep, maxPickupFirstArmDegrees: maxFirstArmDegrees,
    worstPickupCase: worstCase, maxPickupVelocityCase: maxVelocityCase, maxPickupFirstPelvisCase: maxPelvisCase }));
  assert.ok(requiredFrames > 100, 'all-rate sweeps must contain actual required contact frames');
  assert.ok(maxTargetError < .015, `whole-pickup physical target error ${maxTargetError}: ${JSON.stringify(worstCase)}`);
  assert.ok(maxSurfaceError < .015, `whole-pickup sphere surface error ${maxSurfaceError}`);
  assert.ok(minNormalDot >= .95, `whole-pickup physical palm faces away from ball (dot ${minNormalDot})`);
  assert.ok(minFloorY >= -.005, `whole-pickup skinned sole floor penetration ${minFloorY}`);
  assert.ok(maxPalmVelocity < 12, `pickup physical palm velocity reveals a discontinuity: ${maxPalmVelocity}m/s`);
  assert.ok(maxFirstFootStep < .095, `pickup first ankle step ${maxFirstFootStep}`);
  assert.ok(maxFirstPelvisStep < .025, `pickup first pelvis step ${maxFirstPelvisStep}`);
  assert.ok(maxFirstArmDegrees < 35, `pickup first upper-arm step ${maxFirstArmDegrees} degrees`);
});

test('every authored clip keeps finite normalized joints and actual Luke skin within the game floor convention', async () => {
  const f = await fixture();
  const minFloorByClip = {}, maxContactErrorByClip = {};
  let poses = 0;
  for (const name of REQUIRED_CLIPS) {
    f.pose.reset();
    for (let frame = 0; frame <= 60; frame++) {
      const progress = frame / 60, phase = progress * Math.PI * 2;
      const state = { inspectionClip: name, inspectionTime: progress, action: 'idle', speed: 0,
        ballMode: 'loose', shotProgress: 0, dribblePhase: phase, ballRadius: .12 };
      if (name.includes('locomotion') || name === 'moving-dribble') { state.action = 'move'; state.speed = 3.38; }
      if (name.includes('dribble')) { state.ballMode = 'dribble'; state.ballLocal = dribbleBallLocal(phase, state.speed); }
      if (name === 'pickup') {
        state.ballMode = 'dribble'; state.pickupProgress = progress;
        state.ballLocal = pickupBallLocal([.42, .12, -.16], progress, dribbleBallLocal(phase));
      }
      if (name === 'gather') {
        state.action = 'shoot'; state.ballMode = 'gather'; state.shotProgress = progress * .58;
        state.gatherElapsed = GATHER_SECONDS; state.ballLocal = gatherBallLocal(null, progress, GATHER_SECONDS);
      }
      if (name === 'release-follow-through') {
        state.action = 'shoot'; state.ballMode = 'flight'; state.shotProgress = .58 + progress * .42;
        state.releaseProgress = progress; state.releaseLocal = [.22, 1.52, -.37];
      }
      let jump = 0;
      if (name === 'layup' || name === 'dunk') {
        const rise = Math.sin(Math.min(progress / .58, 1) * Math.PI / 2);
        state.action = name; state.ballMode = progress < (name === 'dunk' ? .57 : .59) ? 'finish' : 'flight'; state.shotProgress = progress;
        state.ballLocal = [name === 'dunk' ? .10 : .19, 1.61 + rise * .60, -.30 - rise * .10];
        jump = Math.sin(progress * Math.PI) * (name === 'dunk' ? .86 : .64);
      }
      f.pose.update(0, state); assertRigFrame(f);
      f.visual.updateWorldMatrix(true, true); f.mesh.skeleton.update();
      const attributes = f.mesh.geometry.attributes.position;
      for (let vertex = 0; vertex < attributes.count; vertex++) {
        const point = f.mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(attributes, vertex));
        assert.ok(point.toArray().every(Number.isFinite), `${name}: finite skinned vertex`);
        assert.ok(Math.abs(point.x) < 1.5 && point.y < 3 && Math.abs(point.z) < 1.5, `${name}: bounded deformation`);
        minFloorByClip[name] = Math.min(minFloorByClip[name] ?? Infinity, point.y + jump);
      }
      const diagnostics = f.pose.diagnostics();
      for (const contact of Object.values(diagnostics.contact ?? {})) if (contact.required) {
        maxContactErrorByClip[name] = Math.max(maxContactErrorByClip[name] ?? 0, contact.error);
      }
      poses++;
    }
  }
  console.log(JSON.stringify({ authoredClipPoses: poses, minFloorByClip, maxContactErrorByClip }));
  for (const [name, min] of Object.entries(minFloorByClip)) assert.ok(min >= -.005, `${name}: game floor penetration ${min}`);
  for (const [name, error] of Object.entries(maxContactErrorByClip)) assert.ok(error < .015,
    `${name}: required palm target error ${error}`);
});

test('gather and stop sweeps preserve uncrossed knees, contact and skinned soles at 30/60/120 Hz', async () => {
  let minFloorY = Infinity, maxFirstFootStep = 0, maxFirstPelvisStep = 0, maxFirstArmAngle = 0, maxSurfaceError = 0;
  let maxArmCase = null;
  let sweeps = 0, skinSamples = 0;
  for (const hz of [30, 60, 120]) for (const speed of [0, 3.38, 5.45]) for (const phase of [.1, 1.7, 3.6]) for (const action of ['shoot', 'idle']) {
    const f = await fixture(), dt = 1 / hz;
    for (let i = 0; i < 30; i++) f.pose.update(dt, { action: speed ? 'move' : 'idle', speed, ballMode: 'dribble',
      dribblePhase: phase + i * dt * 8.2, ballLocal: dribbleBallLocal(phase + i * dt * 8.2, speed) });
    let previous = positions(f);
    const gatherOrigin = dribbleBallLocal(phase + 29 * dt * 8.2, speed);
    const armQ = f.bones.get('right_upper_arm').quaternion.clone();
    for (let i = 1; i <= Math.ceil(hz * .35); i++) {
      const elapsed = i * dt, charge = elapsed / 1.3;
      const ball = new THREE.Vector3(...gatherBallLocal(gatherOrigin, charge, elapsed));
      const currentSpeed = speed * Math.max(0, 1 - elapsed / .16);
      const currentDribblePhase = phase + 29 * dt * 8.2 + elapsed * (speed > .08 ? 8.2 : 4.4);
      f.pose.update(dt, { action, speed: currentSpeed, ballMode: action === 'shoot' ? 'gather' : 'dribble',
        shotProgress: action === 'shoot' ? charge * .58 : 0, gatherElapsed: elapsed,
        ballLocal: action === 'shoot' ? ball.toArray() : dribbleBallLocal(currentDribblePhase, currentSpeed), ballRadius: .12, dribblePhase: currentDribblePhase });
      assertRigFrame(f);
      const current = positions(f);
      assert.ok(current.left_shin.x < 0 && current.right_shin.x > 0, 'transition cannot cross knees');
      if (i === 1) {
        maxFirstFootStep = Math.max(maxFirstFootStep, previous.left_foot.distanceTo(current.left_foot), previous.right_foot.distanceTo(current.right_foot));
        maxFirstPelvisStep = Math.max(maxFirstPelvisStep, previous.pelvis.distanceTo(current.pelvis));
        const armAngle = armQ.angleTo(f.bones.get('right_upper_arm').quaternion);
        if (armAngle > maxFirstArmAngle) { maxFirstArmAngle = armAngle; maxArmCase = { hz, speed, phase, action }; }
      }
      if (action === 'shoot' && elapsed >= .28) for (const side of ['right', 'left']) {
        maxSurfaceError = Math.max(maxSurfaceError, Math.abs(physicalPalm(f, side).distanceTo(ball) - .12));
      }
      f.mesh.skeleton.update();
      const pos = f.mesh.geometry.attributes.position;
      for (let vertex = 0; vertex < pos.count; vertex += 7) {
        const point = f.mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(pos, vertex));
        assert.ok(point.toArray().every(Number.isFinite), 'finite skinned transition');
        minFloorY = Math.min(minFloorY, point.y); skinSamples++;
      }
      previous = current;
    }
    sweeps++;
  }
  console.log(JSON.stringify({ motionSweeps: sweeps, skinSamples, minFloorY, maxFirstFootStep, maxFirstPelvisStep,
    maxFirstArmDegrees: THREE.MathUtils.radToDeg(maxFirstArmAngle), maxArmCase, maxSurfaceError }));
  assert.ok(minFloorY >= -.005, `skinned sole floor penetration ${minFloorY}`);
  assert.ok(maxFirstFootStep < .095, `transition ankle first step ${maxFirstFootStep}`);
  assert.ok(maxFirstPelvisStep < .025, `transition pelvis first step ${maxFirstPelvisStep}`);
  assert.ok(maxFirstArmAngle < THREE.MathUtils.degToRad(35), `upper gather first step ${THREE.MathUtils.radToDeg(maxFirstArmAngle)}`);
  assert.ok(maxSurfaceError < .01, `settled gather palm/surface error ${maxSurfaceError}`);
});
