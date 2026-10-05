// Authoring geometry only; no gameplay corrections or recovered clip changes.
export const PLAYER_HEIGHT_SCALE = 2 / .998291015625;
export const STYLE = {
  revision: 4, shoulderWidthScale: 1.15, shoulderOffset: .14 * .15,
  hemBelowKneeMeters: .1016, openingRadius: [.067, .073],
  diffuseSize: [512, 512], armholeBottom: .70, sourceUvWidth: .80,
};
export function widenShoulder(x) {
  return x + Math.sign(x) * Math.min(Math.abs(x), .14) * .15;
}
export function addBaggyShorts({positions, uvs, sourceUvs, indices, joints, weights, landmarks, names}) {
  const sourceVertices = positions.length / 3, shells = [];
  for (const [leg, sign] of [['l', 1], ['r', -1]]) {
    const knee = landmarks[leg + 'tibia'];
    const hem = knee[1] - STYLE.hemBelowKneeMeters / PLAYER_HEIGHT_SCALE;
    const heights = [.538, .510, .475, .420, .350, .290, .250, hem + .015, hem + .006, hem, hem + .0015];
    const start = positions.length / 3, segments = 20;
    heights.forEach((y, ring) => {
      const t = Math.max(0, Math.min(1, (.50 - y) / (.50 - knee[1])));
      const centerX = sign * (.064 + .028 * t);
      const radiusX = ring === 0 ? .055 : ring === 1 ? .064 : ring === heights.length - 1 ? .0645 : .067;
      const radiusZ = ring === 0 ? .086 : ring === 1 ? .089 : ring < 6 ? .088 : ring === heights.length - 1 ? .0705 : .073;
      for (let segment = 0; segment <= segments; segment++) {
        const angle = segment / segments * Math.PI * 2;
        const crease = .0015 * Math.cos(angle * 5 + ring * .36) * Math.sin(Math.PI * ring / (heights.length - 1));
        positions.push(centerX + (radiusX + crease) * Math.cos(angle), y, -.004 + (radiusZ + crease) * Math.sin(angle));
        const sideOffset = leg === 'l' ? .815 : .907;
        uvs.push(sideOffset + segment / segments * .085, .035 + (.538 - y) / (.538 - hem) * .92);
        sourceUvs.push(.5, .5);
        let tibia = Math.max(0, Math.min(1, (.31 - y) / (.31 - .225)));
        tibia = tibia * tibia * (3 - 2 * tibia);
        const root = ring === 0 ? .30 : ring === 1 ? .10 : 0;
        joints.push(names.get('root'), names.get(leg + 'femur'), names.get(leg + 'tibia'), 0);
        weights.push(root, (1 - root) * (1 - tibia), (1 - root) * tibia, 0);
        if (ring < heights.length - 1 && segment < segments) {
          const a = start + ring * (segments + 1) + segment, b = a + segments + 1;
          indices.push(a, b + 1, b, a, a + 1, b + 1);
        }
      }
    });
    shells.push({leg,start,count:(segments+1)*heights.length,hemSourceY:hem,kneeSourceY:knee[1],openingWidthMeters:.134*PLAYER_HEIGHT_SCALE});
  }
  return {...STYLE,sourceVertices,shells};
}
