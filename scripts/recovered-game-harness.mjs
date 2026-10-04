// Run the production gameplay functions against real recovered GLBs in Node.
// Only browser rendering, DOM display and audio outputs are replaced.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseGlb } from './luke-rig-tools.mjs';
import { createPlayer } from '../src/nba2k9-player.js';
import * as presentation from '../src/player-ball-presentation.js';
import * as shooting from '../src/shooting.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS = ['damp', 'dampAngle', 'clamp', 'horizontalDistance', 'getPlayerForward', 'getPlayerRight',
  'localPlayerPoint', 'eventTime', 'chargeProgress', 'setBallPosition', 'updateBallRotation', 'resetPossession',
  'getShotAnchor', 'launchBall', 'releaseJumpShot', 'detachJumpShot', 'releaseFinish', 'startCharge', 'startFinish',
  'scoreBasket', 'resolveBackboardCollision', 'resolveRimCollision', 'updateDribble', 'getDribblePresentationLocal',
  'updateGatherBall', 'updateFinishBall', 'updateFlightBall', 'updateLooseBall', 'updateBall',
  'constrainPlayerToCourt', 'updatePlayer', 'update', 'unlockAndStart'];

export async function parseRecoveredScene(data) {
  const { doc, binary } = parseGlb(Buffer.from(data)), parsed = structuredClone(doc);
  // Node has no DOM image decoder. Retain all geometry, skin indices, materials
  // and animation channels; remove only texture links from each material.
  parsed.images = []; parsed.textures = []; parsed.samplers = [];
  parsed.materials = (parsed.materials || []).map(material => ({
    name: material.name, doubleSided: material.doubleSided,
    pbrMetallicRoughness: { baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1],
      roughnessFactor: 1, metallicFactor: 0 },
  }));
  parsed.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  globalThis.ProgressEvent ||= class { constructor(type, properties) { Object.assign(this, { type, ...properties }); } };
  return new GLTFLoader().parseAsync(JSON.stringify(parsed), '');
}

export function fixtureFetch(requests = []) {
  return async url => {
    requests.push(url);
    const relative = url.replace(/^\/?(?:TheArena\/)?/, '');
    const data = await readFile(path.join(ROOT, 'public', relative));
    return { ok: true, status: 200,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  };
}

export async function buildRecoveredGameVM(player) {
  const [main, arenaSource] = await Promise.all(['src/main.js', 'src/arena.js'].map(file => readFile(path.join(ROOT, file), 'utf8')));
  const block = (source, start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    if (a < 0 || b < 0) throw new Error(`Gameplay source block missing: ${start}`);
    return source.slice(a, b);
  };
  const extract = name => {
    const a = main.indexOf(`function ${name}(`), b = main.indexOf('\n}', a);
    if (a < 0 || b < a) throw new Error(`Gameplay function missing: ${name}`);
    return main.slice(a, b + 2);
  };
  const noop = () => {}, clock = { now: 0 }, launches = [], audioCalls = [];
  const context = vm.createContext({ THREE, player, ...presentation, ...shooting, console,
    performance: { now: () => clock.now, timeOrigin: 0 },
    updateHud: noop, updateCamera: noop, updateNet: noop, updateArenaPresentation: noop, setFeedback: noop,
    audio: new Proxy({}, { get: (_, event) => (...args) => audioCalls.push({ event, args }) }),
    shotMeter: { style: { setProperty: noop }, classList: { add: noop, remove: noop } },
    startButton: { classList: { add: noop } }, playerPicker: { classList: { add: noop } },
    coarsePointer: true, document: { pointerLockElement: null }, canvas: { requestPointerLock: noop },
    onLaunch: (start, target, duration, options, state) => launches.push({
      start: start.toArray(), target: [target.x, target.y, target.z], duration, options: { ...options }, ...state,
      heldAtRelease: player.getHeldBallWorldPosition(new THREE.Vector3()).toArray(),
    }),
  });
  const constants = [block(main, 'const temp = {', 'const BALL_RADIUS ='),
    block(main, 'const input = {', 'function damp('), block(arenaSource, '  const V =', '  const materials =')];
  vm.runInContext(`${constants.join('\n')}\nconst arena={court,hoop};arena.hoop.net=new THREE.Group();
    const BALL_RADIUS=.12,GRAVITY=SHOT_GRAVITY;
    ${FUNCTIONS.map(extract).join('\n')}
    const originalLaunch=launchBall;
    launchBall=function(start,target,duration,options){
      onLaunch(start,target,duration,options,{elapsed:game.elapsed,action:game.player.action,
        actionTime:game.player.actionTime,actionProgress:game.player.actionProgress,jumpY:game.player.jumpY});
      return originalLaunch(start,target,duration,options);
    };
    this.api={game,input,arena,${FUNCTIONS.join(',')}};`, context, { filename: 'main.js(recovered gameplay)' });
  const api = context.api;
  const object = new THREE.Group(), shadow = new THREE.Object3D();
  shadow.material = { opacity: .34 }; object.userData.shadow = shadow;
  api.game.ball.object = object;
  return { api, clock, launches, audioCalls };
}

export async function createRecoveredGameHarness({ characterId = 'classic-one', hz = 60, jitter = 0, seed = 123 } = {}) {
  const requests = [], player = createPlayer(THREE, { characterId, fetchAsset: fixtureFetch(requests), parseModel: parseRecoveredScene });
  if (await player.group.userData.assetReady !== 'ready') throw new Error(player.group.userData.assetError);
  const { api, clock, launches, audioCalls } = await buildRecoveredGameVM(player);
  const poses = [], originalUpdate = player.update;
  player.update = (dt, state) => {
    const result = originalUpdate(dt, state);
    poses.push({ elapsed: api.game.elapsed, action: state.action, actionTime: api.game.player.actionTime,
      held: player.getHeldBallWorldPosition(new THREE.Vector3()).toArray() });
    return result;
  };
  let randomState = seed;
  const random = () => {
    randomState = Math.imul(1664525, randomState) + 1013904223 | 0;
    return (randomState >>> 0) / 4294967296;
  };
  function frame(dt = null) {
    const step = dt ?? Math.min(.05, (1 / hz) * (1 + jitter * (random() * 2 - 1)));
    clock.now += step * 1000; api.update(step, clock.now); return step;
  }
  function advance(seconds) {
    let elapsed = 0;
    while (elapsed < seconds - 1e-10) elapsed += frame(Math.min(1 / hz, seconds - elapsed));
  }
  function reset() {
    Object.keys(api.input).forEach(key => { api.input[key] = key.startsWith('touch') ? 0 : false; });
    api.resetPossession(false); api.game.started = true;
    launches.length = 0; poses.length = 0; audioCalls.length = 0;
  }
  reset();
  return { player, api, game: api.game, input: api.input, clock, launches, audioCalls, poses, requests, hz, frame, advance, reset };
}
