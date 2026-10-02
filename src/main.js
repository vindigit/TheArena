import './styles.css';
import * as THREE from 'three';
import { AudioDirector } from './audio.js';
import { createArena } from './arena.js';
import { LOOK } from './look.js';
import { createPlayer } from './player.js';
import { createBasketball } from './ball.js';
import { samplePolished, POLISHED_PACK } from './polished-motion-data.js';
import { PICKUP_SECONDS, dribbleBallLocal, pickupBallLocal, gatherBallLocal } from './player-ball-presentation.js';
import { SHOT_GRAVITY, meterProgress, greenWindow, gradeShot, shotTarget, solveShotArc, sampleShotArc, crossesHoop } from './shooting.js';

document.documentElement.dataset.look = LOOK;
const canvas = document.querySelector('#game');
const startButton = document.querySelector('#startButton');
const clockElement = document.querySelector('#clock');
const scoreElement = document.querySelector('#score');
const actionLabel = document.querySelector('#actionLabel');
const feedbackElement = document.querySelector('#feedback');
const shotMeter = document.querySelector('#shotMeter');
const meterTrack = shotMeter.querySelector('.shot-meter__track');
const meterFill = shotMeter.querySelector('i');
const meterNeedle = shotMeter.querySelector('b');
const meterDebug = new URLSearchParams(window.location.search).has('meterDebug');
let meterTrackWidth = 0;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LOOK === 'old' ? 0.92 : 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07101d);
scene.fog = new THREE.FogExp2(0x09101e, 0.054);

const camera = new THREE.PerspectiveCamera(63, window.innerWidth / window.innerHeight, 0.05, 56);
camera.position.set(0, 3.7, 10);

const arena = createArena(THREE);
scene.add(arena.group);

const player = createPlayer(THREE);
scene.add(player.group);
startButton.disabled = true;
startButton.setAttribute('aria-live', 'polite');
startButton.querySelector('span').textContent = 'LOADING LUKE…';
startButton.querySelector('small').textContent = 'Preparing the playable character';
player.group.userData.assetReady.then(status => {
  if (status === 'ready') {
    startButton.disabled = false;
    startButton.querySelector('span').textContent = 'TAP OR CLICK TO PLAY';
    startButton.querySelector('small').textContent = 'PS2-era basketball vertical slice';
  } else {
    startButton.classList.add('has-load-error');
    startButton.querySelector('span').textContent = 'CHARACTER LOAD FAILED';
    startButton.querySelector('strong').textContent = 'LUKE UNAVAILABLE';
    startButton.querySelector('small').textContent = player.group.userData.assetError;
  }
});

const audio = new AudioDirector({ volume: 0.46 });
const clock = new THREE.Clock();

const temp = {
  forward: new THREE.Vector3(),
  right: new THREE.Vector3(),
  move: new THREE.Vector3(),
  toHoop: new THREE.Vector3(),
  cameraTarget: new THREE.Vector3(),
  cameraDesired: new THREE.Vector3(),
  ballAnchor: new THREE.Vector3(),
  ballNormal: new THREE.Vector3(),
  local: new THREE.Vector3(),
};

const BALL_RADIUS = arena.hoop.ballRadius ?? 0.12;
const GRAVITY = SHOT_GRAVITY;
const coarsePointer = window.matchMedia('(any-pointer: coarse)').matches;
const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
  touchX: 0,
  touchY: 0,
};

const game = {
  elapsed: 0,
  remaining: 120,
  score: 0,
  started: false,
  pointerLocked: false,
  cameraYaw: 0, // rendered camera heading; movement input stays relative to it
  cameraLookYaw: 0, // player mouse/drag adjustment on top of the automatic framing
  cameraPitch: -0.16,
  cameraDistance: 6.8,
  feedbackTimer: 0,
  player: {
    position: new THREE.Vector3(0, 0, 3.9),
    yaw: 0,
    desiredYaw: 0,
    currentSpeed: 0,
    action: 'idle',
    actionTime: 0,
    actionDuration: 0,
    actionProgress: 0,
    jumpY: 0,
    finishReleased: false,
    shotPending: null,
    shotReleaseCount: 0,
    motionDirection: new THREE.Vector3(0, 0, -1),
    stopElapsed: null,
    stopInitialSpeed: 0,
    stopMovingLastFrame: false,
    presentationPickup: null,
    presentationGather: null,
    presentationReleaseLocal: null,
    presentationFinish: null,
  },
  charge: {
    active: false,
    value: 0,
    pressTime: 0,
    window: greenWindow(4),
  },
  ball: {
    object: null,
    position: new THREE.Vector3(),
    previous: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    mode: 'dribble',
    dribblePhase: 0,
    dribbleBob: 0,
    canScore: false,
    scored: false,
    scoreTimer: 0,
    points: 2,
    flightAge: 0,
    finishKind: '',
    shotArc: null,
    perfectShot: false,
  },
};

function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function dampAngle(current, target, rate, dt) {
  let delta = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-rate * dt));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function horizontalDistance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function getPlayerForward(target = temp.forward) {
  target.set(-Math.sin(game.player.yaw), 0, -Math.cos(game.player.yaw));
  return target;
}

function getPlayerRight(target = temp.right) {
  target.set(Math.cos(game.player.yaw), 0, -Math.sin(game.player.yaw));
  return target;
}

function localPlayerPoint(x, y, z, target = temp.local) {
  target.set(x, y, z);
  player.group.localToWorld(target);
  return target;
}

function addDecorativeBallRack() {
  const rack = new THREE.Group();
  rack.name = 'sideline ball rack';
  rack.position.set(4.95, 0, -5.95);
  rack.rotation.y = -0.18;

  const metal = new THREE.MeshStandardMaterial({
    color: 0x202232,
    roughness: 0.38,
    metalness: 0.85,
  });
  const ballMaterial = new THREE.MeshStandardMaterial({
    color: 0xa64a22,
    roughness: 0.7,
  });
  const sphereGeometry = new THREE.SphereGeometry(0.115, 8, 6);
  const rail = (x1, y1, z1, x2, y2, z2, radius = 0.035) => {
    const start = new THREE.Vector3(x1, y1, z1);
    const end = new THREE.Vector3(x2, y2, z2);
    const direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, direction.length(), 6),
      metal,
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    rack.add(mesh);
  };

  rail(-0.68, 0.28, -0.2, 0.68, 0.28, -0.2);
  rail(-0.68, 0.28, 0.2, 0.68, 0.28, 0.2);
  rail(-0.68, 0.28, -0.2, -0.68, 0.62, -0.2);
  rail(0.68, 0.28, -0.2, 0.68, 0.62, -0.2);
  rail(-0.68, 0.28, 0.2, -0.68, 0.62, 0.2);
  rail(0.68, 0.28, 0.2, 0.68, 0.62, 0.2);

  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const ball = new THREE.Mesh(sphereGeometry, ballMaterial);
      ball.position.set(-0.48 + column * 0.24, 0.43 + row * 0.19, row === 0 ? -0.04 : 0.1);
      ball.castShadow = true;
      ball.rotation.set(row * 0.35, column * 0.8, 0);
      rack.add(ball);
    }
  }

  scene.add(rack);
}

game.ball.object = createBasketball();
scene.add(game.ball.object);
addDecorativeBallRack();

function setFeedback(text, kind = '', duration = 1.15) {
  feedbackElement.textContent = text;
  feedbackElement.classList.remove('is-good', 'is-bad');
  if (kind) feedbackElement.classList.add(kind === 'good' ? 'is-good' : 'is-bad');
  game.feedbackTimer = duration;
}

function eventTime(event) {
  // Older Safari builds exposed epoch timestamps; performance.now uses a relative clock.
  return event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp;
}

function chargeProgress(now) {
  return meterProgress(game.charge.pressTime, now);
}

function updateHud(now) {
  const seconds = Math.ceil(Math.max(0, game.remaining));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  clockElement.textContent = String(minutes).padStart(2, '0') + ':' + rest;
  scoreElement.textContent = String(game.score).padStart(2, '0');

  const action = game.charge.active
    ? 'JUMP SHOT'
    : game.player.action === 'layup'
      ? 'LAYUP'
      : game.player.action === 'dunk'
        ? 'DUNK'
        : game.ball.mode === 'loose'
          ? 'CHASE BALL'
          : 'FREE RUN';
  actionLabel.textContent = action;

  if (game.charge.active) {
    game.charge.value = chargeProgress(now);
    shotMeter.classList.add('is-charging');
  } else {
    shotMeter.classList.remove('is-charging');
  }
  const progress = game.charge.value;
  meterFill.style.transform = `scaleX(${progress})`;
  meterNeedle.style.transform = `translateX(${progress * meterTrackWidth}px)`;
  if (meterDebug && game.charge.active) {
    const fillEdge = meterFill.getBoundingClientRect().right;
    const markerCenter = meterNeedle.getBoundingClientRect().left + 1.5;
    console.debug('meter edges', { fillEdge, markerCenter, deltaPx: fillEdge - markerCenter, progress });
  }
}

function setBallPosition(position) {
  game.ball.position.copy(position);
  game.ball.object.position.copy(position);
  const shadow = game.ball.object.userData.shadow;
  shadow.scale.setScalar(clamp(1.1 - position.y * 0.19, 0.32, 1));
  shadow.material.opacity = clamp(0.37 - position.y * 0.065, 0.04, 0.34);
}

function updateBallRotation(dt) {
  const velocity = game.ball.velocity;
  if (game.ball.mode === 'dribble' || game.ball.mode === 'gather' || game.ball.mode === 'finish') {
    game.ball.object.rotation.x += dt * 4.4;
  } else {
    game.ball.object.rotation.x += velocity.z * dt / BALL_RADIUS;
    game.ball.object.rotation.z -= velocity.x * dt / BALL_RADIUS;
  }
}

function resetPossession(keepScore = true) {
  player.resetPose();
  game.charge.active = false;
  game.charge.value = 0;
  game.charge.pressTime = 0;
  game.player.position.set(0, 0, 3.9);
  game.player.yaw = 0;
  game.player.desiredYaw = 0;
  game.player.currentSpeed = 0;
  game.player.action = 'idle';
  game.player.actionTime = 0;
  game.player.actionDuration = 0;
  game.player.actionProgress = 0;
  game.player.jumpY = 0;
  game.player.finishReleased = false;
  game.player.shotPending = null;
  game.player.shotReleaseCount = 0;
  game.player.stopElapsed = null;
  game.player.stopInitialSpeed = 0;
  game.player.stopMovingLastFrame = false;
  game.player.presentationPickup = null;
  game.player.presentationGather = null;
  game.player.presentationReleaseLocal = null;
  game.player.presentationFinish = null;

  game.ball.mode = 'dribble';
  game.ball.velocity.set(0, 0, 0);
  game.ball.canScore = false;
  game.ball.scored = false;
  game.ball.scoreTimer = 0;
  game.ball.flightAge = 0;
  game.ball.finishKind = '';
  game.ball.shotArc = null;
  game.ball.perfectShot = false;
  game.ball.dribblePhase = 0;
  game.ball.dribbleBob = 0;

  // Reset can occur after this frame's pose update (automatic possession
  // recovery). Seed the visible ready pose and ball in the same transaction
  // so the canonical neutral rig cannot flash for one rendered frame.
  player.group.position.copy(game.player.position);
  player.group.rotation.y = game.player.yaw;
  const readyBall = getDribblePresentationLocal(0);
  player.update(0, { motionPack: 'authored', action: 'idle', speed: 0,
    facing: game.player.yaw, jump: 0, shotProgress: 0, dribblePhase: 0,
    ballMode: 'dribble', ballLocal: readyBall, ballRadius: BALL_RADIUS });
  setBallPosition(localPlayerPoint(...readyBall, temp.ballAnchor));
  game.ball.previous.copy(game.ball.position);

  if (!keepScore) {
    game.score = 0;
    game.remaining = 120;
  }
  setFeedback(keepScore ? 'FRESH POSSESSION' : 'NEW RUN', '', 0.9);
}

function getShotAnchor(charge = 0, target = temp.ballAnchor) {
  const gather = game.player.presentationGather;
  const lift=clamp(charge*1.3/.5,0,1), e=lift*lift*(3-2*lift);
  let point = [.28,1.20+.55*e,-.23];
  const blend=clamp(charge*1.3/.16,0,1);
  if(gather?.origin)point=point.map((v,i)=>gather.origin[i]+(v-gather.origin[i])*blend*blend*(3-2*blend));
  const shot = game.player.shotPending;
  if (shot && !shot.released) {
    const t = clamp(game.player.actionTime / .200, 0, 1), a = t * t * (3 - 2 * t);
    const authored=samplePolished(THREE,'shoot',Math.min(.2,game.player.actionTime)).ballLocal || POLISHED_PACK.clips.shoot.samples[6].ballLocal;
    point = shot.startLocal.map((v, i) => v + (authored[i] - v) * a);
  }
  return localPlayerPoint(...point, target);
}

function launchBall(start, target, time, options = {}) {
  const ball = game.ball;
  const safeTime = Math.max(0.14, time);
  setBallPosition(start);
  ball.previous.copy(start);
  ball.velocity.copy(target).sub(start).multiplyScalar(1 / safeTime);
  ball.velocity.y += 0.5 * GRAVITY * safeTime;
  ball.mode = 'flight';
  ball.canScore = options.canScore ?? true;
  ball.scored = false;
  ball.scoreTimer = 0;
  ball.points = options.points ?? 2;
  ball.flightAge = 0;
  ball.finishKind = options.finishKind ?? '';
  ball.shotArc = options.shotArc ?? null;
  ball.perfectShot = options.perfectShot ?? false;
}

// Input release commits the jump, then the physical release
// occurs once, at the 200 ms apex. Charge grading remains the original system.
function releaseJumpShot(releaseTime = performance.now()) {
  if (!game.charge.active || game.player.shotPending) return;
  const charge = chargeProgress(releaseTime);
  game.charge.value = charge;
  const grade = gradeShot(charge, game.charge.window);
  player.group.updateWorldMatrix(true, false);
  game.player.shotPending = {
    charge, grade, released: false, releaseInputTime: releaseTime,
    startLocal: player.group.worldToLocal(game.ball.position.clone()).toArray(),
  };
  game.player.presentationPickup = null;
  game.charge.active = false;
  game.player.action = 'shoot';
  game.player.actionTime = 0;
  game.player.actionDuration = POLISHED_PACK.clips.shoot.duration;
  game.player.actionProgress = .57;
  game.player.currentSpeed = 0;
  setFeedback(grade, grade === 'ON TIME' ? 'good' : 'bad', 1.1);
}

function detachJumpShot() {
  const shot = game.player.shotPending;
  if (!shot || shot.released) return false;
  const {charge, grade} = shot;
  const start = getShotAnchor(charge, new THREE.Vector3()).clone();
  game.player.presentationReleaseLocal = player.group.worldToLocal(start.clone()).toArray();
  const rim = arena.hoop.rimCenter;
  const target = shotTarget(start, rim, grade, charge, game.charge.window);
  const arc = solveShotArc(start, target);
  shot.released = true;
  shot.detachedAt = game.player.actionTime;
  shot.detachRootY = game.player.jumpY;
  shot.detachWorld = start.toArray();
  game.player.shotReleaseCount++;
  launchBall(start, target, arc.time, {
    canScore: grade === 'ON TIME' || Math.abs(charge - (grade === 'EARLY' ? game.charge.window.start : game.charge.window.end)) < .03,
    points: horizontalDistance(start, rim) > 6.45 ? 3 : 2,
    shotArc: arc, perfectShot: grade === 'ON TIME',
  });
  return true;
}

function releaseFinish() {
  const action = game.player.action;
  const isDunk = action === 'dunk';
  const start = player.getHeldBallWorldPosition(new THREE.Vector3());
  const target = arena.hoop.rimCenter.clone();
  target.y += isDunk ? -0.12 : 0.035;
  target.z += isDunk ? 0.015 : 0.055;
  const distance = horizontalDistance(start, target);
  // Keep the hoop crossing on the descending half of the arc. A shorter
  // launch can reach a rim-height target while the ball is still rising,
  // which looks weightless and skips the make detector on close finishes.
  launchBall(start, target, isDunk ? 0.42 : clamp(0.64 + distance * 0.04, 0.64, 0.78), {
    canScore: true,
    points: 2,
    finishKind: isDunk ? 'DUNK' : 'LAYUP',
  });
  game.player.finishReleased = true;
  if (isDunk) {
    arena.hoop.net.userData.energy = 0.9;
    audio.rim(0.92);
    audio.dunk(1);
  }
}

function startCharge(pressTime = performance.now()) {
  if (!game.started || game.charge.active || game.ball.mode !== 'dribble') return;
  if (game.player.action !== 'idle' && game.player.action !== 'move') return;
  player.group.updateWorldMatrix(true, false);
  game.player.shotPending = null;
  game.player.presentationGather = { origin: player.group.worldToLocal(game.ball.position.clone()).toArray() };
  game.player.presentationPickup = null;
  game.player.presentationReleaseLocal = null;
  game.player.presentationFinish = null;
  game.charge.active = true;
  game.charge.value = 0;
  game.charge.pressTime = pressTime;
  const distance = horizontalDistance(game.player.position, arena.hoop.rimCenter);
  game.charge.window = greenWindow(distance, game.player.currentSpeed);
  shotMeter.style.setProperty('--green-start', `${game.charge.window.start * 100}%`);
  shotMeter.style.setProperty('--green-width', `${(game.charge.window.end - game.charge.window.start) * 100}%`);
  game.player.action = 'shoot';
  game.player.actionTime = 0;
  game.player.actionDuration = 0;
  game.player.actionProgress = 0;
  game.ball.mode = 'gather';
  setFeedback('FIND THE GREEN', '', 1.4);
}

function startFinish() {
  if (!game.started || game.ball.mode !== 'dribble' || game.charge.active) return;
  if (game.player.action !== 'idle' && game.player.action !== 'move') return;

  const distance = horizontalDistance(game.player.position, arena.hoop.rimCenter);
  if (distance > 4.9) {
    setFeedback('GET CLOSER', 'bad', 0.85);
    return;
  }

  const dunk = distance < 2.35 && game.player.currentSpeed > 1.6;
  player.group.updateWorldMatrix(true, false);
  game.player.presentationFinish = { origin: player.group.worldToLocal(game.ball.position.clone()).toArray() };
  game.player.presentationPickup = null;
  game.player.presentationGather = null;
  game.player.presentationReleaseLocal = null;
  game.player.action = dunk ? 'dunk' : 'layup';
  game.player.actionTime = 0;
  game.player.actionDuration = dunk ? 0.76 : 0.84;
  game.player.actionProgress = 0;
  game.player.finishReleased = false;
  game.player.shotPending = null;
  game.player.shotReleaseCount = 0;
  game.player.stopElapsed = null;
  game.player.stopInitialSpeed = 0;
  game.player.stopMovingLastFrame = false;
  game.ball.mode = 'finish';
  game.ball.finishKind = dunk ? 'DUNK' : 'LAYUP';
  setFeedback(dunk ? 'RISE UP' : 'ATTACK THE RIM', '', 0.95);
}

function scoreBasket() {
  const ball = game.ball;
  if (ball.scored) return;
  ball.scored = true;
  ball.canScore = false;
  ball.scoreTimer = 0.68;
  game.score += ball.points;
  arena.hoop.net.userData.energy = ball.finishKind === 'DUNK' ? 1.15 : 0.8;
  audio.score(ball.finishKind === 'DUNK' ? 1 : 0.78);

  const suffix = ball.finishKind || (ball.points === 3 ? '3PT' : 'BUCKET');
  setFeedback(suffix === 'BUCKET' ? '+2 BUCKET' : '+2 ' + suffix, 'good', 1.55);
  if (ball.points === 3) setFeedback('+3 BUCKET', 'good', 1.55);
}

function resolveBackboardCollision() {
  const ball = game.ball;
  const board = arena.hoop;
  if (ball.velocity.z >= 0) return;
  if (ball.position.x < -board.backboardWidth * 0.5 - BALL_RADIUS) return;
  if (ball.position.x > board.backboardWidth * 0.5 + BALL_RADIUS) return;
  if (ball.position.y < board.backboardBottom - BALL_RADIUS) return;
  if (ball.position.y > board.backboardCenter.y + board.backboardHeight * 0.5 + BALL_RADIUS) return;

  const surface = board.backboardFrontZ + BALL_RADIUS;
  if (ball.previous.z > surface && ball.position.z <= surface) {
    ball.position.z = surface;
    ball.velocity.z = Math.abs(ball.velocity.z) * 0.68;
    ball.velocity.x *= 0.82;
    ball.velocity.y *= 0.9;
    audio.backboard(clamp(ball.velocity.length() / 7, 0.2, 1));
    return true;
  }
  return false;
}

function resolveRimCollision() {
  const ball = game.ball;
  const rim = arena.hoop;
  // Contextual finishes are authored make paths. Let them enter the cylinder
  // cleanly; their score callback already drives the net, swish, and dunk
  // rim hit. Standard jumpers still receive the full physical rim response.
  if (ball.finishKind && (ball.canScore || ball.scored)) return;
  const dx = ball.position.x - rim.rimCenter.x;
  const dz = ball.position.z - rim.rimCenter.z;
  const radial = Math.hypot(dx, dz);
  const vertical = ball.position.y - rim.rimHeight;
  const contact = BALL_RADIUS + 0.055;

  if (Math.abs(vertical) > contact || radial < rim.rimRadius - contact || radial > rim.rimRadius + contact) return;

  temp.ballNormal.set(dx, vertical * 0.68, dz);
  if (temp.ballNormal.lengthSq() < 0.0001) return;
  temp.ballNormal.normalize();
  const incoming = ball.velocity.dot(temp.ballNormal);
  if (incoming >= 0) return;

  ball.velocity.addScaledVector(temp.ballNormal, -incoming * 1.74);
  ball.velocity.multiplyScalar(0.83);
  ball.position.addScaledVector(temp.ballNormal, 0.018);
  arena.hoop.net.userData.energy = Math.max(arena.hoop.net.userData.energy ?? 0, 0.32);
  audio.rim(clamp(Math.abs(incoming) / 7, 0.18, 1));
  return true;
}

function updateDribble(dt) {
  const ball = game.ball;
  ball.dribblePhase += dt * (Math.PI*2/.8) * (game.player.currentSpeed > .2 ? clamp(game.player.currentSpeed/1.6,.65,1.55) : 1);
  const bob = 0.5 + Math.sin(ball.dribblePhase) * 0.5;
  const local = getDribblePresentationLocal(ball.dribblePhase);
  setBallPosition(localPlayerPoint(...local, temp.ballAnchor));

  if (bob < 0.11 && ball.dribbleBob >= 0.11) {
    audio.bounce(game.player.currentSpeed > 0.2 ? 0.72 : 0.48);
  }
  ball.dribbleBob = bob;
}

function getDribblePresentationLocal(phase) {
  const u=((phase/(Math.PI*2)+.25)%1+1)%1;
  const moving=game.player.currentSpeed>.2, height=moving?1.30:1.16;
  const dribble = [moving?.50:.48, BALL_RADIUS+4*(height-BALL_RADIUS)*u*(1-u), -.20];
  const pickup = game.player.presentationPickup;
  return pickup ? pickupBallLocal(pickup.origin, pickup.elapsed / PICKUP_SECONDS, dribble) : dribble;
}

function updateGatherBall() {
  const anchor = getShotAnchor(game.charge.value, temp.ballAnchor);
  setBallPosition(anchor);
}

function updateFinishBall() {
  player.group.updateMatrixWorld(true);
  const hand = player.getHeldBallWorldPosition(temp.ballAnchor);
  setBallPosition(hand);
}

function updateFlightBall(dt) {
  const ball = game.ball;
  ball.previous.copy(ball.position);
  ball.flightAge += dt;
  if (ball.shotArc) {
    const sample = sampleShotArc(ball.shotArc, ball.flightAge);
    ball.position.set(sample.position.x, sample.position.y, sample.position.z);
    ball.velocity.set(sample.velocity.x, sample.velocity.y, sample.velocity.z);
  } else {
    ball.velocity.y -= GRAVITY * dt;
    ball.position.addScaledVector(ball.velocity, dt);
  }

  const rim = arena.hoop;
  if (
    ball.canScore
    && !ball.scored
    && crossesHoop(ball.previous, ball.position, ball.velocity, rim, BALL_RADIUS)
  ) {
    scoreBasket();
  }

  if (!ball.perfectShot || ball.position.y < rim.rimHeight - BALL_RADIUS * 2) {
    const hitBoard = resolveBackboardCollision();
    const hitRim = resolveRimCollision();
    if (hitBoard || hitRim) ball.shotArc = null;
  }
  if (ball.position.y < rim.rimHeight - BALL_RADIUS * 2) {
    ball.shotArc = null;
    ball.perfectShot = false;
  }

  if (ball.position.y < BALL_RADIUS) {
    const impact = Math.abs(ball.velocity.y);
    ball.position.y = BALL_RADIUS;
    ball.velocity.y = Math.abs(ball.velocity.y) * 0.6;
    ball.velocity.x *= 0.8;
    ball.velocity.z *= 0.8;
    if (impact > 0.8) audio.bounce(clamp(impact / 7, 0.18, 1));
    if (impact < 1.25 && ball.velocity.length() < 1.5) {
      ball.mode = 'loose';
      ball.velocity.set(0, 0, 0);
    }
  }

  setBallPosition(ball.position);
  if (ball.position.y > 11 || Math.abs(ball.position.x) > 12 || ball.position.z > 12 || ball.position.z < -10) {
    ball.mode = 'loose';
    ball.velocity.set(0, 0, 0);
  }
  if (ball.flightAge > 5.5) {
    ball.mode = 'loose';
  }
}

function updateLooseBall(dt) {
  const ball = game.ball;
  if (ball.position.y > BALL_RADIUS + 0.001) {
    ball.previous.copy(ball.position);
    ball.velocity.y -= GRAVITY * dt;
    ball.position.addScaledVector(ball.velocity, dt);
    if (ball.position.y < BALL_RADIUS) {
      ball.position.y = BALL_RADIUS;
      ball.velocity.y = Math.abs(ball.velocity.y) * 0.48;
      ball.velocity.x *= 0.66;
      ball.velocity.z *= 0.66;
    }
    setBallPosition(ball.position);
  }

  if (horizontalDistance(ball.position, game.player.position) < 0.78 && ball.position.y < 0.82) {
    player.group.updateWorldMatrix(true, false);
    game.player.presentationPickup = { elapsed: 0, origin: player.group.worldToLocal(ball.position.clone()).toArray() };
    game.player.presentationGather = null;
    game.player.presentationReleaseLocal = null;
    ball.mode = 'dribble';
    ball.velocity.set(0, 0, 0);
    ball.scored = false;
    ball.canScore = false;
    setFeedback('BALL SECURED', 'good', 0.8);
  }
}

function updateBall(dt) {
  const ball = game.ball;
  const justDetached = game.player.shotPending && !game.player.shotPending.released && game.player.actionTime >= .200 - 1e-8 && detachJumpShot();
  if (justDetached) { /* Render the exact apex release before any free-flight step. */ }
  else if (ball.mode === 'dribble') updateDribble(dt);
  else if (ball.mode === 'gather') updateGatherBall();
  else if (ball.mode === 'finish') updateFinishBall();
  else if (ball.mode === 'flight') updateFlightBall(dt);
  else if (ball.mode === 'loose') updateLooseBall(dt);

  if (ball.scored && ball.scoreTimer > 0) {
    ball.scoreTimer -= dt;
    if (ball.scoreTimer <= 0) resetPossession(true);
  }
  updateBallRotation(dt);
}

function constrainPlayerToCourt() {
  const bounds = arena.court.bounds;
  game.player.position.x = clamp(game.player.position.x, bounds.minX + 0.48, bounds.maxX - 0.48);
  game.player.position.z = clamp(game.player.position.z, bounds.minZ + 0.62, bounds.maxZ - 0.48);
}

function updatePlayer(dt, now) {
  const p = game.player;
  const move = temp.move.set(input.touchX, 0, input.touchY);
  if (input.forward) move.z += 1;
  if (input.backward) move.z -= 1;
  if (input.right) move.x += 1;
  if (input.left) move.x -= 1;

  if (move.lengthSq() > 0) {
    move.normalize();
    const cameraForward = temp.forward.set(-Math.sin(game.cameraYaw), 0, -Math.cos(game.cameraYaw));
    const cameraRight = temp.right.set(Math.cos(game.cameraYaw), 0, -Math.sin(game.cameraYaw));
    const worldMove = cameraForward.multiplyScalar(move.z).addScaledVector(cameraRight, move.x);
    move.copy(worldMove).normalize();
  }

  // Intentional movement may cancel cosmetic recovery once both feet land.
  // It never waits for a make/miss or ball pickup.
  if (p.action === 'shoot' && !game.charge.active && p.actionTime >= .4 - 1e-8 && move.lengthSq() > 0) {
    p.action = 'idle'; p.actionProgress = 0;
  }
  p.jumpY = 0;
  if (game.charge.active) {
    const hoopDirection = temp.toHoop.copy(arena.hoop.rimCenter).sub(p.position);
    hoopDirection.y = 0;
    if (hoopDirection.lengthSq() > .01) p.desiredYaw = Math.atan2(-hoopDirection.x, -hoopDirection.z);
    game.charge.value = chargeProgress(now);
    p.action = 'shoot';
    p.actionProgress = game.charge.value * 0.58;
    p.currentSpeed = damp(p.currentSpeed, 0, 14, dt);
    if (game.charge.value >= 1) releaseJumpShot(now);
  } else if (p.action === 'shoot') {
    p.actionTime += dt;
    p.actionProgress = clamp(0.57 + p.actionTime / Math.max(0.01, p.actionDuration) * 0.43, 0, 1);
    if (p.shotPending) {
      const t = p.actionTime;
      p.jumpY = t <= .2 ? .3048 * (1 - (1 - t / .2) ** 2)
        : t < .4 - 1e-8 ? .3048 * (1 - ((t - .2) / .2) ** 2) : 0;
    }
    p.currentSpeed = damp(p.currentSpeed, 0, 13, dt);
    if (p.actionTime >= p.actionDuration) {
      p.action = 'idle';
      p.actionProgress = 0;
    }
  } else if (p.action === 'layup' || p.action === 'dunk') {
    p.actionTime += dt;
    p.actionProgress = clamp(p.actionTime / p.actionDuration, 0, 1);
    const hoopDirection = temp.toHoop.copy(arena.hoop.rimCenter).sub(p.position);
    hoopDirection.y = 0;
    const distance = hoopDirection.length();
    if (distance > 0.001) hoopDirection.multiplyScalar(1 / distance);
    p.desiredYaw = Math.atan2(-hoopDirection.x, -hoopDirection.z);
    const attackSpeed = p.action === 'dunk' ? 3.55 : 2.75;
    if (distance > (p.action === 'dunk' ? 0.85 : 1.05)) {
      p.position.addScaledVector(hoopDirection, attackSpeed * dt);
    }
    p.currentSpeed = attackSpeed;
    p.jumpY = Math.sin(Math.PI * p.actionProgress) * (p.action === 'dunk' ? 0.86 : 0.64);

    const releaseAt = p.action === 'dunk' ? 0.57 : 0.59;
    if (!p.finishReleased && p.actionProgress >= releaseAt) releaseFinish();
    if (p.actionProgress >= 1) {
      p.action = 'idle';
      p.actionProgress = 0;
      p.jumpY = 0;
    }
  } else {
    const hasMove = move.lengthSq() > 0;
    const targetSpeed = hasMove ? (input.sprint ? 5.45 : 3.38) : 0;
    p.currentSpeed = damp(p.currentSpeed, targetSpeed, hasMove ? 12 : 15, dt);
    if (hasMove) {
      p.motionDirection.copy(move); p.stopElapsed = null; p.stopMovingLastFrame = true;
      p.position.addScaledVector(move, p.currentSpeed * dt);
      p.desiredYaw = Math.atan2(-move.x, -move.z);
      p.action = 'move';
      if (p.currentSpeed > 1.25) audio.shoe(clamp(p.currentSpeed / 5.5, 0.2, 0.72));
    } else {
      if (p.stopMovingLastFrame) { p.stopElapsed = 0; p.stopInitialSpeed = p.currentSpeed / Math.exp(-15 * dt); }
      p.stopMovingLastFrame = false;
      if (p.stopElapsed !== null) {
        const oldSpeed = p.stopInitialSpeed * (1 - clamp(p.stopElapsed / .30, 0, 1)) ** 2;
        p.stopElapsed += dt;
        p.currentSpeed = p.stopInitialSpeed * (1 - clamp(p.stopElapsed / .30, 0, 1)) ** 2;
        p.position.addScaledVector(p.motionDirection, (oldSpeed + p.currentSpeed) * .5 * dt);
        if (p.stopElapsed >= .30) p.currentSpeed = 0;
      }
      p.action = 'idle';
      const hoopDirection = temp.toHoop.copy(arena.hoop.rimCenter).sub(p.position);
      hoopDirection.y = 0;
      if (hoopDirection.lengthSq() > 0.01) p.desiredYaw = Math.atan2(-hoopDirection.x, -hoopDirection.z);
    }
  }

  constrainPlayerToCourt();
  p.yaw = dampAngle(p.yaw, p.desiredYaw, p.currentSpeed > 0.2 ? 16 : 7, dt);
  player.group.position.set(p.position.x, p.jumpY, p.position.z);
  player.group.rotation.y = p.yaw;
  if (p.presentationPickup && game.ball.mode === 'dribble') {
    p.presentationPickup.elapsed += dt;
    if (p.presentationPickup.elapsed >= PICKUP_SECONDS) p.presentationPickup = null;
  }
  // Predict this frame's attached ball before the sole pose writer runs. The
  // ball update consumes the identical path; no second arm writer follows it.
  const nextDribblePhase = game.ball.dribblePhase + dt * (Math.PI*2/.8) * (p.currentSpeed > .2 ? clamp(p.currentSpeed/1.6,.65,1.55) : 1);
  const ballLocal = game.ball.mode === 'dribble' ? getDribblePresentationLocal(nextDribblePhase)
    : game.ball.mode === 'gather' ? player.group.worldToLocal(getShotAnchor(game.charge.value, new THREE.Vector3())).toArray()
      : null;
  player.update(dt, {
    motionPack: 'authored',
    speed: p.currentSpeed,
    facing: p.yaw,
    jump: clamp(p.jumpY / 0.9, 0, 1),
    dribblePhase: nextDribblePhase,
    ballMode: game.ball.mode,
    action: p.action,
    shotProgress: p.actionProgress,
    ballLocal,
    ballRadius: BALL_RADIUS,
    pickupProgress: p.presentationPickup ? p.presentationPickup.elapsed / PICKUP_SECONDS : null,
    gatherElapsed: game.charge.active ? game.charge.value * 1.3 : null,
    releaseProgress: p.action === 'shoot' && !game.charge.active ? clamp(p.actionTime / POLISHED_PACK.clips.shoot.duration, 0, 1) : null,
    shootElapsed: p.shotPending && p.action==='shoot' ? p.actionTime : null,
    shotReleased: !!p.shotPending?.released,
    stopElapsed: p.stopElapsed,
    stopInitialSpeed: p.stopInitialSpeed,
    rootWorld: player.group.position.toArray(),
    charging: game.charge.active,
    releaseLocal: p.presentationReleaseLocal,
    finishOriginLocal: p.presentationFinish?.origin,
    finishElapsed: p.actionTime,
  });
}

function updateNet(dt) {
  const net = arena.hoop.net;
  const energy = Math.max(0, (net.userData.energy ?? 0) - dt * 2.2);
  net.userData.energy = energy;
  const pulse = Math.sin(game.elapsed * 27) * energy;
  net.rotation.x = pulse * 0.09;
  net.rotation.z = Math.cos(game.elapsed * 21) * energy * 0.075;
  net.scale.set(1 + energy * 0.05, 1 - energy * 0.09, 1 + energy * 0.05);
}

function updateArenaPresentation() {
  const pulse = 1.25 + Math.sin(game.elapsed * 2.2) * 0.32;
  arena.group.traverse((child) => {
    if (child.name === 'arena video board' && child.material?.emissiveIntensity !== undefined) {
      child.material.emissiveIntensity = pulse;
    }
  });
}

// Camera framing settings. Angles in degrees, distances/heights in metres,
// follow speeds as exponential rates per second (higher = snappier).
const CAMERA = {
  sideAngle: 35, // off the player-to-rim line, toward Luke's ball (right) hand
  height: 2.0, // camera height above the floor, about Luke's head
  distance: 5.0, // behind the player along that offset line
  fov: 52,
  lookHeight: 1.35, // aim height at the player end of the frame
  rimBias: 0.32, // how far the aim point slides from player toward the rim (0-1)
  shotRimBias: 0.45, // aim bias held during shots so the arc and rim stay in frame
  // Tall screens see far less sideways, so they get their own values.
  portrait: { sideAngle: 26, distance: 6.6, fov: 68, lookHeight: 0.55, rimBias: 0.2, shotRimBias: 0.3 },
  nearRimBlend: 3.2, // inside this range the rim line eases toward the court axis
  followSpeed: 7, // position follow while running
  aimSpeed: 6, // look-at follow
  yawFollowSpeed: 1.6, // how quickly the side angle re-centres as he moves
  shotHoldAfter: 0.6, // seconds the shot framing holds after the ball leaves flight
};
const cameraState = {
  initialized: false,
  autoYaw: 0,
  hold: null,
  holdTimer: 0,
  focus: new THREE.Vector3(),
  aim: new THREE.Vector3(),
  desiredAim: new THREE.Vector3(),
};

function shotFramingActive() {
  const p = game.player;
  return game.charge.active || p.action === 'shoot' || p.action === 'layup' || p.action === 'dunk' || game.ball.mode === 'flight';
}

function rimLineYaw(position) {
  const rim = arena.hoop.rimCenter;
  const dx = position.x - rim.x, dz = position.z - rim.z, distance = Math.hypot(dx, dz);
  // Near the basket the player-rim line is unstable; lean on the court axis.
  const axis = clamp(1 - distance / CAMERA.nearRimBlend, 0, 1) * CAMERA.nearRimBlend;
  return Math.atan2(dx, dz + axis);
}

// Original straight-behind follow camera, kept for ?look=old comparison.
function updateClassicCamera(dt) {
  const target = temp.cameraTarget.copy(game.player.position);
  target.y += 1.05 + game.player.jumpY * 0.22;

  const pitch = game.cameraPitch;
  const yaw = game.cameraYaw = game.cameraLookYaw;
  const horizontalDistance = game.cameraDistance * Math.cos(pitch);
  temp.cameraDesired.set(
    target.x + Math.sin(yaw) * horizontalDistance,
    target.y + 1.25 - Math.sin(pitch) * game.cameraDistance,
    target.z + Math.cos(yaw) * horizontalDistance,
  );
  camera.position.lerp(temp.cameraDesired, 1 - Math.exp(-dt * 11));
  camera.lookAt(target);
}

function updateCamera(dt) {
  if (LOOK === 'old') { updateClassicCamera(dt); return; }
  const portrait = camera.aspect < 1;
  const frame = portrait ? { ...CAMERA, ...CAMERA.portrait } : CAMERA;
  const fov = frame.fov;
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

  // Hold one framing from gather until the ball is resolved: the jump is not
  // followed vertically and the rim stays in shot.
  if (shotFramingActive()) {
    cameraState.holdTimer = CAMERA.shotHoldAfter;
    if (!cameraState.hold) cameraState.hold = { focus: game.player.position.clone(), yaw: cameraState.autoYaw };
  } else if (cameraState.hold && (cameraState.holdTimer -= dt) <= 0) {
    cameraState.hold = null;
  }

  const hold = cameraState.hold;
  const source = hold ? hold.focus : game.player.position;
  const targetYaw = hold ? hold.yaw : rimLineYaw(source) + THREE.MathUtils.degToRad(frame.sideAngle);
  if (!cameraState.initialized) {
    cameraState.autoYaw = targetYaw;
    cameraState.focus.copy(source);
  }
  cameraState.autoYaw = dampAngle(cameraState.autoYaw, targetYaw, CAMERA.yawFollowSpeed, dt);
  const follow = 1 - Math.exp(-dt * CAMERA.followSpeed);
  cameraState.focus.lerp(source, follow);

  const yaw = cameraState.autoYaw + game.cameraLookYaw;
  const zoom = game.cameraDistance / 6.8;
  const distance = frame.distance * zoom;
  const lift = (game.cameraPitch + 0.16) * -distance; // mouse/drag tilt
  temp.cameraDesired.set(
    cameraState.focus.x + Math.sin(yaw) * distance,
    Math.max(0.6, CAMERA.height + lift),
    cameraState.focus.z + Math.cos(yaw) * distance,
  );
  const rim = arena.hoop.rimCenter;
  const bias = hold ? frame.shotRimBias : frame.rimBias;
  cameraState.desiredAim.set(cameraState.focus.x, frame.lookHeight, cameraState.focus.z)
    .lerp(temp.cameraTarget.set(rim.x, rim.y, rim.z), bias);
  // Keep the player end of the frame anchored: aim never rises above the
  // camera so the floor and his feet stay visible.
  cameraState.desiredAim.y = Math.min(cameraState.desiredAim.y, temp.cameraDesired.y);

  if (!cameraState.initialized) {
    camera.position.copy(temp.cameraDesired);
    cameraState.aim.copy(cameraState.desiredAim);
    cameraState.initialized = true;
  }
  camera.position.lerp(temp.cameraDesired, follow);
  cameraState.aim.lerp(cameraState.desiredAim, 1 - Math.exp(-dt * CAMERA.aimSpeed));
  camera.lookAt(cameraState.aim);
  game.cameraYaw = Math.atan2(camera.position.x - cameraState.aim.x, camera.position.z - cameraState.aim.z);
  arena.lighting.update(camera.position, cameraState.focus);
}

function update(dt, now) {
  // Resolve the release and landing at their real event times even when a
  // rendered frame straddles them. The remainder advances normal physics.
  if (game.player.action === 'shoot' && !game.charge.active && game.player.shotPending) {
    const time = game.player.actionTime;
    const boundary = !game.player.shotPending.released ? .2 : time < .4 - 1e-8 ? .4 : null;
    if (boundary !== null && time < boundary - 1e-8 && time + dt > boundary + 1e-8) {
      const before = boundary - time, after = dt - before;
      update(before, now - after * 1000); update(after, now); return;
    }
  }
  game.elapsed += dt;
  if (game.started && game.remaining > 0) game.remaining = Math.max(0, game.remaining - dt);
  if (game.remaining <= 0 && game.started) {
    setFeedback('RUN OVER — PRESS R', 'bad', 999);
  }

  updatePlayer(dt, now);
  player.group.updateMatrixWorld(true);
  updateBall(dt);
  player.updateHandShapes(dt,game.ball.position,game.ball.mode);
  updateNet(dt);
  updateArenaPresentation();
  updateCamera(dt);

  if (game.feedbackTimer > 0 && game.feedbackTimer < 998) {
    game.feedbackTimer -= dt;
    if (game.feedbackTimer <= 0) {
      setFeedback(game.ball.mode === 'loose' ? 'CHASE IT DOWN' : 'FIND THE GREEN', '', 0);
    }
  }
  updateHud(now);
}

function render() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt, performance.now());
  renderer.render(scene, camera);
}

function unlockAndStart() {
  if (player.group.userData.assetStatus !== 'ready') return;
  game.started = true;
  audio.unlock();
  startButton.classList.add('is-hidden');
  if (!coarsePointer && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  setFeedback('ATTACK THE RIM', '', 1.1);
}

startButton.addEventListener('click', unlockAndStart);
canvas.addEventListener('click', () => {
  if (!game.started) {
    unlockAndStart();
  } else if (!coarsePointer && document.pointerLockElement !== canvas) {
    audio.unlock();
    canvas.requestPointerLock?.();
  }
});

const touchStick = document.querySelector('#touchStick');
const touchKnob = document.querySelector('#touchKnob');
const touchSprint = document.querySelector('#touchSprint');
const touchFinish = document.querySelector('#touchFinish');
const touchShoot = document.querySelector('#touchShoot');
const touchReset = document.querySelector('#touchReset');
const touchControls = document.querySelector('.touch-controls');
let stickPointer = null;
let lookPointer = null;
let shootPointer = null;
let finishPointer = null;
let lastLookX = 0;
let lastLookY = 0;

function updateTouchStick(event) {
  const bounds = touchStick.getBoundingClientRect();
  const half = bounds.width / 2;
  const dx = (event.clientX - bounds.left - half) / (half * 0.72);
  const dy = (event.clientY - bounds.top - half) / (half * 0.72);
  const length = Math.max(1, Math.hypot(dx, dy));
  input.touchX = clamp(dx / length, -1, 1);
  input.touchY = clamp(-dy / length, -1, 1);
  touchKnob.style.transform = 'translate(' + (input.touchX * half * 0.49) + 'px, ' + (-input.touchY * half * 0.49) + 'px)';
}

touchStick.addEventListener('pointerdown', (event) => {
  if (stickPointer !== null) return;
  event.preventDefault();
  stickPointer = event.pointerId;
  touchStick.setPointerCapture(event.pointerId);
  updateTouchStick(event);
});
touchStick.addEventListener('pointermove', (event) => {
  if (event.pointerId === stickPointer) updateTouchStick(event);
});
function stopTouchStick(event) {
  if (event.pointerId !== stickPointer) return;
  stickPointer = null;
  input.touchX = 0;
  input.touchY = 0;
  touchKnob.style.transform = 'translate(0, 0)';
}
touchStick.addEventListener('pointerup', stopTouchStick);
touchStick.addEventListener('pointercancel', stopTouchStick);
touchStick.addEventListener('lostpointercapture', stopTouchStick);

canvas.addEventListener('pointerdown', (event) => {
  if (!coarsePointer || !game.started || lookPointer !== null) return;
  lookPointer = event.pointerId;
  lastLookX = event.clientX;
  lastLookY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== lookPointer) return;
  game.cameraLookYaw -= (event.clientX - lastLookX) * 0.006;
  game.cameraPitch = clamp(game.cameraPitch - (event.clientY - lastLookY) * 0.004, -0.52, 0.16);
  lastLookX = event.clientX;
  lastLookY = event.clientY;
});
function stopTouchLook(event) {
  if (event.pointerId === lookPointer) lookPointer = null;
}
canvas.addEventListener('pointerup', stopTouchLook);
canvas.addEventListener('pointercancel', stopTouchLook);
canvas.addEventListener('lostpointercapture', stopTouchLook);

touchSprint.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  touchSprint.setPointerCapture(event.pointerId);
  input.sprint = true;
  touchSprint.classList.add('is-held');
});
function stopTouchSprint() {
  input.sprint = false;
  touchSprint.classList.remove('is-held');
}
touchSprint.addEventListener('pointerup', stopTouchSprint);
touchSprint.addEventListener('pointercancel', stopTouchSprint);
touchSprint.addEventListener('lostpointercapture', stopTouchSprint);
touchFinish.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (finishPointer !== null) return;
  finishPointer = event.pointerId;
  touchFinish.setPointerCapture(event.pointerId);
  touchFinish.classList.add('is-held');
  startFinish();
});
function stopTouchFinish(event) {
  if (event.pointerId !== finishPointer) return;
  finishPointer = null;
  touchFinish.classList.remove('is-held');
}
touchFinish.addEventListener('pointerup', stopTouchFinish);
touchFinish.addEventListener('pointercancel', stopTouchFinish);
touchFinish.addEventListener('lostpointercapture', stopTouchFinish);
touchShoot.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (shootPointer !== null) return;
  shootPointer = event.pointerId;
  touchShoot.setPointerCapture(event.pointerId);
  touchShoot.classList.add('is-held');
  startCharge(eventTime(event));
});
function stopTouchShoot(event) {
  if (event.pointerId !== shootPointer) return;
  shootPointer = null;
  touchShoot.classList.remove('is-held');
  releaseJumpShot(eventTime(event));
}
touchShoot.addEventListener('pointerup', stopTouchShoot);
touchShoot.addEventListener('pointercancel', stopTouchShoot);
touchShoot.addEventListener('lostpointercapture', stopTouchShoot);
touchReset.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  resetPossession(false);
});

touchControls.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
for (const type of ['contextmenu', 'selectstart', 'gesturestart']) {
  document.querySelector('#app').addEventListener(type, (event) => event.preventDefault());
}

document.addEventListener('pointerlockchange', () => {
  game.pointerLocked = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (event) => {
  if (!game.pointerLocked) return;
  game.cameraLookYaw -= event.movementX * 0.00245;
  game.cameraPitch = clamp(game.cameraPitch - event.movementY * 0.0018, -0.52, 0.16);
});

window.addEventListener('wheel', (event) => {
  game.cameraDistance = clamp(game.cameraDistance + event.deltaY * 0.006, 4.2, 10.2);
}, { passive: true });

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyW') input.forward = true;
  if (event.code === 'KeyS') input.backward = true;
  if (event.code === 'KeyA') input.left = true;
  if (event.code === 'KeyD') input.right = true;
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') input.sprint = true;

  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) startCharge(eventTime(event));
  }
  if (event.code === 'KeyF' && !event.repeat) startFinish();
  if (event.code === 'KeyR' && !event.repeat) resetPossession(false);
  if (!game.started && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF'].includes(event.code)) {
    unlockAndStart();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'KeyW') input.forward = false;
  if (event.code === 'KeyS') input.backward = false;
  if (event.code === 'KeyA') input.left = false;
  if (event.code === 'KeyD') input.right = false;
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') input.sprint = false;
  if (event.code === 'Space') {
    event.preventDefault();
    releaseJumpShot(eventTime(event));
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.2));
  meterTrackWidth = meterTrack.clientWidth;
});

window.addEventListener('beforeunload', () => {
  audio.dispose();
  renderer.dispose();
});

resetPossession(false);
meterTrackWidth = meterTrack.clientWidth;
clock.start();
renderer.setAnimationLoop(render);
