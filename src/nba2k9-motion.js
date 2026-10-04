// Recovered native rotations are the body pose. Gameplay owns translation,
// facing, jump height, possession and release clocks; contact IK adapts the
// recovered motions to the live ball without interpreting unknown source events.
const clamp = (v, low = 0, high = 1) => Math.max(low, Math.min(high, Number(v) || 0));
const smooth = value => { const v = clamp(value); return v * v * (3 - 2 * v); };
const finite = values => Array.isArray(values) && values.length === 3 && values.every(Number.isFinite);

export const RECOVERED_PRESENTATION = Object.freeze({
  shootDuration: .7, shootRelease: .2, shootLanding: .4,
  layupRelease: .59, dunkRelease: .57,
});

export function createRecoveredPoseAdapter(THREE, visual, bones, anchors, clips, config = {}) {
  if (!visual.parent) throw new Error('Recovered visual must have a gameplay parent before posing');
  const get = name => bones.get(name), V = (...values) => new THREE.Vector3(...values);
  const Q = () => new THREE.Quaternion(), root = visual.parent;
  for (const name of ['root', 'thorax', 'head', 'lhumerus', 'lelbow', 'lhand', 'rhumerus', 'relbow', 'rhand',
    'lfemur', 'ltibia', 'lfoot', 'rfemur', 'rtibia', 'rfoot']) {
    if (!get(name)) throw new Error(`Missing recovered player joint: ${name}`);
  }
  const rest = new Map([...bones].map(([name, bone]) => [name, {
    position: bone.position.clone(), rotation: bone.quaternion.clone(), scale: bone.scale.clone(),
  }]));
  const baseVisual = { position: visual.position.clone(), quaternion: visual.quaternion.clone(), scale: visual.scale.clone() };
  const clipMap = new Map();
  for (const clip of clips || []) {
    const tracks = [];
    for (const track of clip.tracks || []) {
      const target = THREE.PropertyBinding.parseTrackName(track.name);
      const name = target.objectName === 'bones' ? target.objectIndex : target.nodeName;
      // Source trajectories and local translation tracks never move the player.
      if (target.propertyName !== 'quaternion') continue;
      if (!get(name)) throw new Error(`Animation ${clip.name} targets an unavailable joint: ${name}`);
      tracks.push({ bone: get(name), interpolant: track.createInterpolant(), name });
    }
    if (!tracks.length || !(clip.duration >= 0)) throw new Error(`No recovered rotations in ${clip.name}`);
    if (clipMap.has(clip.name)) throw new Error(`Duplicate recovered motion: ${clip.name}`);
    clipMap.set(clip.name, { source: clip, tracks });
  }
  if (!clipMap.size) throw new Error('Recovered player requires a compatible rotation bundle');

  const mappings = config.motions || config.motion || config.mapping || {};
  const aliases = { idle: ['idle', 'ready', 'stationary_dribble'], move: ['move', 'run', 'walk'],
    dribble: ['dribble', 'moving_dribble'], gather: ['gather'], shoot: ['shoot', 'shot'], layup: ['layup'], dunk: ['dunk'] };
  const motions = {};
  for (const [kind, names] of Object.entries(aliases)) {
    const mapping = mappings[kind] ?? names.find(name => clipMap.has(name));
    const spec = typeof mapping === 'string' ? { clip: mapping } : mapping;
    if (!spec) throw new Error(`Missing recovered gameplay mapping: ${kind}`);
    const clip = clipMap.get(spec.clip);
    if (!clip) throw new Error(`Missing mapped recovered clip: ${spec.clip}`);
    const start = clamp(spec.start ?? 0, 0, clip.source.duration);
    const end = clamp(spec.end ?? clip.source.duration, start, clip.source.duration);
    motions[kind] = { ...spec, clip, start, end, duration: Math.max(1e-5, end - start),
      loop: spec.loop ?? ['idle', 'move', 'dribble'].includes(kind) };
  }

  const meshes = [];
  visual.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  const skeletons = new Set(meshes.map(mesh => mesh.skeleton));
  const rootInverse = new THREE.Matrix4();
  const updateMatrices = () => {
    visual.updateWorldMatrix(true, true);
    rootInverse.copy(root.matrixWorld).invert();
    // updateWorldMatrix alone does not run SkinnedMesh's bind-matrix refresh.
    // That refresh is essential when native-unit skins sit under normalization.
    for (const mesh of meshes) mesh.updateMatrixWorld(true);
    for (const skeleton of skeletons) skeleton.update();
  };
  const worldPosition = bone => bone.getWorldPosition(V());
  const worldRotation = bone => bone.getWorldQuaternion(Q());
  const parentPoint = point => point.clone().applyMatrix4(rootInverse);
  const bodyHeight = config.height || new THREE.Box3().setFromObject(visual).getSize(V()).y || 2.05;
  updateMatrices();

  // Derive palm attachments from the shipped hand skin in its original bind
  // frame. Offsets remain in source units; matrix transforms carry normalization.
  const palms = {};
  const footVertices = { left: [], right: [] };
  for (const [side, prefix] of [['left', 'l'], ['right', 'r']]) {
    const hand = get(`${prefix}hand`), points = [], wristPoints = [], handSamples = [], wristSamples = [];
    for (const mesh of meshes) {
      const weights = mesh.geometry.attributes.skinWeight, indices = mesh.geometry.attributes.skinIndex;
      const handIndex = mesh.skeleton.bones.indexOf(hand);
      const wristIndex = mesh.skeleton.bones.indexOf(get(`${prefix}wrist`));
      const feet = new Set(mesh.skeleton.bones.map((bone, index) =>
        [`${prefix}foot`, `${prefix}toes`].includes(bone.name) ? index : -1).filter(index => index >= 0));
      if (!weights || !indices) continue;
      for (let i = 0; i < weights.count; i++) {
        let handWeight = 0, wristWeight = 0, footWeight = 0;
        for (let k = 0; k < weights.itemSize; k++) {
          const index = indices.getComponent(i, k), weight = weights.getComponent(i, k);
          if (index === handIndex) handWeight += weight;
          if (index === wristIndex) wristWeight += weight;
          if (feet.has(index)) footWeight += weight;
        }
        if (handIndex >= 0 && handWeight > .5) {
          points.push(hand.worldToLocal(mesh.getVertexPosition(i, V()).applyMatrix4(mesh.matrixWorld)));
          handSamples.push({ mesh, index: i });
        }
        if (wristIndex >= 0 && wristWeight > .5) {
          wristPoints.push(hand.worldToLocal(mesh.getVertexPosition(i, V()).applyMatrix4(mesh.matrixWorld)));
          wristSamples.push({ mesh, index: i });
        }
        if (footWeight > .5) footVertices[side].push({ mesh, index: i });
      }
    }
    // Native hand skin belongs to the wrist joint in some assemblies. Use its
    // distal vertices around the terminal hand joint rather than the forearm.
    const hasHandSkin = points.length > 0;
    let samples = handSamples;
    if (!hasHandSkin && wristPoints.length) {
      const radius = get(`${prefix}hand`).position.length() * .65;
      samples = [];
      wristPoints.forEach((point, index) => {
        if (point.length() < radius) { points.push(point); samples.push(wristSamples[index]); }
      });
    }
    const attachmentBone = !points.length ? hand : get(`${prefix}wrist`);
    // The source hand-owned convention takes precedence when present. In the
    // wrist-owned convention points were converted above from distal wrist skin.
    const owner = config.palms?.[side]?.bone ? get(config.palms[side].bone) : hasHandSkin ? hand : attachmentBone;
    if (!owner) throw new Error(`Missing configured ${side} palm attachment joint`);
    const supplied = config.palms?.[side]?.offset;
    const offset = finite(supplied) ? V(...supplied) : points.length
      ? points.reduce((sum, point) => sum.add(point), V()).multiplyScalar(1 / points.length) : V();
    if (owner !== hand && !finite(supplied)) owner.worldToLocal(hand.localToWorld(offset));
    const attachment = new THREE.Object3D(); attachment.name = `recovered-${side}-physical-palm`;
    attachment.position.copy(offset); owner.add(attachment);
    palms[side] = { hand, owner, attachment, offset, samples, inferred: !finite(supplied), sampledVertices: points.length };
  }

  let age = 0, kind = null, blendAge = 1, blendFrom = new Map(), heldBall = null;
  let footLocks = {}, contact = {}, diagnostic = {}, lastState = {};
  const palmWorld = side => palms[side].attachment.getWorldPosition(V());
  function resetNativePose() {
    visual.position.copy(baseVisual.position);
    visual.quaternion.copy(baseVisual.quaternion);
    visual.scale.copy(baseVisual.scale);
    for (const [name, bone] of bones) {
      bone.position.copy(rest.get(name).position);
      bone.quaternion.copy(rest.get(name).rotation);
      bone.scale.copy(rest.get(name).scale);
    }
  }
  function twoBone(upper, lower, effector, target, pole) {
    updateMatrices();
    const start = worldPosition(upper), joint = worldPosition(lower), end = worldPosition(effector);
    const a = start.distanceTo(joint), b = joint.distanceTo(end);
    if (a < 1e-7 || b < 1e-7) return;
    const axis = target.clone().sub(start), targetDistance = axis.length();
    if (targetDistance < 1e-7) axis.copy(end).sub(start);
    if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0);
    axis.normalize();
    const distance = clamp(targetDistance, Math.abs(a - b) + 1e-5, a + b - 1e-5);
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const bend = pole.clone().sub(start);
    bend.addScaledVector(axis, -bend.dot(axis));
    if (bend.lengthSq() < 1e-10) {
      bend.copy(V(0, 0, -1).transformDirection(root.matrixWorld));
      bend.addScaledVector(axis, -bend.dot(axis));
      if (bend.lengthSq() < 1e-10) bend.copy(V(1, 0, 0)).addScaledVector(axis, -axis.x);
    }
    bend.normalize();
    const mid = start.clone().addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
    const goal = start.clone().addScaledVector(axis, distance);
    const upperQ = Q().setFromUnitVectors(joint.clone().sub(start).normalize(), mid.clone().sub(start).normalize()).multiply(worldRotation(upper));
    upper.quaternion.copy(worldRotation(upper.parent).invert().multiply(upperQ));
    updateMatrices();
    const lowerQ = Q().setFromUnitVectors(worldPosition(effector).sub(worldPosition(lower)).normalize(), goal.sub(mid).normalize()).multiply(worldRotation(lower));
    lower.quaternion.copy(worldRotation(lower.parent).invert().multiply(lowerQ));
    updateMatrices();
  }
  function solveArm(side, ball, surfaceDirection, weight = 1, override = null, required = weight > .99) {
    const prefix = side === 'left' ? 'l' : 'r', { attachment } = palms[side];
    const radius = Math.max(.01, Number(lastState.ballRadius) || .12);
    const surface = override || ball.clone().addScaledVector(surfaceDirection, radius);
    const current = palmWorld(side);
    const target = current.clone().lerp(surface, clamp(weight));
    const pole = worldPosition(get(`${prefix}elbow`));
    const outward = V(side === 'right' ? 1 : -1, 0, .25).transformDirection(root.matrixWorld);
    pole.addScaledVector(outward, bodyHeight * .035);
    twoBone(get(`${prefix}humerus`), get(`${prefix}elbow`), attachment, target, pole);
    updateMatrices();
    const actual = palmWorld(side);
    const samples = palms[side].samples;
    const displayed = samples.length ? samples.reduce((sum, { mesh, index }) =>
      sum.add(mesh.getVertexPosition(index, V()).applyMatrix4(mesh.matrixWorld)), V()).multiplyScalar(1 / samples.length) : actual;
    contact[side] = { required, error: actual.distanceTo(surface),
      ballSurfaceError: Math.abs(actual.distanceTo(ball) - radius),
      displayedPalmError: displayed.distanceTo(surface), displayedAttachmentError: displayed.distanceTo(actual),
      actual: parentPoint(actual).toArray(), target: parentPoint(surface).toArray() };
  }
  function soleMinimum(side) {
    const vertices = footVertices[side];
    if (!vertices.length) return parentPoint(worldPosition(get(side === 'left' ? 'lfoot' : 'rfoot'))).y;
    let minimum = Infinity;
    const point = V();
    for (const { mesh, index } of vertices) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(rootInverse);
      minimum = Math.min(minimum, point.y);
    }
    return minimum;
  }
  function groundFeet(state, dt) {
    updateMatrices();
    const soles = { left: soleMinimum('left'), right: soleMinimum('right') };
    const lowest = Math.min(soles.left, soles.right);
    // The game jump is already on the parent. Normalize native pelvis height to
    // the parent's floor plane; never add an animation's trajectory jump twice.
    const localCorrection = .002 - lowest;
    const correctionWorld = V(0, localCorrection, 0).applyQuaternion(worldRotation(root));
    const parentOrigin = visual.parent.getWorldPosition(V());
    const correction = visual.parent.worldToLocal(parentOrigin.clone().add(correctionWorld));
    visual.position.add(correction);
    updateMatrices();
    const planted = (Number(state.jump) || 0) < .012 && (Number(state.speed) || 0) < .15;
    const result = {};
    for (const [side, prefix] of [['left', 'l'], ['right', 'r']]) {
      const foot = get(`${prefix}foot`), before = worldPosition(foot);
      if (!planted) delete footLocks[side];
      if (planted && !footLocks[side]) footLocks[side] = { position: before.clone(), rotation: worldRotation(foot), age: 0 };
      const lock = footLocks[side];
      if (lock) {
        lock.age += dt;
        const reach = worldPosition(get(`${prefix}femur`)).distanceTo(worldPosition(get(`${prefix}tibia`)))
          + worldPosition(get(`${prefix}tibia`)).distanceTo(before);
        if (worldPosition(get(`${prefix}femur`)).distanceTo(lock.position) > reach * .98
          || before.distanceTo(lock.position) > bodyHeight * .22) delete footLocks[side];
        else {
          twoBone(get(`${prefix}femur`), get(`${prefix}tibia`), foot, lock.position,
            worldPosition(get(`${prefix}tibia`)).addScaledVector(V(0, 0, -1).transformDirection(root.matrixWorld), bodyHeight * .06));
          foot.quaternion.copy(worldRotation(foot.parent).invert().multiply(lock.rotation));
          updateMatrices();
        }
      }
      result[side] = { locked: !!footLocks[side], displayedSoleMinY: soleMinimum(side),
        error: footLocks[side] ? worldPosition(foot).distanceTo(footLocks[side].position) : 0 };
    }
    // Preserve the floor when a planted ankle correction rotates a shoe.
    const finalMin = Math.min(soleMinimum('left'), soleMinimum('right'));
    if (finalMin < 0) visual.position.y -= finalMin;
    updateMatrices();
    for (const side of ['left', 'right']) result[side].displayedSoleMinY = soleMinimum(side);
    return result;
  }
  function selectMotion(state) {
    if (state.action === 'layup' || state.action === 'dunk') return state.action;
    if (state.charging) return 'gather';
    if (state.action === 'shoot' && Number.isFinite(state.shootElapsed)) return 'shoot';
    if ((Number(state.speed) || 0) > .15) return state.ballMode === 'dribble' ? 'dribble' : 'move';
    return 'idle';
  }
  function applyBallStance(state, footInfo) {
    if (state.ballMode !== 'dribble') return 0;
    const upper = get('rhumerus'), elbow = get('relbow'), palm = palms.right.attachment;
    const reach = worldPosition(upper).distanceTo(worldPosition(elbow)) + worldPosition(elbow).distanceTo(worldPosition(palm));
    // A recovered standing gesture may be too upright to reach the dribble
    // peak. Lower the pelvis only as far as its actual arm lengths require,
    // then solve both legs back onto the sampled shoes, preserving gait.
    const shoulder = parentPoint(worldPosition(upper));
    const ballX = finite(state.ballLocal) ? state.ballLocal[0] : .42;
    const ballZ = finite(state.ballLocal) ? state.ballLocal[2] : -.16;
    const horizontalSq = (shoulder.x - ballX) ** 2 + (shoulder.z - ballZ) ** 2;
    const verticalReach = Math.sqrt(Math.max(.001, reach * reach - horizontalSq)) * .94;
    const lowering = clamp(shoulder.y - bodyHeight * .44 - verticalReach, 0, bodyHeight * .10);
    if (lowering < .0001) return 0;
    const feet = Object.fromEntries(['l', 'r'].map(prefix => [prefix,
      { position: worldPosition(get(`${prefix}foot`)), rotation: worldRotation(get(`${prefix}foot`)) }]));
    const scale = get('root').parent.getWorldScale(V()).y;
    get('root').position.y -= lowering / Math.max(1e-7, scale);
    updateMatrices();
    for (const [side, prefix] of [['left', 'l'], ['right', 'r']]) {
      const foot = get(`${prefix}foot`);
      twoBone(get(`${prefix}femur`), get(`${prefix}tibia`), foot, feet[prefix].position,
        worldPosition(get(`${prefix}tibia`)).addScaledVector(V(0, 0, -1).transformDirection(root.matrixWorld), bodyHeight * .08));
      foot.quaternion.copy(worldRotation(foot.parent).invert().multiply(feet[prefix].rotation));
      updateMatrices();
      footInfo[side].displayedSoleMinY = soleMinimum(side);
    }
    return lowering;
  }
  function sourceTime(motion, state) {
    let progress;
    if (kind === 'shoot') {
      const elapsed = Math.max(0, state.shootElapsed || 0), release = clamp(motion.release ?? motion.start + motion.duration * .4, motion.start, motion.end);
      return elapsed <= RECOVERED_PRESENTATION.shootRelease
        ? motion.start + (release - motion.start) * clamp(elapsed / RECOVERED_PRESENTATION.shootRelease)
        : release + (motion.end - release) * clamp((elapsed - RECOVERED_PRESENTATION.shootRelease)
          / (RECOVERED_PRESENTATION.shootDuration - RECOVERED_PRESENTATION.shootRelease));
    }
    if (kind === 'gather') progress = clamp((state.gatherElapsed || 0) / .5);
    else if (kind === 'layup' || kind === 'dunk') {
      progress = clamp(state.shotProgress);
      if (Number.isFinite(motion.release)) {
        const releaseProgress = RECOVERED_PRESENTATION[`${kind}Release`];
        const release = clamp(motion.release, motion.start, motion.end);
        return progress <= releaseProgress
          ? motion.start + (release - motion.start) * progress / releaseProgress
          : release + (motion.end - release) * (progress - releaseProgress) / (1 - releaseProgress);
      }
    }
    else if (kind === 'dribble' && Number.isFinite(state.dribblePhase)) {
      progress = ((state.dribblePhase / (Math.PI * 2) - .25) % 1 + 1) % 1;
    } else progress = age / motion.duration;
    if (motion.loop) progress = (progress % 1 + 1) % 1;
    else progress = clamp(progress);
    return motion.start + progress * motion.duration;
  }
  function update(dt = 1 / 60, state = {}) {
    dt = clamp(dt, 0, .1); lastState = state; heldBall = null; contact = {};
    const next = selectMotion(state);
    if (next !== kind) {
      blendFrom = new Map([...bones].map(([name, bone]) => [name, bone.quaternion.clone()]));
      if (kind === null) blendFrom.clear();
      kind = next; age = 0; blendAge = 0;
      if (next === 'move' || next === 'dribble' || next === 'layup' || next === 'dunk') footLocks = {};
    }
    const motion = motions[kind];
    age += dt * (motion.rate || Math.max(.65, Math.min(1.6, (state.speed || 0) / 3 || 1)));
    blendAge += dt;
    resetNativePose();
    const time = sourceTime(motion, state);
    for (const track of motion.clip.tracks) track.bone.quaternion.fromArray(track.interpolant.evaluate(time)).normalize();
    // Remove native heading while retaining lean; the gameplay root already
    // faces the hoop/movement direction and owns any requested turn.
    const nativeRoot = get('root'), forward = V(0, 0, 1).applyQuaternion(nativeRoot.quaternion);
    if (Math.hypot(forward.x, forward.z) > 1e-6)
      nativeRoot.quaternion.premultiply(Q().setFromAxisAngle(V(0, 1, 0), -Math.atan2(forward.x, forward.z)));
    const blend = smooth(blendAge / (kind === 'shoot' ? .065 : .12));
    if (blend < 1) for (const [name, bone] of bones) {
      const from = blendFrom.get(name);
      if (from) bone.quaternion.copy(from.clone().slerp(bone.quaternion, blend));
    }
    const footInfo = groundFeet(state, dt), stanceLowering = applyBallStance(state, footInfo);
    if (finite(state.ballLocal) && ['dribble', 'gather'].includes(state.ballMode)) {
      const ball = root.localToWorld(V(...state.ballLocal));
      if (state.ballMode === 'dribble') {
        const phase = (((state.dribblePhase || 0) / (Math.PI * 2) - .25) % 1 + 1) % 1;
        const push = phase < .18 ? 1 : phase < .32 ? 1 - smooth((phase - .18) / .14)
          : phase > .87 ? smooth((phase - .87) / .13) : 0;
        const hand = palmWorld('right'), ready = parentPoint(hand);
        ready.x = state.ballLocal[0]; ready.z = state.ballLocal[2];
        ready.y = Math.max(bodyHeight * .5, state.ballLocal[1] + (state.ballRadius || .12));
        const surface = ball.clone().add(V(0, state.ballRadius || .12, 0));
        const target = root.localToWorld(ready).lerp(surface, push);
        solveArm('right', ball, V(0, 1, 0), 1, target, push > .99);
      } else {
        const acquired = kind === 'shoot' ? 1 : smooth((state.gatherElapsed || 0) / .16);
        solveArm('right', ball, V(0, -1, 0), acquired);
        const guide = kind === 'shoot' ? 1 - smooth(((state.shootElapsed || 0) - .12) / .08) : acquired;
        if (guide > 0) solveArm('left', ball, V(-1, 0, 0).transformDirection(root.matrixWorld), guide);
      }
    }
    if (['layup', 'dunk'].includes(kind) && state.ballMode === 'finish') {
      const nativeBall = parentPoint(palmWorld('right').add(V(0, state.ballRadius || .12, 0)));
      if (finite(state.finishOriginLocal)) nativeBall.lerpVectors(V(...state.finishOriginLocal), nativeBall.clone(), smooth((state.finishElapsed || 0) / .16));
      heldBall = nativeBall;
      const ball = root.localToWorld(nativeBall.clone());
      solveArm('right', ball, V(0, -1, 0));
      // The selected recovered finish is right-handed. Preserve its free arm;
      // inventing a second-hand grip can demand a reach outside the source rig.
    }
    updateMatrices();
    anchors.rightHand.position.copy(parentPoint(palmWorld('right')));
    anchors.leftHand.position.copy(parentPoint(palmWorld('left')));
    anchors.chest.position.copy(parentPoint(worldPosition(get('thorax'))));
    anchors.head.position.copy(parentPoint(worldPosition(get('head'))));
    diagnostic = { owner: 'nba2k9-recovered-adapted', clip: kind, sourceClip: motion.clip.source.name,
      sourceTime: time, active: true, rootMotion: 'gameplay', heading: 'gameplay',
      sourceMapping: motion.interpretation || 'Recovered pose adapted to gameplay; source action meaning unverified',
      contact, footInfo, stanceLowering, palms: Object.fromEntries(Object.entries(palms).map(([side, palm]) => [side,
        { bone: palm.owner.name, offset: palm.offset.toArray(), inferred: palm.inferred, sampledVertices: palm.sampledVertices }])) };
  }
  return { update,
    reset() { kind = null; age = 0; blendAge = 1; blendFrom.clear(); footLocks = {}; heldBall = null; contact = {}; diagnostic = {}; resetNativePose(); },
    diagnostics: () => diagnostic,
    getHeldBallLocal: (target = V()) => heldBall ? target.copy(heldBall) : null,
    getPresentationConfig: () => RECOVERED_PRESENTATION,
  };
}
