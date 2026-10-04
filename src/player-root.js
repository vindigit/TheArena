// Geometry-free gameplay infrastructure shared by player implementations.
// Loading and errors never construct a substitute mannequin.
export function createPlayerRoot(THREE) {
  const group = new THREE.Group();
  group.name = 'solo-hoops-player';
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(.52, 10),
    new THREE.MeshBasicMaterial({ color: 0x06070d, transparent: true, opacity: .38, depthWrite: false }),
  );
  shadow.name = 'player-contact-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .012;
  shadow.visible = false;
  group.add(shadow);

  const dampAngle = (current, target, rate, dt) => {
    let delta = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * (1 - Math.exp(-rate * dt));
  };
  return {
    group, shadow,
    update(dt = 1 / 60, state = {}) {
      const safeDt = Math.min(Math.max(Number(dt) || 0, 0), .1);
      const speed = Math.max(0, Number(state.speed) || 0);
      const facing = Number.isFinite(state.facing) ? state.facing
        : state.facing && Number.isFinite(state.facing.x) && Number.isFinite(state.facing.z)
          ? Math.atan2(state.facing.x, state.facing.z) : group.rotation.y;
      group.rotation.y = dampAngle(group.rotation.y, facing, speed > .08 ? 16 : 9, safeDt);
      const jump = Math.min(1, Math.max(0, Number(state.jump) || 0));
      shadow.scale.setScalar(1 - jump * .18);
    },
  };
}
