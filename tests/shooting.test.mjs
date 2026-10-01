import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createPlayerRoot } from '../src/player-root.js';
import { meterProgress, greenWindow, gradeShot, shotTarget, solveShotArc, sampleShotArc, crossesHoop } from '../src/shooting.js';

// Gameplay landmarks from createArena; Node cannot execute its Vite asset URL.
const rim = {
  rimCenter: new THREE.Vector3(0, 3.05, -5.82),
  rimHeight: 3.05,
  rimRadius: 0.23,
  ballRadius: 0.12,
};
// Shot arcs need the authoritative transform, independent of asset loading.
const player = createPlayerRoot(THREE);
const radius = rim.ballRadius;

test('meter catches up after a stalled frame and release uses its event time', () => {
  const press = 1000;
  assert.equal(meterProgress(press, press + 550), 550 / 1300);
  assert.equal(meterProgress(press, press + 850), 850 / 1300);
  assert.equal(gradeShot(meterProgress(press, press + 663), greenWindow(2)), 'ON TIME');
  assert.equal(gradeShot(meterProgress(press, press + 1000), greenWindow(2)), 'LATE');
  assert.equal(meterProgress(press, press + 2000), 1);
});

test('misses grow with timing error while a just outside release reaches the rim', () => {
  const start = { x: 0.2, y: 1.5, z: 3.9 };
  const window = greenWindow(9);
  const near = shotTarget(start, rim.rimCenter, 'EARLY', window.start - 0.001, window);
  const far = shotTarget(start, rim.rimCenter, 'EARLY', 0, window);
  const nearOffset = Math.hypot(near.x - rim.rimCenter.x, near.z - rim.rimCenter.z);
  const farOffset = Math.hypot(far.x - rim.rimCenter.x, far.z - rim.rimCenter.z);
  assert.ok(nearOffset < rim.rimRadius);
  assert.ok(farOffset > nearOffset);
  assert.deepEqual(shotTarget(start, rim.rimCenter, 'ON TIME', 0.51, window), {
    x: rim.rimCenter.x, y: rim.rimCenter.y, z: rim.rimCenter.z,
  });
});

function shotStart(x, z, yaw, progress) {
  player.group.position.set(x, 0, z);
  player.group.rotation.y = yaw;
  player.group.updateMatrixWorld(true);
  return player.group.localToWorld(new THREE.Vector3(0.22, 1.24 + progress * 0.48, -0.37));
}

function runShot(start, progress, window) {
  const grade = gradeShot(progress, window);
  const target = shotTarget(start, rim.rimCenter, grade, progress, window);
  const arc = solveShotArc(start, target);
  let previous = start;
  let score = 0;
  let ground = null;
  for (let frame = 1; frame < 300; frame += 1) {
    const sample = sampleShotArc(arc, frame / 60);
    if (crossesHoop(previous, sample.position, sample.velocity, rim, radius)) score += 1;
    previous = sample.position;
    if (sample.position.y <= radius) {
      ground = sample.position;
      break;
    }
  }
  return { grade, score, ground, arc };
}

test('green jumpers from a 0.5 m floor grid always score', () => {
  let count = 0;
  for (let x = -7; x <= 7; x += 0.5) {
    for (let z = -6; z <= 6.5; z += 0.5) {
      const distance = Math.hypot(x - rim.rimCenter.x, z - rim.rimCenter.z);
      if (distance < 0.5 || distance > 10.5) continue;
      for (const speed of [0, 3.38, 5.45]) {
        const yaw = Math.atan2(-(rim.rimCenter.x - x), -(rim.rimCenter.z - z));
        const window = greenWindow(distance, speed);
        const progress = (window.start + window.end) / 2;
        const start = shotStart(x, z, yaw, progress);
        const result = runShot(start, progress, window);
        assert.equal(result.grade, 'ON TIME');
        assert.equal(result.score, 1, `green at ${x}, ${z}, speed ${speed}`);
        count += 1;
      }
    }
  }
  assert.ok(count > 1000);
});

test('clear early and late releases miss on the correct side of the rim', () => {
  let count = 0;
  for (let x = -7; x <= 7; x += 0.5) {
    for (let z = -6; z <= 6.5; z += 0.5) {
      const distance = Math.hypot(x - rim.rimCenter.x, z - rim.rimCenter.z);
      if (distance < 0.5 || distance > 10.5) continue;
      const yaw = Math.atan2(-(rim.rimCenter.x - x), -(rim.rimCenter.z - z));
      const window = greenWindow(distance);
      for (const [progress, expected] of [[0, 'EARLY'], [1, 'LATE']]) {
        const start = shotStart(x, z, yaw, progress);
        const result = runShot(start, progress, window);
        assert.equal(result.grade, expected);
        assert.equal(result.score, 0, `${expected} at ${x}, ${z}`);
        assert.ok(result.ground, `ground reached at ${x}, ${z}`);
        const vx = rim.rimCenter.x - start.x;
        const vz = rim.rimCenter.z - start.z;
        const signed = ((result.ground.x - rim.rimCenter.x) * vx + (result.ground.z - rim.rimCenter.z) * vz) / Math.hypot(vx, vz);
        assert.ok(expected === 'EARLY' ? signed < 0 : signed > 0, `${expected} ground side at ${x}, ${z}: ${signed}`);
        count += 1;
      }
    }
  }
  assert.ok(count > 600);
});
