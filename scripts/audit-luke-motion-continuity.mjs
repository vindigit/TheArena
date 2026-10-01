#!/usr/bin/env node
// Numerical history audit, not a visual or anatomical approval. The rigid
// hand's bind +X extension is reported independently of palm contact distance.
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadLukeScene } from './luke-rig-tools.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const degrees = THREE.MathUtils.radToDeg;
const at = bone => bone.getWorldPosition(new THREE.Vector3());
const rotation = bone => bone.getWorldQuaternion(new THREE.Quaternion());
const up = new THREE.Vector3(0, 1, 0);
const files = ['src/player-pose.js', 'src/luke-motion.js', 'src/player-ball-presentation.js', 'art/animation/luke-motion-v1.json'];

function sample(f, state, elapsed, stage, progress) {
  f.root.updateMatrixWorld(true);
  const diagnostics = f.pose.diagnostics(), hand = f.bones.get('right_hand');
  const finger = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation(hand));
  const forearm = at(hand).sub(at(f.bones.get('right_forearm'))).normalize();
  const gaze = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation(f.bones.get('head')));
  return { elapsed, stage, progress, clip: diagnostics.clip,
    palm: new THREE.Vector3(...diagnostics.contact.right.actual), contact: diagnostics.contact.right,
    wristLocal: hand.quaternion.clone(), handWorld: rotation(hand), finger,
    pelvis: at(f.bones.get('pelvis')),
    feet: ['left', 'right'].map(side => at(f.bones.get(`${side}_foot`))),
    legs: ['left_thigh', 'right_thigh', 'left_shin', 'right_shin'].map(name => f.bones.get(name).quaternion.clone()),
    forearmToFingerDegrees: degrees(finger.angleTo(forearm)),
    chestLocalTiltDegrees: degrees(up.clone().applyQuaternion(f.bones.get('chest').quaternion).angleTo(up)),
    chestWorldTiltDegrees: degrees(up.clone().applyQuaternion(rotation(f.bones.get('chest'))).angleTo(up)),
    headGazePitchDegrees: degrees(Math.asin(THREE.MathUtils.clamp(gaze.y, -1, 1))),
    speed: state.speed || 0 };
}

function summarize(rows, hz, name) {
  const stages = {}, dt = 1 / hz;
  let movingLegHold = 0, releasePalmHold = 0;
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1], current = rows[index];
    const metrics = stages[current.stage] ||= { frames: 0, maxima: {}, maxForearmToFingerDegrees: 0,
      maxRequiredForearmToFingerDegrees: 0, maxChestLocalTiltDegrees: 0, maxChestWorldTiltDegrees: 0,
      minHeadGazePitchDegrees: 90, maxMovingLegHoldSeconds: 0, maxReleasePalmHoldSeconds: 0,
      maxRequiredTargetError: 0, minRequiredNormalDot: 1, transitions: [] };
    const palmStep = previous.palm.distanceTo(current.palm);
    const changes = {
      palmMetresPerSecond: palmStep / dt,
      localWristDegreesPerSecond: degrees(previous.wristLocal.angleTo(current.wristLocal)) / dt,
      worldHandDegreesPerSecond: degrees(previous.handWorld.angleTo(current.handWorld)) / dt,
      worldFingerDegreesPerSecond: degrees(previous.finger.angleTo(current.finger)) / dt,
      pelvisMetresPerSecond: previous.pelvis.distanceTo(current.pelvis) / dt,
      localAnkleMetresPerSecond: Math.max(...current.feet.map((foot, side) => foot.distanceTo(previous.feet[side]))) / dt,
    };
    for (const [metric, value] of Object.entries(changes)) {
      if (!metrics.maxima[metric] || value > metrics.maxima[metric].value) {
        metrics.maxima[metric] = { value, elapsed: current.elapsed, progress: current.progress, from: previous.clip, to: current.clip };
      }
    }
    metrics.maxForearmToFingerDegrees = Math.max(metrics.maxForearmToFingerDegrees, current.forearmToFingerDegrees);
    metrics.maxChestLocalTiltDegrees = Math.max(metrics.maxChestLocalTiltDegrees, current.chestLocalTiltDegrees);
    metrics.maxChestWorldTiltDegrees = Math.max(metrics.maxChestWorldTiltDegrees, current.chestWorldTiltDegrees);
    metrics.minHeadGazePitchDegrees = Math.min(metrics.minHeadGazePitchDegrees, current.headGazePitchDegrees);
    if (current.contact.required) {
      metrics.maxRequiredForearmToFingerDegrees = Math.max(metrics.maxRequiredForearmToFingerDegrees, current.forearmToFingerDegrees);
      metrics.maxRequiredTargetError = Math.max(metrics.maxRequiredTargetError, current.contact.error);
      metrics.minRequiredNormalDot = Math.min(metrics.minRequiredNormalDot, current.contact.normalDot);
    }
    const legChange = Math.max(...current.legs.map((joint, i) => joint.angleTo(previous.legs[i])));
    movingLegHold = current.stage === 'pickup' && current.speed > .5 && legChange < 1e-7 ? movingLegHold + dt : 0;
    releasePalmHold = current.stage === 'release' && palmStep < 1e-7 ? releasePalmHold + dt : 0;
    metrics.maxMovingLegHoldSeconds = Math.max(metrics.maxMovingLegHoldSeconds, movingLegHold);
    metrics.maxReleasePalmHoldSeconds = Math.max(metrics.maxReleasePalmHoldSeconds, releasePalmHold);
    if (previous.clip !== current.clip) metrics.transitions.push({ elapsed: current.elapsed, from: previous.clip, to: current.clip,
      palmStep, localAnkleStep: changes.localAnkleMetresPerSecond * dt,
      localWristDegrees: changes.localWristDegreesPerSecond * dt, worldHandDegrees: changes.worldHandDegreesPerSecond * dt });
    metrics.frames++;
  }
  return { name, hz, frames: rows.length, stages };
}

export async function auditLukeContinuity({ sourceRoot = repo, rates = [30, 60, 120], speeds = [3.38, 5.45],
  origins = [['right', [.35, .12, -.1]], ['left-replay', [-.35, .12, -.00935]], ['front', [.2, .12, -.35]]],
  charges = [.15, .55, .9], recoveries = [true, false] } = {}) {
  const { createPoseAdapter } = await import(pathToFileURL(path.join(sourceRoot, 'src/player-pose.js')));
  const presentation = await import(pathToFileURL(path.join(sourceRoot, 'src/player-ball-presentation.js')));
  const glb = await readFile(path.join(repo, 'public/assets/models/player/luke-player-v1.glb'));
  const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(path.join(sourceRoot, file))).digest('hex')])));
  async function fixture() {
    const { gltf, bones } = await loadLukeScene(glb), root = new THREE.Group(), anchors = {};
    root.add(gltf.scene);
    for (const name of ['rightHand', 'leftHand', 'chest', 'head']) { anchors[name] = new THREE.Object3D(); root.add(anchors[name]); }
    return { root, bones, pose: createPoseAdapter(THREE, gltf.scene, bones, anchors) };
  }
  const cases = [];
  for (const hz of rates) for (const targetSpeed of speeds) {
    const dt = 1 / hz;
    async function chain() {
      const f = await fixture(), rows = [];
      let clock = 0, phase = 0;
      const step = (state, stage, progress) => {
        clock += dt;
        f.pose.update(dt, { motionPack: 'authored', ballRadius: .12, ...state });
        rows.push(sample(f, state, clock, stage, progress));
      };
      for (let frame = 0; frame < Math.round(.5 * hz); frame++) {
        phase += dt * 11.3;
        step({ action: 'move', speed: targetSpeed, ballMode: 'dribble', dribblePhase: phase,
          ballLocal: presentation.dribbleBallLocal(phase, targetSpeed) }, 'incoming');
      }
      return { rows, step, phase };
    }
    for (const [name, origin] of origins) {
      const { rows, step, phase: startPhase } = await chain();
      let phase = startPhase;
      step({ action: 'move', speed: targetSpeed, ballMode: 'loose', ballLocal: null, dribblePhase: phase + dt * 11.3 }, 'loose');
      for (let frame = 1; frame <= Math.ceil(presentation.PICKUP_SECONDS * hz); frame++) {
        const progress = frame * dt / presentation.PICKUP_SECONDS;
        phase += dt * 11.3;
        const dribble = presentation.dribbleBallLocal(phase, targetSpeed);
        step({ action: 'move', speed: targetSpeed, ballMode: 'dribble', dribblePhase: phase,
          pickupProgress: progress < 1 ? progress : null,
          ballLocal: progress < 1 ? presentation.pickupBallLocal(origin, progress, dribble) : dribble },
        progress < 1 ? 'pickup' : 'outgoing', progress);
      }
      for (let frame = 0; frame < Math.round(.6 * hz); frame++) {
        phase += dt * 11.3;
        step({ action: 'move', speed: targetSpeed, ballMode: 'dribble', dribblePhase: phase,
          ballLocal: presentation.dribbleBallLocal(phase, targetSpeed) }, 'outgoing');
      }
      cases.push(summarize(rows, hz, `pickup/${name}/${targetSpeed}`));
    }
    for (const charge of charges) for (const resume of recoveries) {
      const { rows, step, phase } = await chain();
      const origin = presentation.dribbleBallLocal(phase, targetSpeed);
      let speed = targetSpeed, ball;
      for (let frame = 1; frame <= Math.ceil(charge * 1.3 * hz); frame++) {
        const elapsed = frame * dt;
        speed *= Math.exp(-14 * dt);
        ball = presentation.gatherBallLocal(origin, elapsed / 1.3, elapsed);
        step({ action: 'shoot', speed, ballMode: 'gather', shotProgress: elapsed / 1.3 * .58,
          gatherElapsed: elapsed, ballLocal: ball, dribblePhase: phase }, 'gather', elapsed / 1.3);
      }
      for (let frame = 1; frame <= Math.ceil(.44 * hz); frame++) {
        const elapsed = frame * dt, complete = elapsed >= .44;
        step({ action: complete ? 'idle' : 'shoot', speed: 0, ballMode: 'flight', ballLocal: null,
          shotProgress: complete ? 0 : .57 + elapsed / .44 * .43,
          releaseProgress: complete ? null : elapsed / .44, releaseLocal: ball, dribblePhase: phase }, 'release', elapsed / .44);
      }
      speed = 0;
      for (let frame = 0; frame < Math.round(.7 * hz); frame++) {
        speed += ((resume ? targetSpeed : 0) - speed) * (1 - Math.exp(-12 * dt));
        step({ action: resume ? 'move' : 'idle', speed, ballMode: 'flight', ballLocal: null, dribblePhase: phase }, 'recovery');
      }
      cases.push(summarize(rows, hz, `shot/${charge}/${targetSpeed}/${resume ? 'move' : 'idle'}`));
    }
  }
  return { version: 1, scope: 'Numerical continuous-chain audit; no visual approval', sourceHashes: hashes,
    conventions: { root: 'Stationary authored root; ankle velocities are skeletal asset-space motion, not world foot locking.',
      localWrist: 'Hand quaternion relative to forearm; degrees per second from successive shortest quaternion angles.',
      worldHand: 'Hand quaternion in the stationary-root world frame; includes parent motion.',
      finger: 'Right-hand bind +X extension transformed by world hand rotation; no independent finger joints. Hand shape morphs require a separate deformed-mesh audit.',
      bend: 'Angle between posed rigid hand extension and wrist-minus-elbow forearm direction.',
      chest: 'Up-vector tilt: local relative to pelvis and composed world relative to +Y, both ignoring yaw-only rotation.',
      head: 'Composed world pitch of head bind -Z gaze; negative is downward.',
      sampling: 'One adapter update per frame at each stated rate; preserved history, no forced clip or pose resets within a chain.' },
    caseCount: cases.length, frameCount: cases.reduce((sum, value) => sum + value.frames, 0), cases };
}

export function aggregateContinuity(audit) {
  const stages = {};
  for (const entry of audit.cases) for (const [name, measured] of Object.entries(entry.stages)) {
    const result = stages[name] ||= {};
    const recordMaximum = (metric, value, detail = {}) => {
      if (!result[metric] || value > result[metric].value) result[metric] = { value, case: entry.name, hz: entry.hz, ...detail };
    };
    for (const [metric, maximum] of Object.entries(measured.maxima)) recordMaximum(metric, maximum.value,
      { elapsed: maximum.elapsed, progress: maximum.progress, from: maximum.from, to: maximum.to });
    for (const metric of ['maxForearmToFingerDegrees', 'maxRequiredForearmToFingerDegrees', 'maxChestLocalTiltDegrees',
      'maxChestWorldTiltDegrees', 'maxMovingLegHoldSeconds', 'maxReleasePalmHoldSeconds', 'maxRequiredTargetError']) {
      recordMaximum(metric, measured[metric]);
    }
    for (const metric of ['minHeadGazePitchDegrees', 'minRequiredNormalDot']) {
      if (!result[metric] || measured[metric] < result[metric].value) result[metric] = { value: measured[metric], case: entry.name, hz: entry.hz };
    }
  }
  return { sourceHashes: audit.sourceHashes, caseCount: audit.caseCount, frameCount: audit.frameCount, stages };
}

export async function compareLukeContinuity(beforeRoot) {
  const before = await auditLukeContinuity({ sourceRoot: path.resolve(beforeRoot) });
  const final = await auditLukeContinuity();
  const rearLeft = await auditLukeContinuity({ rates: [120], speeds: [5.45], origins: [['rear-left', [-.35, .12, .15]]], charges: [] });
  return { version: 1, status: 'Numerical regressions checked; visual completion and normal-speed perceptual review unverified',
    reproduce: 'node scripts/audit-luke-motion-continuity.mjs --compare .tmp/part2-visual-before',
    conventions: final.conventions,
    limitations: [
      'The seventeen-bone hand has no independent finger articulation. This skeletal orientation audit reports bind extension, not the deformed grip silhouette; contact distance and normal do not establish natural gripping.',
      'Forward pickup retains a required forearm-to-rigid-finger angle above 100 degrees; the sub-90-degree guard applies to the measured side histories only.',
      'Local gather wrist counterrotation remains faster than its composed world hand motion; both rates are reported separately.',
      'Rear-left pickup remains outside the supported required-contact reach bound; it is measured and is not counted as passing contact coverage.',
      'Local ankle measurements do not verify planted world-space feet. Root movement and sliding need actual gameplay and continuous perceptual review.',
      'Direct normal-speed perceptual review is unavailable through image-only visual tools. Dense chronological frames and correctly timed movies do not replace it.',
    ], before: aggregateContinuity(before), final: aggregateContinuity(final), unsupportedRearLeft: aggregateContinuity(rearLeft),
    rawEvidence: ['docs/evidence/part2-continuity-before.json', 'docs/evidence/part2-continuity-final.json'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (process.argv[2] === '--compare' ? compareLukeContinuity(process.argv[3])
    : auditLukeContinuity({ sourceRoot: process.argv[2] ? path.resolve(process.argv[2]) : repo }))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
