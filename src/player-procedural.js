/**
 * A deliberately simple, low-poly player rig.
 *
 * The outer `group` is the gameplay transform (position / collision / facing),
 * while the nested mesh pivots are only used for the presentation pose.  That
 * separation lets the game move the player without fighting this animation.
 */
export function createPlayer(THREE) {
  const group = new THREE.Group();
  group.name = 'solo-hoops-player';

  const visual = new THREE.Group();
  visual.name = 'player-visual';
  group.add(visual);

  const material = (color, options = {}) => new THREE.MeshPhongMaterial({
    color,
    flatShading: true,
    shininess: 18,
    specular: 0x222222,
    ...options,
  });

  // A fictional late-night rec-league kit: intentionally no team, league, or
  // player branding so it stays original while retaining the early-2000s look.
  const skin = material(0x8e5d42, { shininess: 28, specular: 0x513326 });
  const jersey = material(0xe7e1d1, { shininess: 8, specular: 0x222222 });
  const trim = material(0x453684, { shininess: 10, specular: 0x171127 });
  const shortsMaterial = material(0xf3eedf, { shininess: 7 });
  const shoe = material(0x202331, { shininess: 20, specular: 0x555b78 });
  const sole = material(0xe5d4b0, { shininess: 5 });
  const hair = material(0x181417, { shininess: 3 });

  const setShadow = (object) => {
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return object;
  };

  const mesh = (geometry, mat, name) => {
    const value = new THREE.Mesh(geometry, mat);
    value.name = name;
    value.castShadow = true;
    value.receiveShadow = true;
    return value;
  };

  const addBox = (parent, width, height, depth, mat, position, name) => {
    const part = mesh(new THREE.BoxGeometry(width, height, depth), mat, name);
    part.position.set(position[0], position[1], position[2]);
    parent.add(part);
    return part;
  };

  /**
   * Creates a downward-hanging limb with a child pivot at its endpoint.
   * Rotating the returned pivot's parent animates the whole limb naturally.
   */
  const makeLimb = (parent, {
    name,
    radiusTop,
    radiusBottom,
    length,
    mat,
    position,
  }) => {
    const pivot = new THREE.Group();
    pivot.name = `${name}-pivot`;
    pivot.position.set(position[0], position[1], position[2]);
    parent.add(pivot);

    const limb = mesh(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 6, 1),
      mat,
      name,
    );
    limb.position.y = -length * 0.5;
    pivot.add(limb);

    const end = new THREE.Group();
    end.name = `${name}-end`;
    end.position.y = -length;
    pivot.add(end);
    return { pivot, end, limb };
  };

  // --- Torso -------------------------------------------------------------
  const pelvis = new THREE.Group();
  pelvis.name = 'pelvis';
  pelvis.position.y = 1.02;
  visual.add(pelvis);

  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.y = 0.36;
  pelvis.add(torso);

  const jerseyBody = mesh(
    new THREE.CylinderGeometry(0.31, 0.39, 0.7, 6, 1),
    jersey,
    'jersey-body',
  );
  torso.add(jerseyBody);

  const jerseyHem = mesh(
    new THREE.CylinderGeometry(0.405, 0.405, 0.055, 6, 1),
    trim,
    'jersey-hem',
  );
  jerseyHem.position.y = -0.325;
  torso.add(jerseyHem);

  const collar = mesh(
    new THREE.TorusGeometry(0.15, 0.025, 4, 8),
    trim,
    'jersey-collar',
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.34;
  torso.add(collar);

  const chest = new THREE.Group();
  chest.name = 'chest-anchor';
  chest.position.set(0, 0.08, -0.32);
  torso.add(chest);

  // Stylized shorts with deliberate chunky geometry.
  const shorts = new THREE.Group();
  shorts.name = 'shorts';
  shorts.position.y = -0.26;
  pelvis.add(shorts);
  addBox(shorts, 0.72, 0.37, 0.48, shortsMaterial, [0, -0.04, 0], 'shorts-body');
  addBox(shorts, 0.75, 0.055, 0.5, trim, [0, 0.145, 0], 'shorts-waistband');

  // --- Head --------------------------------------------------------------
  const neck = mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.18, 6), skin, 'neck');
  neck.position.y = 0.46;
  torso.add(neck);

  const head = new THREE.Group();
  head.name = 'head-anchor';
  head.position.y = 0.62;
  torso.add(head);

  const headMesh = mesh(new THREE.SphereGeometry(0.235, 8, 6), skin, 'head');
  headMesh.scale.set(0.92, 1.07, 0.92);
  head.add(headMesh);

  const hairCap = mesh(
    new THREE.SphereGeometry(0.238, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.46),
    hair,
    'hair-cap',
  );
  hairCap.position.y = 0.085;
  head.add(hairCap);

  // A visor-like brow is more legible than detailed facial textures at this scale.
  addBox(head, 0.22, 0.025, 0.035, hair, [0, 0.015, -0.215], 'brow');

  // --- Arms / hands ------------------------------------------------------
  const buildArm = (side) => {
    const suffix = side === 1 ? 'right' : 'left';
    const shoulder = new THREE.Group();
    shoulder.name = `${suffix}-shoulder`;
    shoulder.position.set(side * 0.38, 0.29, 0);
    torso.add(shoulder);

    const sleeve = mesh(
      new THREE.CylinderGeometry(0.13, 0.145, 0.15, 6),
      jersey,
      `${suffix}-sleeve`,
    );
    sleeve.position.y = -0.055;
    shoulder.add(sleeve);

    const upper = makeLimb(shoulder, {
      name: `${suffix}-upper-arm`,
      radiusTop: 0.105,
      radiusBottom: 0.09,
      length: 0.42,
      mat: skin,
      position: [0, -0.1, 0],
    });
    const elbow = new THREE.Group();
    elbow.name = `${suffix}-elbow`;
    upper.end.add(elbow);

    const forearm = makeLimb(elbow, {
      name: `${suffix}-forearm`,
      radiusTop: 0.085,
      radiusBottom: 0.065,
      length: 0.39,
      mat: skin,
      position: [0, 0, 0],
    });

    const palm = mesh(new THREE.SphereGeometry(0.09, 6, 5), skin, `${suffix}-hand`);
    palm.scale.set(0.84, 1, 1.08);
    palm.position.y = -0.06;
    forearm.end.add(palm);

    // This is the important gameplay attachment: ball code can query it in
    // world space during dribbles, gathers, dunks, and shot releases.
    const hand = new THREE.Object3D();
    hand.name = `${suffix}-hand-anchor`;
    hand.position.set(0, -0.08, -0.04);
    forearm.end.add(hand);
    return { shoulder, elbow, hand };
  };

  const rightArm = buildArm(1);
  const leftArm = buildArm(-1);

  // --- Legs / shoes ------------------------------------------------------
  const buildLeg = (side) => {
    const suffix = side === 1 ? 'right' : 'left';
    const hip = new THREE.Group();
    hip.name = `${suffix}-hip`;
    hip.position.set(side * 0.19, -0.08, 0);
    shorts.add(hip);

    const thigh = makeLimb(hip, {
      name: `${suffix}-thigh`,
      radiusTop: 0.16,
      radiusBottom: 0.12,
      length: 0.48,
      mat: shortsMaterial,
      position: [0, 0, 0],
    });
    const knee = new THREE.Group();
    knee.name = `${suffix}-knee`;
    thigh.end.add(knee);

    const shin = makeLimb(knee, {
      name: `${suffix}-shin`,
      radiusTop: 0.09,
      radiusBottom: 0.07,
      length: 0.43,
      mat: skin,
      position: [0, 0, 0],
    });

    const sock = mesh(
      new THREE.CylinderGeometry(0.078, 0.078, 0.14, 6),
      jersey,
      `${suffix}-sock`,
    );
    sock.position.y = -0.39;
    shin.pivot.add(sock);

    const foot = new THREE.Group();
    foot.name = `${suffix}-foot`;
    foot.position.set(0, -0.44, -0.045);
    shin.end.add(foot);
    addBox(foot, 0.18, 0.11, 0.34, shoe, [0, -0.02, -0.075], `${suffix}-shoe`);
    addBox(foot, 0.19, 0.035, 0.35, sole, [0, -0.085, -0.075], `${suffix}-sole`);
    return { hip, knee, foot };
  };

  const rightLeg = buildLeg(1);
  const leftLeg = buildLeg(-1);

  // Keep a small contact shadow with the player. It is intentionally an
  // opaque, low-resolution-looking disc rather than a physically perfect one.
  const shadow = mesh(
    new THREE.CircleGeometry(0.52, 10),
    new THREE.MeshBasicMaterial({ color: 0x06070d, transparent: true, opacity: 0.38, depthWrite: false }),
    'player-contact-shadow',
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  visual.add(shadow);

  setShadow(visual);

  const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
  const dampAngle = (current, target, rate, dt) => {
    let delta = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * (1 - Math.exp(-rate * dt));
  };

  let walkTime = 0;
  let fallbackDribble = 0;

  const resolveFacing = (facing) => {
    if (Number.isFinite(facing)) return facing;
    if (facing && Number.isFinite(facing.x) && Number.isFinite(facing.z)) {
      return Math.atan2(facing.x, facing.z);
    }
    return group.rotation.y;
  };

  const setArmPose = (arm, upperX, elbowX, upperZ = 0) => {
    arm.shoulder.rotation.x = upperX;
    arm.shoulder.rotation.z = upperZ;
    arm.elbow.rotation.x = elbowX;
  };

  const update = (dt = 1 / 60, state = {}) => {
    const safeDt = Math.min(Math.max(dt || 0, 0), 0.1);
    const speed = Math.max(0, Number(state.speed) || 0);
    const moving = speed > 0.08;
    const action = state.action || (moving ? 'move' : 'idle');
    const jump = clamp01(state.jump);
    const shotProgress = clamp01(state.shotProgress);
    const facing = resolveFacing(state.facing);

    group.rotation.y = dampAngle(group.rotation.y, facing, moving ? 16 : 9, safeDt);
    walkTime += safeDt * (moving ? Math.min(16, 5.5 + speed * 1.7) : 1.2);
    fallbackDribble += safeDt * (moving ? 8.2 : 4.4);
    const stride = Math.sin(walkTime);
    const dribblePhase = Number.isFinite(state.dribblePhase) ? state.dribblePhase : fallbackDribble;
    const dribble = Math.sin(dribblePhase);

    // Base locomotion has a deliberately snappy gait rather than smooth mocap.
    const strideAmount = moving ? Math.min(0.58, 0.18 + speed * 0.055) : 0.025;
    rightLeg.hip.rotation.x = stride * strideAmount;
    leftLeg.hip.rotation.x = -stride * strideAmount;
    rightLeg.knee.rotation.x = Math.max(0, -stride) * 0.42 + (moving ? 0.06 : 0);
    leftLeg.knee.rotation.x = Math.max(0, stride) * 0.42 + (moving ? 0.06 : 0);
    rightLeg.foot.rotation.x = -rightLeg.hip.rotation.x * 0.45;
    leftLeg.foot.rotation.x = -leftLeg.hip.rotation.x * 0.45;

    torso.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    pelvis.position.y = 1.02;
    visual.position.y = 0;
    shadow.scale.setScalar(1);

    if (action === 'shoot') {
      // Crouch -> gather -> high release / follow-through.
      const gather = Math.sin(Math.min(shotProgress, 0.62) / 0.62 * Math.PI * 0.5);
      const release = Math.max(0, (shotProgress - 0.42) / 0.58);
      const armLift = 0.55 + gather * 0.75 + release * 0.82;
      pelvis.position.y -= gather * 0.13;
      torso.rotation.x = -gather * 0.12 + release * 0.08;
      head.rotation.x = release * 0.09;
      setArmPose(rightArm, armLift, -0.8 - release * 0.35, -0.12);
      setArmPose(leftArm, armLift * 0.94, -0.72 - release * 0.28, 0.12);
      rightLeg.hip.rotation.x = -gather * 0.12;
      leftLeg.hip.rotation.x = -gather * 0.12;
      rightLeg.knee.rotation.x = gather * 0.42;
      leftLeg.knee.rotation.x = gather * 0.42;
    } else if (action === 'layup') {
      const rise = Math.sin(shotProgress * Math.PI);
      visual.position.y = jump * 0.035;
      torso.rotation.x = -0.14 * rise;
      head.rotation.x = 0.13 * rise;
      setArmPose(rightArm, 1.7 + rise * 0.62, -0.74, -0.16);
      setArmPose(leftArm, 0.8 + rise * 0.38, -0.55, 0.16);
      rightLeg.hip.rotation.x = -0.34 * rise;
      leftLeg.hip.rotation.x = 0.28 * rise;
      rightLeg.knee.rotation.x = 0.52 * rise;
      leftLeg.knee.rotation.x = 0.18 * rise;
    } else if (action === 'dunk') {
      const rise = Math.sin(shotProgress * Math.PI);
      visual.position.y = jump * 0.035;
      torso.rotation.x = -0.2 * rise;
      head.rotation.x = 0.2 * rise;
      setArmPose(rightArm, 2.25 + rise * 0.32, -0.28, -0.1);
      setArmPose(leftArm, 2.16 + rise * 0.28, -0.24, 0.1);
      rightLeg.hip.rotation.x = -0.4 * rise;
      leftLeg.hip.rotation.x = 0.24 * rise;
      rightLeg.knee.rotation.x = 0.6 * rise;
      leftLeg.knee.rotation.x = 0.24 * rise;
    } else {
      // Dribble hand is alive even when standing still. The other arm follows
      // the walk cycle lightly, so the silhouette reads well at a distance.
      const dribbleArm = 0.08 + dribble * 0.17;
      setArmPose(rightArm, dribbleArm - (moving ? stride * 0.1 : 0), 0.18 + Math.max(0, dribble) * 0.12, -0.08);
      setArmPose(leftArm, -0.1 + (moving ? stride * 0.26 : 0.04), 0.12, 0.08);
      torso.rotation.y = moving ? -stride * 0.045 : 0;
      torso.rotation.z = moving ? -stride * 0.025 : 0;
      pelvis.position.y += moving ? Math.abs(stride) * 0.022 : 0;
    }

    // Gameplay owns the actual vertical jump, but this visual offset adds a
    // touch of squash/stretch without altering collision geometry.
    if (jump > 0 && action !== 'layup' && action !== 'dunk') {
      visual.position.y += jump * 0.025;
      shadow.scale.setScalar(1 - jump * 0.18);
    }
  };

  return {
    group,
    rightHand: rightArm.hand,
    leftHand: leftArm.hand,
    chest,
    head,
    update,
    getRightHandWorldPosition(target = new THREE.Vector3()) {
      return rightArm.hand.getWorldPosition(target);
    },
    getLeftHandWorldPosition(target = new THREE.Vector3()) {
      return leftArm.hand.getWorldPosition(target);
    },
  };
}

export default createPlayer;
