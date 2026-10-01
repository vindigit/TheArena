import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_LUKE_RIG_CONTRACT,
  REQUIRED_BONES,
  STAGED_PLAYER_RIG_CONTRACT,
  normalizePlayerBoneName,
  validateStagedPlayerRigContract,
} from '../src/player.js';

const valid = (overrides = {}) => ({
  boneNames: [...REQUIRED_BONES], bytes: 400_000, triangles: 5_000,
  height: 2.05, meshCount: 1, skinCount: 1, ...overrides,
});

test('v2 contract pins the exact 22 requested plain runtime names', () => {
  assert.equal(LEGACY_LUKE_RIG_CONTRACT, 'legacy-luke-v1');
  assert.equal(STAGED_PLAYER_RIG_CONTRACT, 'game-humanoid-v2');
  assert.deepEqual(REQUIRED_BONES, [
    'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
    'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
  ]);
  assert.equal(validateStagedPlayerRigContract(valid()).contract, STAGED_PLAYER_RIG_CONTRACT);
});

test('mixamorig source prefix normalizes to plain game names', () => {
  const prefixed = REQUIRED_BONES.map(name => `mixamorig:${name}`);
  const result = validateStagedPlayerRigContract(valid({ boneNames: prefixed }));
  assert.deepEqual(result.bones, REQUIRED_BONES);
  assert.equal(normalizePlayerBoneName('mixamorig:LeftHand'), 'LeftHand');
});

test('v2 rejects missing shoulder, three-spine, and toe articulation', () => {
  for (const bone of ['LeftShoulder', 'Spine1', 'RightToeBase']) {
    assert.throws(() => validateStagedPlayerRigContract(valid({
      boneNames: REQUIRED_BONES.filter(name => name !== bone),
    })), new RegExp(bone));
  }
});

test('v2 rejects extra, duplicate, and legacy 17-bone inventories', () => {
  assert.throws(() => validateStagedPlayerRigContract(valid({ boneNames: [...REQUIRED_BONES, 'Root'] })), /extra \[Root\]/);
  assert.throws(() => validateStagedPlayerRigContract(valid({ boneNames: [...REQUIRED_BONES.slice(0, -1), 'Hips'] })), /duplicate normalized/);
  const legacy = ['root', 'pelvis', 'chest', 'neck', 'head', 'left_upper_arm', 'left_forearm', 'left_hand',
    'right_upper_arm', 'right_forearm', 'right_hand', 'left_thigh', 'left_shin', 'left_foot',
    'right_thigh', 'right_shin', 'right_foot'];
  assert.throws(() => validateStagedPlayerRigContract(valid({ boneNames: legacy })), /game-humanoid-v2 .*missing/);
});

test('v2 rejects structural and budget violations', () => {
  assert.throws(() => validateStagedPlayerRigContract(valid({ bytes: 1_500_001 })), /exceeds 1.5 MB/);
  assert.throws(() => validateStagedPlayerRigContract(valid({ triangles: 8_001 })), /1-8000/);
  assert.throws(() => validateStagedPlayerRigContract(valid({ height: 1.89 })), /1.9-2.2 m/);
  assert.throws(() => validateStagedPlayerRigContract(valid({ meshCount: 2 })), /exactly one skinned mesh/);
  assert.throws(() => validateStagedPlayerRigContract(valid({ skinCount: 2 })), /exactly one skin/);
});
