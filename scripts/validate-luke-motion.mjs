#!/usr/bin/env node
// Independent source-pack checks. Skeletal/deformation and interruption checks
// use the actual canonical GLB in tests/luke-motion.test.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PICKUP_SECONDS } from '../src/player-ball-presentation.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MOTION_SOURCE = 'art/animation/luke-motion-v1.json';
export const REQUIRED_CLIPS = ['idle-ready', 'locomotion', 'locomotion-start', 'locomotion-stop', 'stationary-dribble', 'moving-dribble',
  'pickup', 'gather', 'release-follow-through', 'layup', 'dunk'];
const scalars = ['pelvisX', 'rightHip', 'rightKnee', 'leftHip', 'leftKnee', 'chestX', 'chestY', 'headX'];
const vectors = ['leftTarget', 'rightTarget', 'leftWrist', 'rightWrist', 'rightPole', 'leftPole'];
const channelOwners = { pelvisX: 'pelvis', rightHip: 'right_thigh', rightKnee: 'right_shin', leftHip: 'left_thigh',
  leftKnee: 'left_shin', chestX: 'chest', chestY: 'chest', headX: 'head',
  leftTarget: 'left_upper_arm', rightTarget: 'right_upper_arm', leftPole: 'left_forearm',
  rightPole: 'right_forearm', leftWrist: 'left_hand', rightWrist: 'right_hand' };

export function validateMotionSource(pack, contract) {
  assert.equal(pack.version, 1, 'motion schema version');
  assert.equal(pack.id, 'luke-motion-v1', 'motion source ID');
  assert.equal(pack.targetAsset, contract.asset.path, 'motion target path');
  assert.equal(pack.targetSha256, contract.asset.sha256, 'motion target identity');
  assert.equal(pack.rigContract, 'docs/rig/luke-rig-contract.json', 'motion rig contract');
  assert.equal(pack.inPlace, true, 'motion must be in place');
  assert.equal(pack.units, 'meters', 'motion units');
  assert.deepEqual(pack.axes, { up: '+Y', forward: '-Z' }, 'motion axes');
  assert.equal(pack.interpolation, 'smoothstep', 'motion interpolation');
  assert.deepEqual(Object.keys(pack.clips).sort(), [...REQUIRED_CLIPS].sort(), 'complete existing-gameplay motion inventory');
  const validJoints = new Set(contract.bones.filter(b => b.name !== 'root').map(b => b.name));
  let frames = 0, scalarKeys = 0;
  for (const [name, clip] of Object.entries(pack.clips)) {
    assert.ok(Number.isFinite(clip.duration) && clip.duration > 0 && clip.duration <= 10, `${name}: finite positive duration`);
    assert.equal(typeof clip.loop, 'boolean', `${name}: explicit loop ownership`);
    assert.ok(Array.isArray(clip.joints) && clip.joints.length > 0, `${name}: joint ownership required`);
    assert.equal(new Set(clip.joints).size, clip.joints.length, `${name}: duplicate joint owner`);
    assert.ok(clip.joints.every(joint => validJoints.has(joint)), `${name}: root/container or unknown joint track forbidden`);
    assert.deepEqual([...clip.joints].sort(), [...validJoints].sort(), `${name}: exact single-adapter joint ownership`);
    assert.ok(Object.values(channelOwners).every(joint => clip.joints.includes(joint)), `${name}: channel outside owned joints`);
    assert.ok(Array.isArray(clip.keyframes) && clip.keyframes.length >= 2, `${name}: keyframes required`);
    let previous = -1;
    for (const frame of clip.keyframes) {
      assert.ok(Number.isFinite(frame.time) && frame.time >= 0 && frame.time <= 1 && frame.time > previous,
        `${name}: strictly increasing normalized time`);
      previous = frame.time;
      assert.deepEqual(Object.keys(frame.values).sort(), [...scalars, ...vectors].sort(), `${name}: undeclared or missing channel`);
      for (const channel of scalars) {
        assert.ok(Number.isFinite(frame.values[channel]) && Math.abs(frame.values[channel]) <= Math.PI,
          `${name}.${channel}: finite angular channel`);
        scalarKeys++;
      }
      for (const channel of vectors) {
        const value = frame.values[channel];
        assert.ok(Array.isArray(value) && value.length === 3 && value.every(Number.isFinite), `${name}.${channel}: finite 3-vector`);
        assert.ok(value.every(v => Math.abs(v) <= (channel.endsWith('Wrist') ? Math.PI * 2 : 3)), `${name}.${channel}: bounded channel`);
        scalarKeys += 3;
      }
      frames++;
    }
    assert.equal(clip.keyframes[0].time, 0, `${name}: starts at normalized zero`);
    assert.equal(clip.keyframes.at(-1).time, 1, `${name}: ends at normalized one`);
    if (clip.loop) assert.deepEqual(clip.keyframes[0].values, clip.keyframes.at(-1).values, `${name}: continuous loop endpoints`);
  }
  for (const [name, duration] of Object.entries({ pickup: PICKUP_SECONDS, 'release-follow-through': .44, layup: .84, dunk: .76 })) {
    assert.equal(pack.clips[name].duration, duration, `${name}: metadata must match existing presentation/action clock`);
  }
  return { clipCount: REQUIRED_CLIPS.length, keyframes: frames, scalarKeys, rootTracks: 0, targetSha256: pack.targetSha256 };
}

export async function checkLukeMotion({ checkManifest = true, log = true } = {}) {
  const [source, contractText, configText] = await Promise.all([
    readFile(path.join(repo, MOTION_SOURCE)),
    readFile(path.join(repo, 'docs/rig/luke-rig-contract.json'), 'utf8'),
    readFile(path.join(repo, 'scripts/luke-retarget-config.json'), 'utf8'),
  ]);
  const pack = JSON.parse(source.toString('utf8')), contract = JSON.parse(contractText), config = JSON.parse(configText);
  const metrics = { ...validateMotionSource(pack, contract), sourceBytes: source.length,
    sourceSha256: createHash('sha256').update(source).digest('hex') };
  const target = await readFile(path.join(repo, pack.targetAsset));
  assert.equal(createHash('sha256').update(target).digest('hex'), pack.targetSha256, 'actual target identity');
  assert.equal(config.targetAsset, pack.targetAsset, 'retarget target asset');
  assert.equal(config.targetSha256, pack.targetSha256, 'retarget target identity');
  assert.equal(config.motionSource, MOTION_SOURCE, 'retarget motion source');
  assert.deepEqual(config.clipInventory, REQUIRED_CLIPS, 'retarget clip inventory');
  assert.equal(config.rootMotion, 'none-gameplay-owned', 'retarget root motion');
  if (checkManifest) {
    const manifest = JSON.parse(await readFile(path.join(repo, 'public/assets/animation-runtime-manifest.json'), 'utf8'));
    assert.equal(manifest.canonicalGlbSha256, pack.targetSha256, 'motion inventory target identity');
    const entry = manifest.retainedLukeMotionPack;
    assert.ok(entry, 'Luke manifest must record source-bundled motion pack');
    assert.equal(entry.path, MOTION_SOURCE, 'manifest motion source path');
    assert.equal(entry.bytes, metrics.sourceBytes, 'manifest motion source bytes');
    assert.equal(entry.sha256, metrics.sourceSha256, 'manifest motion source checksum');
    assert.deepEqual(entry.clips, REQUIRED_CLIPS, 'manifest motion clip inventory');
    assert.equal(entry.rootTracks, 0, 'manifest motion is in place');
  }
  if (log) console.log('Luke motion source valid: ' + JSON.stringify(metrics));
  return metrics;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkLukeMotion().catch(error => { console.error(error.message); process.exitCode = 1; });
}
