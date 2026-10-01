import source from '../art/animation/luke-motion-v1.json' with { type: 'json' };

export const LUKE_MOTION_PACK = source;
export const LUKE_JOINT_OWNERSHIP = Object.freeze({
  gameplay: ['player.group.translation', 'player.group.facing', 'player.group.jump'],
  adapter: ['pelvis', 'chest', 'neck', 'head', 'right_thigh', 'right_shin', 'right_foot',
    'left_thigh', 'left_shin', 'left_foot', 'right_upper_arm', 'right_forearm', 'right_hand',
    'left_upper_arm', 'left_forearm', 'left_hand'],
  restOnly: ['root'],
  order: ['canonical-rest-reset', 'authored-body-sample', 'body-handoff', 'ball-surface-arm-IK', 'attachment-refresh'],
});
export const LUKE_CLIPS = Object.freeze(Object.entries(source.clips).map(([name, clip]) =>
  Object.freeze({ name, duration: clip.duration, loop: clip.loop, joints: [...clip.joints] })));
const vectorChannels = ['rightTarget', 'leftTarget', 'rightWrist', 'leftWrist', 'rightPole', 'leftPole'];
const scalarChannels = ['rightHip', 'rightKnee', 'leftHip', 'leftKnee', 'pelvisX', 'chestX', 'chestY', 'headX'];
const channels = [...scalarChannels, ...vectorChannels];
const requiredClips = ['idle-ready', 'locomotion', 'locomotion-start', 'locomotion-stop',
  'stationary-dribble', 'moving-dribble', 'pickup', 'gather', 'release-follow-through', 'layup', 'dunk'];
const targetHash = '9eedd88b85386084bc1b19ab70d000376d2ab750dfb6d129bb5dd264767a9135';
export function validateLukeMotionPack(pack = source) {
  const fail = message => { throw new Error(`Luke motion contract: ${message}`); };
  if (pack.version !== 1 || pack.id !== 'luke-motion-v1') fail('unsupported source version');
  if (pack.targetAsset !== 'public/assets/models/player/luke-player-v1.glb' || pack.targetSha256 !== targetHash ||
      pack.rigContract !== 'docs/rig/luke-rig-contract.json') fail('exact Luke target pin differs');
  if (pack.inPlace !== true || pack.units !== 'meters' || pack.axes?.up !== '+Y' || pack.axes?.forward !== '-Z' ||
      pack.interpolation !== 'smoothstep') fail('in-place axes or interpolation differs');
  if (!pack.clips || Object.keys(pack.clips).length !== requiredClips.length || requiredClips.some(name => !pack.clips[name]))
    fail('incomplete clip inventory');
  const owned = LUKE_JOINT_OWNERSHIP.adapter;
  for (const [name, clip] of Object.entries(pack.clips)) {
    if (!Number.isFinite(clip.duration) || clip.duration <= 0 || typeof clip.loop !== 'boolean') fail(`${name}: timing`);
    if (!Array.isArray(clip.joints) || clip.joints.length !== owned.length ||
        new Set(clip.joints).size !== owned.length || owned.some(joint => !clip.joints.includes(joint)))
      fail(`${name}: joints must exactly match adapter ownership; root motion is forbidden`);
    if (!Array.isArray(clip.keyframes) || clip.keyframes.length < 2) fail(`${name}: keyframes`);
    let previous = -1;
    for (const keyframe of clip.keyframes) {
      if (!Number.isFinite(keyframe.time) || keyframe.time < 0 || keyframe.time > 1 || keyframe.time <= previous)
        fail(`${name}: normalized keyframe times must increase`);
      previous = keyframe.time;
      if (!keyframe.values || Object.keys(keyframe.values).length !== channels.length ||
          channels.some(channel => !(channel in keyframe.values))) fail(`${name}: undeclared or missing channel`);
      for (const channel of channels) {
        const value = keyframe.values[channel];
        if (vectorChannels.includes(channel) ? !Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)
          : !Number.isFinite(value)) fail(`${name}: non-finite ${channel}`);
      }
    }
    const first = clip.keyframes[0], last = clip.keyframes.at(-1);
    if (first.time !== 0 || last.time !== 1) fail(`${name}: endpoints must cover normalized duration`);
    if (clip.loop && channels.some(channel => JSON.stringify(first.values[channel]) !== JSON.stringify(last.values[channel])))
      fail(`${name}: loop endpoints differ`);
  }
  return { clips: requiredClips.length, joints: owned.length, targetSha256: targetHash, inPlace: true };
}
validateLukeMotionPack();

// Original Luke-specific control clips, not bone-name retargeting. Body channels
// are canonical-local angular deltas, except hip channels describe world thigh
// pitch before pelvis-hinge compensation. Hand targets are asset-local meters.
export function sampleLukeMotion(name, normalizedTime = 0) {
  const clip = source.clips[name];
  if (!clip) throw new Error(`Unknown Luke motion clip: ${name}`);
  let t = Number.isFinite(normalizedTime) ? normalizedTime : 0;
  t = clip.loop ? ((t % 1) + 1) % 1 : Math.max(0, Math.min(1, t));
  let next = clip.keyframes.findIndex(keyframe => keyframe.time > t);
  if (next < 0) next = clip.keyframes.length - 1;
  const a = clip.keyframes[Math.max(0, next - 1)], b = clip.keyframes[next];
  let alpha = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
  alpha = Math.max(0, Math.min(1, alpha)); alpha = alpha * alpha * (3 - 2 * alpha);
  return Object.fromEntries(channels.map(channel => [channel, Array.isArray(a.values[channel])
    ? a.values[channel].map((value, i) => value + (b.values[channel][i] - value) * alpha)
    : a.values[channel] + (b.values[channel] - a.values[channel]) * alpha]));
}
export function selectLukeMotion(state = {}) {
  if (Number.isFinite(state.pickupProgress)) return 'pickup';
  if (state.action === 'shoot') return Number.isFinite(state.releaseProgress) || state.ballMode === 'flight'
    ? 'release-follow-through' : 'gather';
  if (state.action === 'layup' || state.action === 'dunk') return state.action;
  const moving = (Number(state.speed) || 0) > .08;
  if (state.motionTransition === 'start') return 'locomotion-start';
  if (state.motionTransition === 'stop') return 'locomotion-stop';
  if (state.ballMode === 'dribble') return moving ? 'moving-dribble' : 'stationary-dribble';
  return moving ? 'locomotion' : 'idle-ready';
}
