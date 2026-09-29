export const SHOT_GRAVITY = 9.8;
export const SHOT_FILL_MS = 1300;
export const GREEN_CENTER = 0.51;

export function meterProgress(pressTime, now) {
  return Math.max(0, Math.min(1, (now - pressTime) / SHOT_FILL_MS));
}

export function greenWindow(distance, movementSpeed = 0) {
  const width = Math.max(0.055, 0.14 - Math.max(0, distance - 2) * 0.006 - movementSpeed * 0.012);
  return { start: GREEN_CENTER - width / 2, end: GREEN_CENTER + width / 2 };
}

export function gradeShot(progress, window) {
  if (progress < window.start) return 'EARLY';
  if (progress > window.end) return 'LATE';
  return 'ON TIME';
}

export function shotTarget(start, rim, grade, progress, window) {
  const target = { x: rim.x, y: rim.y, z: rim.z };
  if (grade === 'ON TIME') return target;
  const dx = rim.x - start.x;
  const dz = rim.z - start.z;
  const distance = Math.hypot(dx, dz);
  const outside = grade === 'EARLY' ? window.start - progress : progress - window.end;
  const miss = 0.09 + Math.min(1, outside / 0.28) * (2.1 + distance * 0.16);
  const sign = grade === 'EARLY' ? -1 : 1;
  target.x += sign * miss * dx / Math.max(distance, 0.001);
  target.z += sign * miss * dz / Math.max(distance, 0.001);
  return target;
}

export function solveShotArc(start, target, gravity = SHOT_GRAVITY) {
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const distance = Math.hypot(dx, dz);
  const rise = target.y - start.y;
  // At the target the ball descends at 48 degrees relative to the floor.
  const time = Math.sqrt(Math.max(0.04, 2 * (rise + Math.tan(48 * Math.PI / 180) * distance) / gravity));
  return {
    start: { x: start.x, y: start.y, z: start.z },
    velocity: { x: dx / time, y: rise / time + 0.5 * gravity * time, z: dz / time },
    gravity,
    time,
  };
}

export function sampleShotArc(arc, time) {
  return {
    position: {
      x: arc.start.x + arc.velocity.x * time,
      y: arc.start.y + arc.velocity.y * time - 0.5 * arc.gravity * time * time,
      z: arc.start.z + arc.velocity.z * time,
    },
    velocity: {
      x: arc.velocity.x,
      y: arc.velocity.y - arc.gravity * time,
      z: arc.velocity.z,
    },
  };
}

export function crossesHoop(previous, position, velocity, rim, ballRadius) {
  if (previous.y <= rim.rimHeight || position.y > rim.rimHeight || velocity.y >= 0) return false;
  const fraction = (previous.y - rim.rimHeight) / (previous.y - position.y);
  const x = previous.x + (position.x - previous.x) * fraction - rim.rimCenter.x;
  const z = previous.z + (position.z - previous.z) * fraction - rim.rimCenter.z;
  return Math.hypot(x, z) < rim.rimRadius - ballRadius * 0.1;
}
