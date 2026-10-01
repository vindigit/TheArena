import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLukeContinuity } from '../scripts/audit-luke-motion-continuity.mjs';

// These are numerical regression bounds for observed failures. They do not
// approve natural gripping, rhythm, or world-space planted-foot locking.
const audit = await auditLukeContinuity();
const value = (stage, name) => stage.maxima[name].value;

test('whole moving pickup chains preserve wrist/body corrections and avoid hold or blend-expiry spikes', () => {
  const pickups = audit.cases.filter(entry => entry.name.startsWith('pickup/'));
  assert.equal(pickups.length, 18, 'left/right/front histories cover walking, sprinting and all three rates');
  for (const entry of pickups) {
    const label = `${entry.name}/${entry.hz}`, { pickup, outgoing, incoming } = entry.stages;
    assert.ok(pickup.maxRequiredTargetError < .015, `${label}: unchanged physical contact bound`);
    assert.ok(pickup.minRequiredNormalDot >= .95, `${label}: unchanged physical normal bound`);
    assert.ok(value(pickup, 'localWristDegreesPerSecond') < 2200, `${label}: local wrist roll discontinuity`);
    assert.ok(value(pickup, 'worldHandDegreesPerSecond') < 1500, `${label}: world hand orientation discontinuity`);
    assert.ok(pickup.maxChestLocalTiltDegrees < 20, `${label}: excessive bend concentrated at chest`);
    assert.ok(pickup.maxChestWorldTiltDegrees < 55, `${label}: composed torso overfold`);
    assert.ok(pickup.minHeadGazePitchDegrees > -35, `${label}: head gaze overcurl`);
    assert.ok(value(pickup, 'pelvisMetresPerSecond') < 7, `${label}: whole-descent pelvis spike`);
    assert.ok(pickup.maxMovingLegHoldSeconds < .05, `${label}: moving pickup contains a static leg hold`);
    assert.ok(value(outgoing, 'localAnkleMetresPerSecond') < value(incoming, 'localAnkleMetresPerSecond') * 1.25,
      `${label}: outgoing body blend spikes beyond this history's steady ankle velocity`);
    // This targets the demonstrated left/right late-pickup wrist fold. The
    // front case still measures about 102 degrees and is reported as a limit;
    // it is deliberately not described as passing a natural-grip test.
    if (!entry.name.includes('/front/')) assert.ok(pickup.maxRequiredForearmToFingerDegrees < 90,
      `${label}: corrected side pickup folds rigid hand extension past a right angle to forearm`);
  }
  console.log(JSON.stringify({ continuousPickupCases: pickups.length,
    continuousPickupFrames: pickups.reduce((sum, entry) => sum + entry.frames, 0),
    maxContinuousPickupWorldHandDegreesPerSecond: Math.max(...pickups.map(entry => value(entry.stages.pickup, 'worldHandDegreesPerSecond'))),
    maxContinuousPickupLocalWristDegreesPerSecond: Math.max(...pickups.map(entry => value(entry.stages.pickup, 'localWristDegreesPerSecond'))),
    maxContinuousPickupFrontRequiredBendDegrees: Math.max(...pickups.filter(entry => entry.name.includes('/front/'))
      .map(entry => entry.stages.pickup.maxRequiredForearmToFingerDegrees)),
    maxContinuousPickupSideRequiredBendDegrees: Math.max(...pickups.filter(entry => !entry.name.includes('/front/'))
      .map(entry => entry.stages.pickup.maxRequiredForearmToFingerDegrees)) }));
});

test('whole moving gather/release/recovery chains avoid orientation whip and premature hand holds', () => {
  const shots = audit.cases.filter(entry => entry.name.startsWith('shot/'));
  assert.equal(shots.length, 36, 'three charges cover walking/sprinting, moving/idle recovery and all three rates');
  for (const entry of shots) {
    const label = `${entry.name}/${entry.hz}`, { gather, release, recovery, incoming } = entry.stages;
    assert.ok(value(gather, 'worldHandDegreesPerSecond') < 1500, `${label}: gather world hand whip`);
    assert.ok(value(gather, 'worldFingerDegreesPerSecond') < 150, `${label}: gather hand bearing flips`);
    assert.ok(gather.maxForearmToFingerDegrees < 90, `${label}: gather folds hand extension past forearm right angle`);
    assert.ok(gather.maxRequiredTargetError < .015, `${label}: unchanged gather contact bound`);
    assert.ok(gather.minRequiredNormalDot >= .95, `${label}: unchanged gather normal bound`);
    assert.ok(release.maxReleasePalmHoldSeconds < .05, `${label}: hand prematurely holds during release action`);
    assert.ok(value(recovery, 'palmMetresPerSecond') < 7, `${label}: recovery palm snap across idle/start/loop`);
    assert.ok(value(recovery, 'worldHandDegreesPerSecond') < 850, `${label}: recovery hand rotation spike`);
    assert.ok(value(recovery, 'localAnkleMetresPerSecond') < value(incoming, 'localAnkleMetresPerSecond') * 1.25,
      `${label}: recovery body blend spikes beyond this history's steady ankle velocity`);
  }
  console.log(JSON.stringify({ continuousShotCases: shots.length,
    continuousShotFrames: shots.reduce((sum, entry) => sum + entry.frames, 0),
    maxContinuousGatherWorldHandDegreesPerSecond: Math.max(...shots.map(entry => value(entry.stages.gather, 'worldHandDegreesPerSecond'))),
    maxContinuousGatherLocalWristDegreesPerSecond: Math.max(...shots.map(entry => value(entry.stages.gather, 'localWristDegreesPerSecond'))),
    maxContinuousRecoveryPalmVelocity: Math.max(...shots.map(entry => value(entry.stages.recovery, 'palmMetresPerSecond'))),
    maxContinuousReleasePalmHoldSeconds: Math.max(...shots.map(entry => entry.stages.release.maxReleasePalmHoldSeconds)) }));
});
