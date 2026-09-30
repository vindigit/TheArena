// Presentation-only skeletal pose adapter. Gameplay owns root translation,
// facing, jump height, shot timing and ball physics in main.js.
export function createPoseAdapter(THREE, visual, bones, anchors) {
  const get = name => bones.get(name);
  const rest = new Map([...bones].map(([name, b]) => [name, b.position.clone()]));
  const pelvis = get('pelvis'), chest = get('chest'), head = get('head');
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const vec = (x, y, z) => new THREE.Vector3(x, y, z);
  const handOffset = vec(0, -.075, -.125);
  const world = new THREE.Vector3(), inverse = new THREE.Quaternion();
  let walkTime = 0, phase = 0;
  const arms = ['right', 'left'].map((side, i) => {
    const upper = get(`${side}_upper_arm`), lower = get(`${side}_forearm`), hand = get(`${side}_hand`);
    return { side, sign: i === 0 ? 1 : -1, upper, lower, hand,
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
  // Analytical two-bone IK, in asset-local coordinates. The pole keeps elbows
  // outside the torso; independent wrists support and guide the ball.
  function solve(arm, anchor, orientation, pole) {
    visual.updateWorldMatrix(true, true);
    const start = localPosition(arm.upper);
    const wrist = anchor.clone().sub(handOffset.clone().applyQuaternion(orientation));
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
    const lowerQ = new THREE.Quaternion().setFromUnitVectors(arm.lowerAxis, reached.clone().sub(elbow).normalize());
    arm.lower.quaternion.copy(upperQ.clone().invert().multiply(lowerQ));
    arm.hand.quaternion.copy(lowerQ.clone().invert().multiply(orientation));
    visual.updateWorldMatrix(true, true);
    const point = arm.hand.localToWorld(handOffset.clone());
    anchors[`${arm.side}Hand`].position.copy(visual.worldToLocal(point)).add(visual.position);
  }
  function update(dt, state) {
    const safeDt = clamp(dt, 0, .1), speed = Math.max(0, Number(state.speed) || 0);
    const moving = speed > .08, action = state.action || (moving ? 'move' : 'idle');
    const p = clamp(state.shotProgress);
    walkTime += safeDt * (moving ? Math.min(16, 5.5 + speed * 1.7) : 1.2);
    phase += safeDt * (moving ? 8.2 : 4.4);
    const dribble = Number.isFinite(state.dribblePhase) ? state.dribblePhase : phase;
    const stride = Math.sin(walkTime), amplitude = moving ? Math.min(.58, .18 + speed * .055) : .012;
    visual.position.set(0, 0, 0);
    for (const [name, b] of bones) { b.position.copy(rest.get(name)); b.quaternion.identity(); }
    pelvis.position.y += moving ? Math.abs(stride) * .018 : Math.sin(walkTime) * .003;
    chest.rotation.set(moving ? .06 : 0, -stride * (moving ? .035 : 0), 0);
    for (const [i, side] of ['right', 'left'].entries()) {
      const sign = i === 0 ? 1 : -1;
      get(`${side}_thigh`).rotation.x = stride * amplitude * sign;
      get(`${side}_shin`).rotation.x = moving ? Math.max(0, -stride * sign) * .5 : 0;
      get(`${side}_foot`).rotation.x = -get(`${side}_thigh`).rotation.x - get(`${side}_shin`).rotation.x;
    }
    if (action === 'shoot') {
      const crouch = Math.sin(Math.min(p / .58, 1) * Math.PI);
      pelvis.position.y -= .86 * (1 - Math.cos(.18 * crouch));
      for (const side of ['right', 'left']) {
        get(`${side}_thigh`).rotation.x = -.18 * crouch;
        get(`${side}_shin`).rotation.x = .36 * crouch;
        get(`${side}_foot`).rotation.x = -.18 * crouch;
      }
    } else if (action === 'layup' || action === 'dunk') {
      const rise = Math.sin(p * Math.PI);
      chest.rotation.x = -.06 * rise;
      head.rotation.x = .08 * rise;
      get('right_thigh').rotation.x = -.33 * rise;
      get('right_shin').rotation.x = .6 * rise;
      get('left_thigh').rotation.x = .22 * rise;
      get('left_shin').rotation.x = .25 * rise;
    }
    // Resolve feet after action overrides as well as locomotion; otherwise an
    // old stride's ankle compensation can survive the landing pose.
    for (const side of ['right', 'left']) {
      get(`${side}_foot`).rotation.x = -get(`${side}_thigh`).rotation.x - get(`${side}_shin`).rotation.x;
    }
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
        target = vec(isDunk ? .10 : .19, 1.61 + rise * (isDunk ? .67 : .64), -.30 - rise * .10);
        rotation = new THREE.Quaternion().setFromEuler(arm.side === 'left'
          ? new THREE.Euler(1.25, -.55, 0) : new THREE.Euler(Math.PI / 2, 0, 0));
        if (arm.side === 'left' && !isDunk) target = vec(-.34, 1.22 + rise * .12, -.30);
      } else {
        target = arm.side === 'right' ? vec(.47, .96 + Math.sin(dribble) * .12, -.23)
          : vec(-.43, .94, -.08 - stride * (moving ? .19 : .015));
        rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(arm.side === 'right' ? -.35 : .05, 0, s * -.08));
      }
      solve(arm, target, rotation, vec(s * .8, 1.20, .13));
    }
    visual.updateWorldMatrix(true, true);
    anchors.chest.position.copy(localPosition(chest)).add(vec(0, .035, -.18));
    anchors.head.position.copy(localPosition(head));
  }
  return { update };
}
