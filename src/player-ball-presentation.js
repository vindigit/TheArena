// Local presentation paths only. main.js retains possession, charge/release
// clocks, root motion and all free-ball physics. Palms consume these same paths.
export const PICKUP_SECONDS = .72;
export const GATHER_SECONDS = .24;
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export function dribbleBallLocal(phase, speed = 0, radius = .12) {
  return [.42, radius + (.5 + Math.sin(phase) * .5) * (speed > .2 ? .8 : .68), -.16];
}

export function pickupBallLocal(origin, progress, dribble) {
  // The first part is an approach; then the ball lifts into the carry palm.
  // The final part releases the secured ball into the existing bounce cycle.
  const p = clamp(progress), carry = [.42, .92, -.16];
  return p < .76 ? mix(origin, carry, ease((p - .28) / .48))
    : mix(carry, dribble, ease((p - .76) / .24));
}

export function gatherBallLocal(origin, charge, elapsed) {
  // The set point is reached around the existing on-time release window.
  // Charge still owns timing; holding longer does not keep raising the wrists.
  const lift = ease(clamp(charge) / .52), pocket = [.22, 1.24 + lift * .68, -.37];
  return origin ? mix(origin, pocket, ease(elapsed / GATHER_SECONDS)) : pocket;
}
