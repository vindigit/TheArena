// Explicit repeatable local deltas for stress inspection, never runtime clips.
export const INSPECTION_POSES = ['neutral', 'right knee', 'left knee', 'shallow squat',
  'athletic crouch', 'forward step', 'wide stance', 'torso lean', 'arm raise', 'ball hold'];
export function captureRest(bones) {
  return new Map([...bones].map(([name, b]) => [name, { position: b.position.clone(),
    quaternion: b.quaternion.clone(), scale: b.scale.clone() }]));
}
export function resetRest(bones, rest) {
  for (const [name, b] of bones) {
    const r = rest.get(name); b.position.copy(r.position); b.quaternion.copy(r.quaternion); b.scale.copy(r.scale);
  }
}
export function applyStressPose(THREE, visual, bones, rest, name) {
  const rotate = (bone, x=0, y=0, z=0) => bones.get(bone).quaternion.copy(rest.get(bone).quaternion)
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z)));
  const leg = (side, hip, knee, roll=0) => {
    rotate(`${side}_thigh`, hip, 0, roll); rotate(`${side}_shin`, knee);
    rotate(`${side}_foot`, -hip-knee, 0, -roll);
  };
  if (name === 'right knee') leg('right', .4, -.9);
  if (name === 'left knee') leg('left', .4, -.9);
  if (name === 'forward step') leg('right', .38, -.6);
  if (['shallow squat','athletic crouch','wide stance'].includes(name)) {
    const angle = name === 'athletic crouch' ? .58 : .24;
    for (const side of ['left','right']) leg(side, angle, -2*angle,
      name === 'wide stance' ? (side === 'right' ? .18 : -.18) : 0);
    // Measured ankle-height compensation, independent of foot IK/animation.
    // The same stress targets are used in both writer modes.
    visual.updateWorldMatrix(true,true);
    const ankles = ['left','right'].map(side => visual.worldToLocal(bones.get(`${side}_foot`).getWorldPosition(new THREE.Vector3())).y);
    const restAnkleY = rest.get('pelvis').position.y + rest.get('left_thigh').position.y +
      rest.get('left_shin').position.y + rest.get('left_foot').position.y;
    bones.get('pelvis').position.y -= (ankles[0]+ankles[1])/2-restAnkleY;
  }
  if (name === 'torso lean') rotate('chest', -.24);
  if (name === 'arm raise') {
    rotate('right_upper_arm',0,0,1.15); rotate('left_upper_arm',0,0,-1.15);
    rotate('right_forearm',0,-.35); rotate('left_forearm',0,.35);
  }
  visual.updateWorldMatrix(true,true);
}
