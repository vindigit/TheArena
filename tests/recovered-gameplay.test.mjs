import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createRecoveredGameHarness } from '../scripts/recovered-game-harness.mjs';

const profiles = [{ hz: 30 }, { hz: 60 }, { hz: 60, jitter: .7, seed: 47 }];
const grades = [{ charge: .15, grade: 'EARLY' }, { charge: .51, grade: 'ON TIME' }, { charge: .85, grade: 'LATE' }];
const distance = (a, b) => new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));

for (const profile of profiles) {
  const name = profile.jitter ? 'jittered 60 Hz' : `${profile.hz} Hz`;
  test(`jump shots release exactly once at 200 ms for all grades at ${name}`, async () => {
    const h = await createRecoveredGameHarness(profile);
    for (const { charge, grade } of grades) {
      h.reset(); h.advance(.1);
      h.api.startCharge(h.clock.now);
      h.clock.now += charge * 1300;
      h.api.releaseJumpShot(h.clock.now);
      assert.equal(h.game.player.shotPending.grade, grade);
      assert.equal(h.game.ball.mode, 'gather');
      assert.equal(h.game.player.shotReleaseCount, 0);
      while (h.game.player.actionTime < .39) h.frame();
      assert.equal(h.launches.length, 1);
      assert.equal(h.game.player.shotReleaseCount, 1);
      assert.ok(Math.abs(h.game.player.shotPending.detachedAt - .2) < 1e-8);
      assert.ok(Math.abs(h.launches[0].actionTime - .2) < 1e-8);
      assert.ok(Math.abs(h.launches[0].jumpY - .3048) < 1e-8);
      h.api.detachJumpShot(); h.api.releaseJumpShot(h.clock.now);
      assert.equal(h.launches.length, 1, 'Repeated release calls cannot launch twice');
      if (grade === 'ON TIME') {
        const deadline = h.launches[0].elapsed + h.launches[0].duration + .15;
        while (!h.game.score && h.game.elapsed < deadline) h.frame();
        assert.equal(h.game.score, h.launches[0].options.points, 'The on-time arc crosses the real hoop and awards its points');
      }
      h.reset();
      assert.equal(h.game.player.shotPending, null);
      assert.equal(h.game.player.shotReleaseCount, 0);
      assert.equal(h.game.ball.mode, 'dribble');
      assert.equal(h.player.group.userData.assetStatus, 'ready');
    }
  });

  test(`layup and dunk launch from the current displayed palm at ${name}`, async () => {
    const h = await createRecoveredGameHarness(profile);
    for (const action of ['layup', 'dunk']) {
      h.reset();
      h.game.player.position.z = action === 'dunk' ? -3.7 : -1.5;
      h.game.player.currentSpeed = action === 'dunk' ? 2 : 0;
      h.player.group.position.copy(h.game.player.position);
      h.api.startFinish();
      assert.equal(h.game.player.action, action);
      const duration = h.game.player.actionDuration, progress = action === 'dunk' ? .57 : .59;
      while (!h.launches.length) h.frame();
      const launch = h.launches[0], presented = h.poses.findLast(pose => Math.abs(pose.actionTime - launch.actionTime) < 1e-8);
      assert.ok(Math.abs(launch.actionTime - duration * progress) < 1e-8);
      assert.ok(Math.abs(launch.actionProgress - progress) < 1e-8);
      assert.ok(distance(launch.start, launch.heldAtRelease) < 1e-8, 'Release uses current hand attachment');
      assert.ok(presented && distance(launch.start, presented.held) < 1e-8, 'Current pose writer ran before release');
      assert.equal(h.game.player.finishReleased, true);
      assert.equal(h.game.ball.mode, 'flight');
      assert.ok(Math.abs(h.game.ball.flightAge - (h.game.elapsed - launch.elapsed)) < 1e-8, 'Flight starts at release, without integrating the pre-release frame');
      h.frame();
      assert.equal(h.launches.length, 1, 'Finish releases once');
      const deadline = launch.elapsed + launch.duration + .15;
      while (!h.game.score && h.game.elapsed < deadline) h.frame();
      assert.equal(h.game.score, 2, 'The finish travels through the real scoring cylinder');
    }
  });
}

test('reset during a pending shot or finish cancels the old physical release', async () => {
  for (const profile of profiles) {
    const h = await createRecoveredGameHarness(profile);
    h.api.startCharge(h.clock.now); h.clock.now += .51 * 1300; h.api.releaseJumpShot(h.clock.now);
    while (h.game.player.actionTime < .12) h.frame();
    assert.equal(h.launches.length, 0);
    h.reset(); h.advance(.4);
    assert.equal(h.launches.length, 0, 'Cancelled jumper never launches after reset');
    assert.equal(h.game.player.shotPending, null);
    h.game.player.position.z = -1.5; h.player.group.position.copy(h.game.player.position);
    h.api.startFinish(); h.advance(.2);
    assert.equal(h.launches.length, 0);
    h.reset(); h.advance(.6);
    assert.equal(h.launches.length, 0, 'Cancelled finish never launches after reset');
    assert.equal(h.game.ball.mode, 'dribble');
  }
});

test('keyboard and touch input move the same recovered player, and scoring survives reset', async () => {
  const h = await createRecoveredGameHarness({ characterId: 'classic-two' });
  const origin = h.game.player.position.clone();
  h.input.forward = true; h.advance(.5);
  assert.ok(h.game.player.position.z < origin.z - 1);
  h.reset(); h.input.touchY = 1; h.advance(.5);
  assert.ok(h.game.player.position.z < origin.z - 1);
  h.game.ball.points = 3; h.api.scoreBasket(); h.api.scoreBasket();
  assert.equal(h.game.score, 3, 'A scored ball awards points only once');
  h.api.resetPossession(true);
  assert.equal(h.game.score, 3);
  assert.equal(h.game.ball.mode, 'dribble');
  assert.equal(h.player.group.userData.characterId, 'classic-two');
  assert.ok(h.game.ball.position.toArray().every(Number.isFinite));
});
