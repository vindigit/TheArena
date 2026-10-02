// Presentation-only skeletal pose adapter. Gameplay owns root translation,
// facing, jump height, shot timing and ball physics in main.js.
import { LUKE_MOTION_PACK, LUKE_CLIPS, LUKE_JOINT_OWNERSHIP, sampleLukeMotion, selectLukeMotion } from './luke-motion.js';
// Measured rigid palm faces on the unchanged canonical mesh. These physical
// contact points are separate from the pinned gameplay attachment convention.
export const LUKE_PHYSICAL_PALMS = Object.freeze({
  right: { offset: [.085, -.010420431611832814, 0], triangle: [10, 22, 12], normal: [.06328680701153797, -.95874679214998, .27712699002516405] },
  left: { offset: [-.095, -.010536930364739572, 0], triangle: [3266, 3211, 3204], normal: [.18578951385363535, -.9821455594914199, -.029535682035727248] },
});
export function createPoseAdapter(THREE, visual, bones, anchors) {
  const get = name => bones.get(name);
  const rest = new Map([...bones].map(([name, b]) => [name, b.position.clone()]));
  const restRotations = new Map([...bones].map(([name, b]) => [name, b.quaternion.clone()]));
  const restScales = new Map([...bones].map(([name, b]) => [name, b.scale.clone()]));
  const pelvis = get('pelvis'), chest = get('chest'), head = get('head');
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const vec = (x, y, z) => new THREE.Vector3(x, y, z);
  const handOffset = vec(0, -.075, -.125);
  const tPose = get('root').parent?.userData.game_axes_corrected === true;
  const world = new THREE.Vector3(), inverse = new THREE.Quaternion();
  let walkTime = 0, phase = 0;
  // This adapter is Luke's only pose writer. A lower-body history blends the
  // locomotion/gather handoff; it never moves the authoritative gameplay root.
  const lowerNames = ['pelvis', ...['right', 'left'].flatMap(side =>
    ['thigh', 'shin', 'foot', 'toe'].map(part => `${side}_${part}`))].filter(name => get(name));
  const previousLower = new Map();
  let previousPelvis = null, previousAction = null, handoffRemaining = 0;
  const arms = ['right', 'left'].map((side, i) => {
    const upper = get(`${side}_upper_arm`), lower = get(`${side}_forearm`), hand = get(`${side}_hand`);
    const sign = i === 0 ? 1 : -1;
    // This imported T-pose has fingers pointing sideways and palms down.
    // Map that bind orientation into the gameplay wrist frame before posing.
    const handBind = tPose ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      vec(0, -sign, 0), vec(0, 0, 1), vec(-sign, 0, 0))) : new THREE.Quaternion();
    const physicalBindOffset = vec(...LUKE_PHYSICAL_PALMS[side].offset);
    return { side, sign, upper, lower, hand, handBind,
      anchorOffset: handOffset.clone().applyQuaternion(handBind.clone().invert()),
      physicalBindOffset, physicalNormal: vec(...LUKE_PHYSICAL_PALMS[side].normal),
      physicalOffset: physicalBindOffset.clone().applyQuaternion(handBind),
      upperAxis: rest.get(`${side}_forearm`).clone().normalize(),
      lowerAxis: rest.get(`${side}_hand`).clone().normalize(),
      a: rest.get(`${side}_forearm`).length(), b: rest.get(`${side}_hand`).length() };
  });
  function localPosition(bone) {
    bone.getWorldPosition(world);
    return visual.worldToLocal(world.clone());
  }
  function localRotation(bone) {
    visual.getWorldQuaternion(inverse).invert();
    return bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverse);
  }
  function refreshArmAnchor(arm) {
    const point = arm.hand.localToWorld(arm.anchorOffset.clone());
    anchors[`${arm.side}Hand`].position.copy(visual.worldToLocal(point)).add(visual.position);
  }
  // Analytical two-bone IK, in asset-local coordinates. The pole keeps elbows
  // outside the torso; independent wrists support and guide the ball.
  function solve(arm, anchor, orientation, pole, offset = handOffset) {
    visual.updateWorldMatrix(true, true);
    const start = localPosition(arm.upper);
    const wrist = anchor.clone().sub(offset.clone().applyQuaternion(orientation));
    const direction = wrist.clone().sub(start);
    const d = clamp(direction.length(), .025, arm.a + arm.b - .0001);
    direction.normalize();
    const along = (arm.a * arm.a - arm.b * arm.b + d * d) / (2 * d);
    const height = Math.sqrt(Math.max(0, arm.a * arm.a - along * along));
    const bend = pole.clone().sub(start);
    bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    const elbow = start.clone().addScaledVector(direction, along).addScaledVector(bend, height);
    const reached = start.clone().addScaledVector(direction, d);
    const upperQ = new THREE.Quaternion().setFromUnitVectors(arm.upperAxis, elbow.clone().sub(start).normalize());
    arm.upper.quaternion.copy(localRotation(arm.upper.parent).invert().multiply(upperQ));
    visual.updateWorldMatrix(true, true);
    const lowerDirection = reached.clone().sub(elbow).normalize();
    let lowerQ = new THREE.Quaternion().setFromUnitVectors(arm.lowerAxis, lowerDirection);
    if (offset === arm.physicalOffset && height > .001) {
      // Give the forearm the elbow plane's roll, rather than the shortest aim
      // rotation's unstable roll near an antipodal bind direction. Positions
      // stay analytical; the wrist no longer has to countertwist that frame.
      const normal = direction.clone().cross(bend).normalize();
      const bindNormal = vec(0, 0, 1).addScaledVector(arm.lowerAxis, -arm.lowerAxis.z).normalize();
      const bindBasis = new THREE.Matrix4().makeBasis(arm.lowerAxis,
        bindNormal.clone().cross(arm.lowerAxis).normalize(), bindNormal);
      const posedBasis = new THREE.Matrix4().makeBasis(lowerDirection,
        normal.clone().cross(lowerDirection).normalize(), normal);
      lowerQ = new THREE.Quaternion().setFromRotationMatrix(posedBasis.multiply(bindBasis.invert()));
    }
    arm.lower.quaternion.copy(upperQ.clone().invert().multiply(lowerQ));
    arm.hand.quaternion.copy(lowerQ.clone().invert().multiply(orientation).multiply(arm.handBind));
    visual.updateWorldMatrix(true, true);
    refreshArmAnchor(arm);
  }
  function updateBaseline(dt, state) {
    const safeDt = clamp(dt, 0, .1), speed = Math.max(0, Number(state.speed) || 0);
    const moving = speed > .08, action = state.action || (moving ? 'move' : 'idle');
    const p = clamp(state.shotProgress);
    walkTime += safeDt * (moving ? Math.min(16, 5.5 + speed * 1.7) : 1.2);
    phase += safeDt * (moving ? 8.2 : 4.4);
    const dribble = Number.isFinite(state.dribblePhase) ? state.dribblePhase : phase;
    const stride = Math.sin(walkTime), amplitude = moving ? Math.min(.58, .18 + speed * .055) : .012;
    visual.position.set(0, 0, 0);
    for (const [name, b] of bones) {
      b.position.copy(rest.get(name)); b.quaternion.copy(restRotations.get(name)); b.scale.copy(restScales.get(name));
    }
    pelvis.position.y += moving ? Math.abs(stride) * .018 : Math.sin(walkTime) * .003;
    chest.rotation.set(moving ? .06 : 0, -stride * (moving ? .035 : 0), 0);
    for (const [i, side] of ['right', 'left'].entries()) {
      const sign = i === 0 ? 1 : -1;
      get(`${side}_thigh`).rotation.x = stride * amplitude * sign;
      // Luke faces -Z: negative local-X knee flexion keeps the knee forward
      // of the ankle. The previous positive flexion bent the knee backwards.
      get(`${side}_shin`).rotation.x = moving ? -Math.max(0, stride * sign) * .5 : 0;
      get(`${side}_foot`).rotation.x = -get(`${side}_thigh`).rotation.x - get(`${side}_shin`).rotation.x;
      get(`${side}_toe`)?.rotation.set(0, 0, 0);
    }
    if (action === 'shoot') {
      const crouch = Math.sin(Math.min(p / .58, 1) * Math.PI);
      pelvis.position.y -= .86 * (1 - Math.cos(.18 * crouch));
      for (const side of ['right', 'left']) {
        get(`${side}_thigh`).rotation.x = .18 * crouch;
        get(`${side}_shin`).rotation.x = -.36 * crouch;
        get(`${side}_foot`).rotation.x = -.18 * crouch;
      }
    } else if (action === 'layup' || action === 'dunk') {
      const rise = Math.sin(p * Math.PI);
      chest.rotation.x = -.06 * rise;
      head.rotation.x = .08 * rise;
      get('right_thigh').rotation.x = .33 * rise;
      get('right_shin').rotation.x = -.6 * rise;
      get('left_thigh').rotation.x = -.22 * rise;
      get('left_shin').rotation.x = -.25 * rise;
    }
    // Resolve feet after action overrides as well as locomotion; otherwise an
    // old stride's ankle compensation can survive the landing pose.
    for (const side of ['right', 'left']) {
      get(`${side}_foot`).rotation.x = -get(`${side}_thigh`).rotation.x - get(`${side}_shin`).rotation.x;
      get(`${side}_toe`)?.rotation.set(0, 0, 0);
    }
    // Capture the current lower pose on a state handoff, instead of resetting
    // a running stride to the narrow standing target in the first gather frame.
    // Arms keep exact game-owned ball anchors and are solved after this blend.
    if (previousAction !== null && previousAction !== action) handoffRemaining = .16;
    if (handoffRemaining > 0 && previousPelvis && safeDt > 0) {
      const alpha = Math.min(1, safeDt / handoffRemaining);
      for (const name of lowerNames) {
        const q = previousLower.get(name);
        if (q) get(name).quaternion.copy(q.clone().slerp(get(name).quaternion, alpha));
      }
      pelvis.position.lerpVectors(previousPelvis, pelvis.position.clone(), alpha);
      handoffRemaining = Math.max(0, handoffRemaining - safeDt);
    }
    previousAction = action;
    previousPelvis = pelvis.position.clone();
    for (const name of lowerNames) previousLower.set(name, get(name).quaternion.clone());
    visual.updateWorldMatrix(true, true);
    for (const arm of arms) {
      const s = arm.sign;
      let target, rotation;
      if (action === 'shoot') {
        // Match main.js's gather exactly: progress = charge * .58.
        const follow = Math.max(0, (p - .58) / .42);
        target = vec(.22, 1.24 + clamp(p / .58) * .48 + follow * .38, -.37 - follow * .12);
        rotation = new THREE.Quaternion().setFromEuler(arm.side === 'left'
          ? new THREE.Euler(0, -Math.PI / 2, 0)
          : new THREE.Euler(Math.PI / 2 + follow * .8, 0, 0));
        if (arm.side === 'left' && follow > 0) target.x -= follow * .22;
      } else if (action === 'layup' || action === 'dunk') {
        const rise = Math.sin(Math.min(p / .58, 1) * Math.PI / 2), isDunk = action === 'dunk';
        target = vec(isDunk ? .10 : .19, 1.61 + rise * (tPose ? .60 : (isDunk ? .67 : .64)), -.30 - rise * .10);
        rotation = new THREE.Quaternion().setFromEuler(arm.side === 'left'
          ? new THREE.Euler(1.25, -.55, 0) : new THREE.Euler(Math.PI / 2, 0, 0));
        if (arm.side === 'left' && !isDunk) target = vec(-.34, 1.22 + rise * .12, -.30);
      } else {
        target = arm.side === 'right' ? vec(.47, (tPose ? 1.12 : .96) + Math.sin(dribble) * .12, -.23)
          : vec(-.43, tPose ? 1.12 : .94, -.08 - stride * (moving ? .19 : .015));
        rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(arm.side === 'right' ? -.35 : .05, 0, s * -.08));
      }
      solve(arm, target, rotation, vec(s * .8, 1.20, .13));
    }
    visual.updateWorldMatrix(true, true);
    anchors.chest.position.copy(localPosition(chest)).add(vec(0, .035, -.18));
    anchors.head.position.copy(localPosition(head));
  }
  let authoredClip = null, clipTime = 0, transitionAge = 0, previousMoving = null;
  let upperBlendRemaining = 0, bodyUpperRemaining = 0, previousChest = null, previousHead = null;
  const armHistory = new Map(), armHandoff = new Map();
  let pickupLowerOrigin = new Map(), pickupPelvisOrigin = null;
  let lowerOrigin = new Map(), pelvisOrigin = null, chestOrigin = null, headOrigin = null;
  let freeArmAge = .32;
  let pickupFinger = vec(0, 0, 1);
  let contact = {}, fallback = null, lastSelected = null, heldBallLocal = null;
  const smooth = value => { const n = clamp(value); return n * n * (3 - 2 * n); };
  const fromArray = array => vec(...array);
  function contactFrame(arm, normal, fingerDirection) {
    const bindNormal = arm.physicalNormal.clone().applyQuaternion(arm.handBind).normalize();
    const bindFinger = vec(0, -1, 0);
    const bindTangent = bindFinger.addScaledVector(bindNormal, -bindFinger.dot(bindNormal)).normalize();
    const tangent = fingerDirection.clone().addScaledVector(normal, -fingerDirection.dot(normal));
    if (tangent.lengthSq() < .0001) tangent.copy(vec(0, 0, -1)).addScaledVector(normal, normal.z);
    tangent.normalize();
    const from = new THREE.Matrix4().makeBasis(bindTangent, bindNormal.clone().cross(bindTangent), bindNormal);
    const to = new THREE.Matrix4().makeBasis(tangent, normal.clone().cross(tangent), normal);
    return new THREE.Quaternion().setFromRotationMatrix(to.multiply(from.invert()));
  }
  function resetLocal() {
    visual.position.set(0, 0, 0);
    for (const [name, bone] of bones) {
      bone.position.copy(rest.get(name)); bone.quaternion.copy(restRotations.get(name)); bone.scale.copy(restScales.get(name));
    }
  }
  function update(dt = 1 / 60, state = {}) {
    const hasBall = Array.isArray(state.ballLocal) && state.ballLocal.length === 3 && state.ballLocal.every(Number.isFinite);
    const forcedClip = state.inspectionClip && LUKE_MOTION_PACK.clips[state.inspectionClip] ? state.inspectionClip : null;
    const supported = !state.action || ['idle', 'move', 'shoot', 'layup', 'dunk'].includes(state.action);
    if ((!hasBall && !forcedClip && state.motionPack !== 'authored') || !supported || state.motionPack === 'baseline') {
      authoredClip = null; fallback = !supported ? 'unsupported-action' : 'part1-procedural'; contact = {};
      heldBallLocal = null;
      armHistory.clear(); armHandoff.clear(); previousChest = null; previousHead = null;
      updateBaseline(dt, state); return;
    }
    fallback = null;
    const safeDt = clamp(dt, 0, .1), speed = Math.max(0, Number(state.speed) || 0), moving = speed > .08;
    const action = state.action || (moving ? 'move' : 'idle');
    walkTime += safeDt * (moving ? Math.min(16, 5.5 + speed * 1.7) : 1.2);
    phase += safeDt * (moving ? 8.2 : 4.4);
    const dribble = Number.isFinite(state.dribblePhase) ? state.dribblePhase : phase;
    if (previousMoving !== null && previousMoving !== moving && action !== 'shoot' && !Number.isFinite(state.pickupProgress)) {
      lastSelected = moving ? 'locomotion-start' : 'locomotion-stop'; transitionAge = 0;
    }
    previousMoving = moving; transitionAge += safeDt;
    const transition = lastSelected && transitionAge < LUKE_MOTION_PACK.clips[lastSelected].duration ? lastSelected : null;
    const selected = forcedClip || (transition && !Number.isFinite(state.pickupProgress) && ['idle', 'move'].includes(action)
      ? transition : selectLukeMotion(state));
    const changed = authoredClip !== selected;
    if (changed) {
      if (selected === 'pickup') {
        pickupLowerOrigin = new Map([...previousLower].map(([name, q]) => [name, q.clone()]));
        pickupPelvisOrigin = previousPelvis?.clone() || null;
        if (hasBall) {
          // Capture the reach's horizontal roll once. Recomputing it from the
          // moving shoulder flips the flat finger fan as the ball passes it.
          const leftReach = clamp(-state.ballLocal[0] / .35);
          pickupFinger = vec(state.ballLocal[0] - (.24 - .22 * leftReach), 0,
            state.ballLocal[2] + .40 + .12 * leftReach).normalize();
          if (pickupFinger.lengthSq() < .001) pickupFinger.set(0, 0, 1);
        }
      }
      lowerOrigin = new Map([...previousLower].map(([name, q]) => [name, q.clone()]));
      pelvisOrigin = previousPelvis?.clone() || null;
      chestOrigin = previousChest?.clone() || null; headOrigin = previousHead?.clone() || null;
      const explicitArmClip = ['gather', 'pickup', 'release-follow-through', 'layup', 'dunk'].includes(selected)
        || ['layup', 'dunk'].includes(authoredClip);
      if (explicitArmClip || freeArmAge >= .32) {
        for (const arm of arms) {
          const previous = armHistory.get(arm.side);
          if (previous) armHandoff.set(arm.side, { target: previous.target.clone(), rotation: previous.rotation.clone(), pole: previous.pole.clone() });
        }
        freeArmAge = 0;
      }
      clipTime = 0; upperBlendRemaining = .22; bodyUpperRemaining = .22;
    }
    authoredClip = selected; clipTime += safeDt;
    let t = Number.isFinite(state.inspectionTime) && forcedClip ? clamp(state.inspectionTime)
      : selected === 'pickup' ? clamp(state.pickupProgress)
        : selected === 'gather' ? clamp(state.shotProgress / .58)
          : selected === 'release-follow-through' ? clamp(Number.isFinite(state.releaseProgress) ? state.releaseProgress : (state.shotProgress - .58) / .42)
            : selected === 'layup' || selected === 'dunk' ? clamp(state.shotProgress)
              : selected === 'stationary-dribble' ? dribble / (Math.PI * 2)
                : ['locomotion', 'moving-dribble'].includes(selected) ? walkTime / (Math.PI * 2)
                  : transition ? transitionAge / LUKE_MOTION_PACK.clips[selected].duration : clipTime / LUKE_MOTION_PACK.clips[selected].duration;
    const pose = sampleLukeMotion(selected, t);
    heldBallLocal = ['layup', 'dunk'].includes(selected) ? fromArray(pose.rightTarget) : null;
    if (heldBallLocal && Array.isArray(state.finishOriginLocal) && state.finishOriginLocal.length === 3 && state.finishOriginLocal.every(Number.isFinite)) {
      heldBallLocal.lerpVectors(fromArray(state.finishOriginLocal), heldBallLocal.clone(), smooth((Number(state.finishElapsed) || 0) / .20));
    }
    const ball = heldBallLocal || (hasBall ? fromArray(state.ballLocal) : null);
    resetLocal();
    const runningScale = ['locomotion', 'moving-dribble'].includes(selected) ? clamp(speed / 3.38, .35, 1.4) : 1;
    pelvis.rotation.x = pose.pelvisX;
    for (const side of ['right', 'left']) {
      const pickupStride = selected === 'pickup' && moving ? Math.sin(walkTime) * (side === 'right' ? 1 : -1) * .035 * Math.sin(clamp(t) * Math.PI) : 0;
      get(`${side}_thigh`).rotation.x = pose[`${side}Hip`] * runningScale - pose.pelvisX + pickupStride;
      get(`${side}_shin`).rotation.x = pose[`${side}Knee`] * runningScale;
      get(`${side}_foot`).rotation.x = -get(`${side}_thigh`).rotation.x - get(`${side}_shin`).rotation.x - pose.pelvisX;
    }
    // A left-side floor ball needs the torso to turn into the reach. The
    // authored yaw envelope lowers the right shoulder with the deep lean;
    // it fades as the game-owned ball crosses back to the carrying side.
    if (selected === 'pickup' && ball) pose.chestY *= clamp(-ball.x / .35);
    chest.rotation.set(pose.chestX, pose.chestY, 0); head.rotation.x = pose.headX;
    // Ground height is part of this authored body solve. Keep flat world feet
    // above the canonical 0.170 m ankle/sole offset, without a second leg writer.
    visual.updateWorldMatrix(true, true);
    const ankleRest = rest.get('pelvis').y + rest.get('right_thigh').y + rest.get('right_shin').y + rest.get('right_foot').y;
    const minAnkle = Math.min(...['right', 'left'].map(side => localPosition(get(`${side}_foot`)).y));
    pelvis.position.y += ankleRest - minAnkle;
    // Move/idle changes during pickup do not change its authored body. Starting
    // that same clip's handoff again would reuse the initial standing origin.
    if (previousAction !== null && (changed || (previousAction !== action && selected !== 'pickup'))) {
      if (!changed) {
        lowerOrigin = new Map([...previousLower].map(([name, q]) => [name, q.clone()]));
        pelvisOrigin = previousPelvis.clone();
      }
      handoffRemaining = .16;
    }
    if (handoffRemaining > 0 && previousPelvis && safeDt > 0) {
      // Pickup's target keeps descending during the handoff. Blend from one
      // captured origin so an expiring recursive blend cannot rush the crouch
      // on its last frame and snap the reaching palm down with the shoulder.
      const alpha = smooth((.16 - handoffRemaining + safeDt) / .16);
      for (const name of lowerNames) {
        const q = lowerOrigin.get(name);
        if (q) get(name).quaternion.copy(q.clone().slerp(get(name).quaternion, alpha));
      }
      pelvis.position.lerpVectors(pelvisOrigin || previousPelvis, pelvis.position.clone(), alpha);
      handoffRemaining = Math.max(0, handoffRemaining - safeDt);
    }
    if (bodyUpperRemaining > 0 && safeDt > 0) {
      const alpha = smooth((.22 - bodyUpperRemaining + safeDt) / .22);
      if (chestOrigin) chest.quaternion.copy(chestOrigin.clone().slerp(chest.quaternion, alpha));
      if (headOrigin) head.quaternion.copy(headOrigin.clone().slerp(head.quaternion, alpha));
      bodyUpperRemaining = Math.max(0, bodyUpperRemaining - safeDt);
    }
    // A blended bent stance can otherwise put its lower foot slightly below
    // the floor. Resolve only pelvis height inside the same writer, not leg IK.
    visual.updateWorldMatrix(true, true);
    const blendedMin = Math.min(...['right', 'left'].map(side => localPosition(get(`${side}_foot`)).y));
    if (blendedMin < ankleRest) pelvis.position.y += ankleRest - blendedMin;
    previousAction = action; previousPelvis = pelvis.position.clone();
    previousChest = chest.quaternion.clone(); previousHead = head.quaternion.clone();
    for (const name of lowerNames) previousLower.set(name, get(name).quaternion.clone());
    visual.updateWorldMatrix(true, true);
    const radius = clamp(state.ballRadius ?? .12, .01, .3);
    const gatherBlend = smooth((Number(state.gatherElapsed) || 0) / .22);
    contact = {};
    for (const arm of arms) {
      let target = fromArray(pose[`${arm.side}Target`]);
      let orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose[`${arm.side}Wrist`]));
      let pole = fromArray(pose[`${arm.side}Pole`]);
      let required = false, phaseName = 'free', contactNormal = null, normalBlend = 0;
      if (ball && selected === 'pickup' && arm.side === 'right') {
        const reach = smooth(t / .28);
        const returning = smooth((t - .76) / .24);
        const lift = smooth((t - .38) / .34);
        const angle = 1.30 * lift * (1 - returning);
        const surface = ball.clone().add(vec(Math.sin(angle) * radius, Math.cos(angle) * radius, 0));
        contactNormal = ball.clone().sub(surface).normalize();
        const shoulder = localPosition(arm.upper);
        const startNormal = vec(0, -1, 0), endNormal = vec(-Math.sin(1.30), -Math.cos(1.30), 0);
        const startFrame = contactFrame(arm, startNormal, pickupFinger).premultiply(
          new THREE.Quaternion().setFromUnitVectors(startNormal, contactNormal));
        const endFrame = contactFrame(arm, endNormal, vec(0, -1, 0)).premultiply(
          new THREE.Quaternion().setFromUnitVectors(endNormal, contactNormal));
        // Transport both finger frames onto the current contact plane before
        // blending roll. A projected vector blend can pass through zero and
        // spin the wrist as the left-side ball crosses the shoulder.
        const pickupOrientation = startFrame.slerp(endFrame, lift);
        const dribbleOrientation = contactFrame(arm, vec(0, -1, 0), vec(0, 0, -1));
        pickupOrientation.slerp(dribbleOrientation, returning);
        const dribbleTarget = ball.clone().add(vec(0, radius, 0));
        const bob = .5 + Math.sin(dribble) * .5;
        dribbleTarget.y = Math.max(dribbleTarget.y, .79 + .03 * bob);
        surface.lerp(dribbleTarget, returning);
        const preceding = armHistory.get(arm.side);
        if (changed && preceding) armHandoff.set(arm.side, { target: preceding.target.clone(), rotation: preceding.rotation.clone(), pole: preceding.pole.clone() });
        const origin = armHandoff.get(arm.side)?.target || target;
        target.lerpVectors(origin, surface, reach);
        const handoff = armHandoff.get(arm.side);
        orientation.copy(handoff ? handoff.rotation.clone().slerp(pickupOrientation, reach) : pickupOrientation);
        if (handoff) pole.lerpVectors(handoff.pole, pole.clone(), reach);
        // Place the elbow behind the palm's finger direction, reducing the
        // sharp forearm-to-flat-hand kink without pretending fingers can curl.
        pole.lerp(vec(.72, .48 + ball.y * .35, -.28), reach * (1 - returning));
        required = t >= .35 && t <= .76; phaseName = t < .28 ? 'reach' : t <= .76 ? 'lift-contact' : 'dribble-return';
      } else if (ball && selected === 'gather') {
        contactNormal = arm.side === 'right' ? vec(0, 1, 0) : vec(1, 0, 0);
        const desired = contactFrame(arm, contactNormal, arm.side === 'right' ? vec(0, 0, -1) : vec(0, 1, -.55));
        const preceding = armHistory.get(arm.side);
        if (changed && preceding) armHandoff.set(arm.side, { target: preceding.target.clone(), rotation: preceding.rotation.clone(), pole: preceding.pole.clone() });
        const origin = armHandoff.get(arm.side);
        orientation.copy((origin?.rotation || desired).clone().slerp(desired, gatherBlend));
        // Derive the sphere contact from that single continuous hand rotation.
        // A second normal correction used to whip the wrist halfway through.
        const movingNormal = arm.physicalNormal.clone().applyQuaternion(arm.handBind).applyQuaternion(orientation).normalize();
        const surface = ball.clone().addScaledVector(movingNormal, -radius);
        target.copy(surface);
        if (origin) target.lerpVectors(origin.target, surface, gatherBlend);
        if (origin) pole.lerpVectors(origin.pole, pole.clone(), gatherBlend);
        required = gatherBlend >= .99; phaseName = required ? 'gather-contact' : 'gather-handoff';
      } else if (selected === 'release-follow-through') {
        const release = Array.isArray(state.releaseLocal) && state.releaseLocal.every(Number.isFinite)
          ? fromArray(state.releaseLocal) : vec(.22, 1.72, -.37);
        const preceding = armHistory.get(arm.side);
        if (changed && preceding) armHandoff.set(arm.side, { target: preceding.target.clone(), rotation: preceding.rotation.clone(), pole: preceding.pole.clone() });
        const origin = armHandoff.get(arm.side);
        const start = origin?.target || release.clone().add(arm.side === 'right' ? vec(0, -radius, 0) : vec(-radius, 0, 0));
        // Early shots extend from the actual last gather, never a max-charge pose.
        const destination = arm.side === 'right' ? start.clone().add(vec(0, .45, 0)) : target;
        if (arm.side === 'right') {
          destination.y = Math.min(2.27, destination.y);
          // The long overhead follow-through stays within Luke's reach. A
          // further forward wrist at this height would fully stretch the arm.
          destination.z = Math.max(-.35, start.z - .04);
        }
        target.lerpVectors(start, destination, smooth(t));
        if (origin) orientation.copy(origin.rotation.clone().slerp(orientation, smooth(t)));
        if (origin) pole.lerpVectors(origin.pole, pole.clone(), smooth(t));
        phaseName = 'released-follow-through';
      } else if (ball && ['layup', 'dunk'].includes(selected)) {
        if (arm.side === 'right' || selected === 'dunk') {
          target.copy(ball).add(arm.side === 'right' ? vec(0, -radius, 0) : vec(-radius, 0, 0));
          contactNormal = ball.clone().sub(target).normalize();
          normalBlend = armHandoff.has(arm.side) ? smooth(1 - upperBlendRemaining / .22) : 1;
          required = state.ballMode === 'finish'; phaseName = required ? 'finish-contact' : 'released-finish';
        }
      } else if (ball && state.ballMode === 'dribble' && arm.side === 'right') {
        const bob = .5 + Math.sin(dribble) * .5;
        const surface = ball.clone().add(vec(0, radius, 0));
        target.copy(surface); target.y = Math.max(surface.y, .79 + .03 * bob);
        // Keep a stable press frame through the bounce; the ball travels below
        // the palm rather than the wrist flipping into contact at every crest.
        orientation.copy(contactFrame(arm, vec(0, -1, 0), vec(0, 0, -1)));
        required = bob >= .96; phaseName = required ? 'dribble-contact' : 'dribble-flight';
      }
      if (contactNormal && normalBlend > 0) {
        const posedNormal = arm.physicalNormal.clone().applyQuaternion(arm.handBind).applyQuaternion(orientation).normalize();
        const correction = new THREE.Quaternion().setFromUnitVectors(posedNormal, contactNormal);
        orientation.premultiply(new THREE.Quaternion().slerp(correction, normalBlend));
      }
      // Arms blend their free motion on interruptions; contact trajectories have
      // their own explicit handoff so no post-ball skeleton writer is needed.
      const finishHandoff = ['layup', 'dunk'].includes(selected);
      if ((finishHandoff ? upperBlendRemaining > 0 : freeArmAge < .32)
          && !['gather', 'pickup', 'release-follow-through'].includes(selected)) {
        // Finishes retain their original .22 s acquisition from the current
        // dribble palm. The longer free recovery clock must not reuse an old
        // origin or declare a low bounce ball an acquired grip on entry.
        const origin = armHandoff.get(arm.side), alpha = finishHandoff
          ? smooth(1 - upperBlendRemaining / .22) : smooth((freeArmAge + safeDt) / .32);
        if (origin) { target.lerpVectors(origin.target, target.clone(), alpha); orientation.copy(origin.rotation.clone().slerp(orientation, alpha)); pole.lerpVectors(origin.pole, pole.clone(), alpha); }
        if (origin && alpha < .99) required = false;
      }
      solve(arm, target, orientation, pole, arm.physicalOffset);
      const actual = visual.worldToLocal(arm.hand.localToWorld(arm.physicalBindOffset.clone())).add(visual.position);
      const physicalNormal = arm.physicalNormal.clone().applyQuaternion(localRotation(arm.hand)).normalize();
      const towardBall = ball ? ball.clone().sub(actual).normalize() : null;
      contact[arm.side] = { phase: phaseName, required, error: actual.distanceTo(target), target: target.toArray(), actual: actual.toArray(),
        attachment: anchors[`${arm.side}Hand`].position.toArray(), physicalBindOffset: arm.physicalBindOffset.toArray(),
        physicalNormal: physicalNormal.toArray(), normalDot: towardBall ? physicalNormal.dot(towardBall) : null,
        ballSurfaceError: ball ? Math.abs(actual.distanceTo(ball) - radius) : null };
      armHistory.set(arm.side, { target: actual.clone(), rotation: orientation.clone(), pole: pole.clone() });
    }
    upperBlendRemaining = Math.max(0, upperBlendRemaining - safeDt);
    freeArmAge += safeDt;
    visual.updateWorldMatrix(true, true);
    anchors.chest.position.copy(localPosition(chest)).add(vec(0, .035, -.18));
    anchors.head.position.copy(localPosition(head));
  }
  return {
    update,
    reset() {
      walkTime = 0; phase = 0; previousAction = null; previousPelvis = null;
      previousLower.clear(); handoffRemaining = 0;
      authoredClip = null; clipTime = 0; transitionAge = 0; previousMoving = null;
      upperBlendRemaining = 0; bodyUpperRemaining = 0; previousChest = null; previousHead = null;
      armHistory.clear(); armHandoff.clear(); contact = {}; fallback = null; lastSelected = null;
      heldBallLocal = null;
      pickupLowerOrigin.clear(); pickupPelvisOrigin = null;
      lowerOrigin.clear(); pelvisOrigin = null; chestOrigin = null; headOrigin = null; freeArmAge = .32;
      pickupFinger.set(0, 0, 1);
      resetLocal();
    },
    diagnostics() { return { owner: authoredClip ? 'luke-authored' : 'luke-procedural', action: previousAction,
      clip: authoredClip, inventory: LUKE_CLIPS.map(clip => clip.name), jointOwnership: LUKE_JOINT_OWNERSHIP,
      handoffRemaining, upperBlendRemaining, contact, fallback, ballCenter: heldBallLocal?.toArray() || null,
      grounding: authoredClip ? 'same-writer-pelvis-sole-compensation' : 'part1-baseline',
      hybridWeight: 0, footCorrection: false }; },
    getHeldBallLocal(target = new THREE.Vector3()) { return heldBallLocal ? target.copy(heldBallLocal) : null; },
  };
}
