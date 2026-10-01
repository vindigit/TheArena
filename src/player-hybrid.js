// One presentation-only locomotion experiment. The game supplies its transforms
// and bounce clock; this module never returns displacement or gameplay events.
export const HYBRID_BONES = ['root', 'pelvis', 'chest', 'neck', 'head', ...['left', 'right'].flatMap(side =>
  ['upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot'].map(part => `${side}_${part}`))];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const wrap = value => ((value % 1) + 1) % 1;
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function validateHybridAnimation(doc, bones) {
  if (doc.asset?.version !== '2.0' || doc.animations?.length !== 1 ||
      ['meshes', 'skins', 'images', 'textures', 'materials'].some(key => doc[key]?.length) ||
      doc.buffers?.some(buffer => buffer.uri) || doc.nodes?.length !== 17) {
    throw new Error('Expected one embedded animation and the 17-bone companion skeleton');
  }
  const names = new Set();
  for (const node of doc.nodes) {
    if (!HYBRID_BONES.includes(node.name) || names.has(node.name) || node.matrix ||
        node.rotation?.some((value, i) => Math.abs(value - (i === 3 ? 1 : 0)) > 1e-6) ||
        node.scale?.some(value => Math.abs(value - 1) > 1e-6)) throw new Error('Invalid companion bone frame');
    names.add(node.name);
    const translation = node.translation || [0, 0, 0];
    if (translation.length !== 3 || !translation.every(Number.isFinite)) throw new Error('Invalid bind translation');
    if (bones) {
      const position = bones.get(node.name)?.position;
      if (!position || translation.some((value, i) => Math.abs(value - position.getComponent(i)) > 1e-5)) {
        throw new Error('Animation bind pose does not match the player');
      }
    }
  }
  const animation = doc.animations[0], channels = new Set();
  for (const channel of animation.channels || []) {
    const name = doc.nodes[channel.target.node]?.name;
    const sampler = animation.samplers[channel.sampler];
    if (!name || name === 'root' || channel.target.path !== 'rotation' || channels.has(name) ||
        !sampler || !['LINEAR', undefined].includes(sampler.interpolation) ||
        doc.accessors[sampler.input]?.type !== 'SCALAR' || doc.accessors[sampler.output]?.type !== 'VEC4') {
      throw new Error('Animation must contain only unique non-root quaternion tracks');
    }
    channels.add(name);
  }
  if (channels.size !== 16) throw new Error('Animation must cover all 16 pose bones');
  const metadata = animation.extras;
  if (metadata?.version !== 1 || !Number.isFinite(metadata.strideDistance) ||
      metadata.strideDistance <= .2 || metadata.strideDistance > 10 ||
      !Array.isArray(metadata.contacts) || !metadata.contacts.length || metadata.contacts.length > 8 ||
      metadata.contacts.some((value, i, list) => !Number.isFinite(value) || value < 0 || value >= 1 ||
        (i > 0 && value <= list[i - 1]))) throw new Error('Invalid stride/contact metadata');
  for (const side of ['left', 'right']) {
    const intervals = metadata.plants?.[side];
    if (!Array.isArray(intervals) || !intervals.length || intervals.some(interval =>
      !Array.isArray(interval) || interval.length !== 2 || !interval.every(Number.isFinite) ||
      interval[0] < 0 || interval[1] > 1 || interval[0] >= interval[1])) throw new Error('Invalid foot-plant metadata');
  }
  return metadata;
}

export function createClipSampler(THREE, clip, metadata) {
  if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 5 || clip.tracks.length !== 16) {
    throw new Error('Invalid animation duration/tracks');
  }
  const tracks = new Map();
  for (const track of clip.tracks) {
    const name = track.name.replace(/\.quaternion$/, '');
    if (!HYBRID_BONES.includes(name) || name === 'root' || tracks.has(name) || !track.name.endsWith('.quaternion') ||
        track.getValueSize() !== 4 || track.times.length < 2 ||
        Math.abs(track.times[0]) > 1e-5 || Math.abs(track.times.at(-1) - clip.duration) > 1e-4) {
      throw new Error('Invalid quaternion sampler');
    }
    for (let i = 0; i < track.times.length; i++) {
      if (!Number.isFinite(track.times[i]) || (i && track.times[i] <= track.times[i - 1])) throw new Error('Invalid key times');
      const values = track.values.subarray(i * 4, i * 4 + 4);
      if (![...values].every(Number.isFinite) || Math.abs(Math.hypot(...values) - 1) > .002) throw new Error('Invalid quaternion key');
    }
    const first = new THREE.Quaternion().fromArray(track.values), last = new THREE.Quaternion().fromArray(track.values, track.values.length - 4);
    if (first.angleTo(last) > .08) throw new Error('Animation is not a clean loop');
    tracks.set(name, track.createInterpolant(new Float32Array(4)));
  }
  return {
    duration: clip.duration,
    sample(name, normalizedTime, target) {
      const interpolant = tracks.get(name);
      if (!interpolant) return target.identity();
      return target.fromArray(interpolant.evaluate(wrap(normalizedTime) * clip.duration)).normalize();
    },
    bodyPhase(dribblePhase) {
      const phase = Number.isFinite(dribblePhase) ? dribblePhase : 0;
      const cycles = (phase - Math.PI / 2) / (Math.PI * 2);
      const index = Math.floor(cycles), fraction = cycles - index;
      const contacts = metadata.contacts, current = ((index % contacts.length) + contacts.length) % contacts.length;
      const start = contacts[current], next = contacts[(current + 1) % contacts.length];
      const span = wrap(next - start) || 1;
      return wrap(start + fraction * span);
    },
  };
}

export function createHybridPose(THREE, visual, bones, clip, metadata, { restPositions } = {}) {
  const sampler = createClipSampler(THREE, clip, metadata);
  const rest = restPositions || new Map([...bones].map(([name, bone]) => [name, bone.position.clone()]));
  const rootPosition = new THREE.Vector3(), previousPosition = new THREE.Vector3();
  const delta = new THREE.Vector3(), velocity = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, -1);
  const groupQuaternion = new THREE.Quaternion(), inverse = new THREE.Quaternion(), sampled = new THREE.Quaternion();
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), marker = new THREE.Vector3();
  const start = new THREE.Vector3(), ankle = new THREE.Vector3(), ray = new THREE.Vector3(), pole = new THREE.Vector3();
  const elbow = new THREE.Vector3(), goal = new THREE.Vector3(), reach = new THREE.Vector3(), localMarker = new THREE.Vector3();
  const upperQ = new THREE.Quaternion(), lowerQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  let initialized = false, gaitPhase = 0, distance = 0, weight = 0, active = false;
  let lastDirection = new THREE.Vector3(0, 0, -1), movementSpeed = 0;
  const feet = {};
  for (const side of ['left', 'right']) {
    const upper = bones.get(`${side}_thigh`), lower = bones.get(`${side}_shin`), foot = bones.get(`${side}_foot`);
    let bindHeight = 0;
    for (let node = foot; node?.isBone; node = node.parent) bindHeight += rest.get(node.name)?.y || 0;
    feet[side] = { side, upper, lower, foot, a: rest.get(`${side}_shin`).length(), b: rest.get(`${side}_foot`).length(),
      upperAxis: rest.get(`${side}_shin`).clone().normalize(), lowerAxis: rest.get(`${side}_foot`).clone().normalize(),
      soleOffset: new THREE.Vector3(0, -bindHeight, 0), target: new THREE.Vector3(),
      wasStance: false, planted: false, plantWeight: 0, releaseReason: null, position: new THREE.Vector3() };
  }
  function release(reason) {
    for (const foot of Object.values(feet)) {
      foot.planted = false; foot.wasStance = false; foot.plantWeight = 0; foot.releaseReason = reason;
    }
  }
  function solveLeg(leg, target) {
    leg.upper.getWorldPosition(start);
    ankle.copy(target).sub(marker.copy(leg.soleOffset).applyQuaternion(groupQuaternion));
    ray.copy(ankle).sub(start);
    const length = ray.length(), maximum = leg.a + leg.b - .0001;
    if (length > maximum + .015) {
      leg.planted = false; leg.wasStance = false; leg.plantWeight = 0; leg.releaseReason = 'unreachable';
    }
    const d = clamp(length, .025, maximum);
    ray.normalize();
    const along = (leg.a * leg.a - leg.b * leg.b + d * d) / (2 * d);
    const height = Math.sqrt(Math.max(0, leg.a * leg.a - along * along));
    pole.copy(forward).addScaledVector(ray, -forward.dot(ray));
    if (pole.lengthSq() < 1e-6) pole.copy(right).addScaledVector(ray, -right.dot(ray));
    pole.normalize();
    elbow.copy(start).addScaledVector(ray, along).addScaledVector(pole, height);
    reach.copy(start).addScaledVector(ray, d);
    upperQ.setFromUnitVectors(leg.upperAxis, goal.copy(elbow).sub(start).normalize());
    leg.upper.parent.getWorldQuaternion(parentQ).invert();
    leg.upper.quaternion.copy(parentQ.multiply(upperQ));
    visual.updateWorldMatrix(true, true);
    lowerQ.setFromUnitVectors(leg.lowerAxis, goal.copy(reach).sub(elbow).normalize());
    leg.lower.quaternion.copy(inverse.copy(upperQ).invert().multiply(lowerQ));
    leg.foot.quaternion.copy(inverse.copy(lowerQ).invert().multiply(groupQuaternion));
    visual.updateWorldMatrix(true, true);
    leg.foot.localToWorld(leg.position.copy(leg.soleOffset));
  }
  function stanceAt(side) {
    const intervals = metadata.plants[side];
    const first = intervals[0], last = intervals.at(-1);
    // A stance that crosses the loop seam is one plant, rather than a second
    // feather/reacquisition at phase zero.
    if (intervals.length > 1 && first[0] === 0 && last[1] === 1 &&
        (gaitPhase <= first[1] || gaitPhase >= last[0])) {
      const phase = gaitPhase <= first[1] ? gaitPhase + 1 : gaitPhase;
      return { stance: true, weight: smooth(Math.min((phase - last[0]) / .025, (1 + first[1] - phase) / .025)) };
    }
    for (const [a, b] of intervals) if (gaitPhase >= a && gaitPhase <= b) {
      // A short feather at each end keeps plant acquisition visible and smooth.
      return { stance: true, weight: smooth(Math.min((gaitPhase - a) / .025, (b - gaitPhase) / .025)) };
    }
    return { stance: false, weight: 0 };
  }
  function update(dt, state = {}) {
    const safeDt = clamp(Number(dt) || 0, 0, .1), group = visual.parent;
    group.updateWorldMatrix(true, false);
    group.getWorldPosition(rootPosition); group.getWorldQuaternion(groupQuaternion);
    delta.copy(rootPosition).sub(previousPosition); delta.y = 0;
    if (!initialized || delta.length() > .5) {
      release(initialized ? 'reset' : 'initial'); delta.set(0, 0, 0); initialized = true;
      if (feet.left.releaseReason === 'reset') { gaitPhase = 0; distance = 0; weight = 0; }
    }
    previousPosition.copy(rootPosition);
    movementSpeed = safeDt > 0 ? delta.length() / safeDt : 0;
    velocity.copy(delta).multiplyScalar(safeDt > 0 ? 1 / safeDt : 0);
    active = state.action === 'move' && state.ballMode === 'dribble' && movementSpeed > .02;
    weight += ((active ? 1 : 0) - weight) * (1 - Math.exp(-safeDt * 30));
    if (!active) release('inactive');
    // Stop/start blends take about 100 ms. Other actions retain their exact
    // established procedural poses rather than inheriting a locomotion tail.
    if (state.ballMode !== 'dribble' || !['move', 'idle'].includes(state.action) || weight < .0001) {
      weight = 0; release('inactive'); return false;
    }
    if (active) {
      const travelled = delta.length(); distance += travelled;
      gaitPhase = wrap(gaitPhase + travelled / metadata.strideDistance);
      direction.copy(delta).normalize();
      const turn = direction.dot(lastDirection);
      if (turn < Math.cos(Math.PI / 4)) release('turn');
      lastDirection.copy(direction);
    }
    forward.set(0, 0, -1).applyQuaternion(groupQuaternion); right.set(1, 0, 0).applyQuaternion(groupQuaternion);
    const bodyPhase = sampler.bodyPhase(state.dribblePhase);
    for (const [name, bone] of bones) {
      if (name === 'root') continue;
      const leg = /_(thigh|shin|foot)$/.test(name);
      sampler.sample(name, leg ? gaitPhase : bodyPhase, sampled);
      bone.quaternion.slerp(sampled, weight * (leg ? .9 : .7));
    }
    // The imported clip supplies rotations. Grounded legs need a small visual
    // crouch to make the target rig's almost straight bind legs reachable.
    const pelvis = bones.get('pelvis'), chest = bones.get('chest');
    pelvis.position.y -= weight * clamp(.055 + movementSpeed * .018, .055, .16);
    const localVelocity = marker.copy(velocity).applyQuaternion(inverse.copy(groupQuaternion).invert());
    const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      clamp(localVelocity.z * .018, -.13, .13), 0, clamp(-localVelocity.x * .012, -.09, .09)));
    chest.quaternion.multiply(lean);
    visual.updateWorldMatrix(true, true);
    for (const leg of Object.values(feet)) {
      leg.foot.localToWorld(marker.copy(leg.soleOffset));
      localMarker.copy(marker); visual.worldToLocal(localMarker);
      // Reorient source stride immediately along actual input movement even
      // while the avatar's visual facing catches up to a direction change.
      const longitudinal = clamp(-localMarker.z, -.43, .43);
      goal.copy(rootPosition).addScaledVector(right, localMarker.x).addScaledVector(direction, longitudinal);
      const stance = active ? stanceAt(leg.side) : { stance: false, weight: 0 };
      const lift = stance.stance ? 0 : clamp(marker.y - rootPosition.y, 0, .16);
      goal.y = rootPosition.y + lift;
      if (stance.stance && !leg.wasStance) { leg.target.copy(goal); leg.releaseReason = null; }
      leg.wasStance = stance.stance; leg.plantWeight = stance.weight * weight;
      leg.planted = stance.stance && leg.plantWeight > .995;
      if (stance.stance) goal.lerp(leg.target, leg.plantWeight);
      solveLeg(leg, goal);
    }
    return true;
  }
  function diagnostics() {
    return { active, weight, gaitPhase, distance, velocity: velocity.toArray(), strideDistance: metadata.strideDistance,
      feet: Object.fromEntries(Object.entries(feet).map(([side, foot]) => [side, {
        planted: foot.planted, plantWeight: foot.plantWeight, target: foot.wasStance ? foot.target.toArray() : null,
        position: foot.position.toArray(), soleOffset: foot.soleOffset.toArray(), releaseReason: foot.releaseReason,
      }])) };
  }
  return { update, diagnostics, get active() { return active; }, get weight() { return weight; } };
}
