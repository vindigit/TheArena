#!/usr/bin/env node

// Original meter-scale hoop visual. Gameplay collision landmarks live in
// src/arena.js; this script only authors replaceable presentation geometry.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = path.join(root, 'public/assets/models/hoop/hoop-assembly-v1.glb');
const atlasPath = path.join(root, 'public/assets/textures/hoop/atlas-v1.png');
const parts = new Map();
const names = ['support', 'padding', 'arm', 'backboard', 'target_markings', 'rim', 'mounts', 'net'];
const tiles = {
  steel: 0, paint: 1, foam: 2, board: 3,
  orange: 4, ivory: 5, cord: 6, bolts: 7,
};
const rimCenter = [0, 3.05, -5.82];
const boardCenter = [0, 3.56, -6.25];
const boardWidth = 1.83;
const boardHeight = 1.07;
const boardThickness = 0.08;
const boardFrontZ = -6.21;

function part(name) {
  if (!parts.has(name)) parts.set(name, { positions: [], normals: [], uvs: [], indices: [] });
  return parts.get(name);
}

function uv(tile, u, v) {
  const column = tile % 4;
  const row = Math.floor(tile / 4);
  // Two-pixel inset prevents color bleed at mip levels.
  return [(column + 0.045 + u * 0.91) / 4, (row + 0.045 + v * 0.91) / 2];
}

function quad(name, tile, a, b, c, d) {
  const out = part(name);
  const ab = b.map((value, i) => value - a[i]);
  const ac = c.map((value, i) => value - a[i]);
  const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(...cross);
  if (length < 1e-9) throw new Error(`Degenerate face in ${name}`);
  const normal = cross.map((value) => value / length);
  const base = out.positions.length / 3;
  for (const [index, point] of [a, b, c, d].entries()) {
    out.positions.push(...point);
    out.normals.push(...normal);
    out.uvs.push(...uv(tile, index === 1 || index === 2 ? 1 : 0, index >= 2 ? 1 : 0));
  }
  out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function box(name, tile, x0, x1, y0, y1, z0, z1, faces = ['xp', 'xm', 'yp', 'ym', 'zp', 'zm']) {
  const corners = {
    xp: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    xm: [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]],
    yp: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    ym: [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]],
    zp: [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]],
    zm: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
  };
  for (const face of faces) quad(name, tile, ...corners[face]);
}

function rod(name, tile, a, b, radius, sides = 8, caps = true) {
  const axis = b.map((value, i) => value - a[i]);
  const length = Math.hypot(...axis);
  if (length < 1e-9) throw new Error(`Zero-length rod in ${name}`);
  const forward = axis.map((value) => value / length);
  const reference = Math.abs(forward[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let side = [forward[1] * reference[2] - forward[2] * reference[1], forward[2] * reference[0] - forward[0] * reference[2], forward[0] * reference[1] - forward[1] * reference[0]];
  const sideLength = Math.hypot(...side);
  side = side.map((value) => value / sideLength);
  const up = [forward[1] * side[2] - forward[2] * side[1], forward[2] * side[0] - forward[0] * side[2], forward[0] * side[1] - forward[1] * side[0]];
  const ringPoint = (center, index) => {
    const angle = index / sides * Math.PI * 2;
    return center.map((value, i) => value + radius * (Math.cos(angle) * side[i] + Math.sin(angle) * up[i]));
  };
  for (let i = 0; i < sides; i += 1) {
    const near = ringPoint(a, i);
    const nearNext = ringPoint(a, i + 1);
    const far = ringPoint(b, i);
    const farNext = ringPoint(b, i + 1);
    quad(name, tile, near, nearNext, farNext, far);
    if (caps) {
      const out = part(name);
      // A tiny quad-free triangle helper keeps these octagonal ends closed.
      for (const [points, normal] of [
        [[a, nearNext, near], forward.map((value) => -value)],
        [[b, far, farNext], forward],
      ]) {
        const base = out.positions.length / 3;
        for (const point of points) {
          out.positions.push(...point);
          out.normals.push(...normal);
          out.uvs.push(...uv(tile, 0.5, 0.5));
        }
        out.indices.push(base, base + 1, base + 2);
      }
    }
  }
}

function torus(name, tile, center, majorRadius, tubeRadius, majorSegments = 32, tubeSegments = 6) {
  const point = (majorIndex, tubeIndex) => {
    const a = majorIndex / majorSegments * Math.PI * 2;
    const b = tubeIndex / tubeSegments * Math.PI * 2;
    const radius = majorRadius + tubeRadius * Math.cos(b);
    return [center[0] + Math.cos(a) * radius, center[1] + tubeRadius * Math.sin(b), center[2] + Math.sin(a) * radius];
  };
  for (let i = 0; i < majorSegments; i += 1) {
    for (let j = 0; j < tubeSegments; j += 1) {
      quad(name, tile, point(i, j), point(i, j + 1), point(i + 1, j + 1), point(i + 1, j));
    }
  }
}

// Chunky rear support and broad safety padding, entirely behind the court.
box('support', tiles.paint, -0.825, 0.825, 0, 0.42, -8.725, -6.975);
box('support', tiles.steel, -0.52, 0.52, 0.42, 0.5, -8.31, -7.35);
rod('support', tiles.steel, [0, 0.4, -7.82], [0, 4.72, -7.82], 0.145, 8);
for (const x of [-0.48, 0.48]) rod('support', tiles.steel, [x, 0.42, -7.62], [0, 1.18, -7.82], 0.055, 6);
box('padding', tiles.foam, -0.91, 0.91, 0.26, 0.54, -7.46, -6.78);
box('padding', tiles.foam, -0.23, 0.23, 0.62, 1.72, -8.06, -7.58);
box('padding', tiles.ivory, -0.92, 0.92, 0.49, 0.515, -7.46, -7.43, ['zp']);

// Exposed cantilever and diagonal brace hold the board behind the playable rim.
rod('arm', tiles.steel, [0, 4.55, -7.82], [0, 4.55, -6.4], 0.105, 8);
rod('arm', tiles.steel, [0, 4.55, -6.4], [0, 3.84, -6.29], 0.075, 8);
for (const x of [-0.47, 0.47]) rod('arm', tiles.steel, [0, 4.08, -6.36], [x, 3.94, -6.29], 0.033, 6);

// This mesh alone has the exact measured board dimensions and front surface.
box('backboard', tiles.board,
  -boardWidth / 2, boardWidth / 2,
  boardCenter[1] - boardHeight / 2, boardCenter[1] + boardHeight / 2,
  boardCenter[2] - boardThickness / 2, boardFrontZ);

const markingZ0 = boardFrontZ + 0.004;
const markingZ1 = markingZ0 + 0.01;
const mark = (x0, x1, y0, y1) => box('target_markings', tiles.paint, x0, x1, y0, y1, markingZ0, markingZ1, ['zp']);
// Outer border and four-sided aiming square, all on the positive-Z face.
mark(-0.915, 0.915, 4.035, 4.078);
mark(-0.915, 0.915, 3.042, 3.085);
mark(-0.895, -0.855, 3.075, 4.045);
mark(0.855, 0.895, 3.075, 4.045);
mark(-0.32, 0.32, 3.49, 3.527);
mark(-0.32, 0.32, 3.095, 3.132);
mark(-0.32, -0.283, 3.112, 3.508);
mark(0.283, 0.32, 3.112, 3.508);

// The circle center and major radius are the same values used by gameplay.
torus('rim', tiles.orange, rimCenter, 0.23, 0.026);
box('mounts', tiles.steel, -0.16, 0.16, 2.995, 3.105, -6.21, -6.165);
for (const x of [-0.105, 0.105]) {
  rod('mounts', tiles.orange, [x, 3.05, -6.17], [x, 3.05, -6.05], 0.027, 6);
  box('mounts', tiles.bolts, x - 0.025, x + 0.025, 3.025, 3.075, -6.16, -6.143);
}

// Opaque three-sided cords avoid sorting and alpha overdraw on touch GPUs.
// The mesh has no dependency on score detection; src/main.js animates its
// stable parent group after a made basket.
const strands = 12;
const circlePoint = (index, radius, y, phase = 0) => {
  const a = (index + phase) / strands * Math.PI * 2;
  return [Math.cos(a) * radius, y, rimCenter[2] + Math.sin(a) * radius];
};
for (let i = 0; i < strands; i += 1) {
  const top = circlePoint(i, 0.205, 3.018);
  const middle = circlePoint(i, 0.158, 2.785, 0.5);
  const bottom = circlePoint(i, 0.108, 2.56);
  rod('net', tiles.cord, top, middle, 0.0048, 3, false);
  rod('net', tiles.cord, top, circlePoint(i - 1, 0.158, 2.785, 0.5), 0.0048, 3, false);
  rod('net', tiles.cord, middle, bottom, 0.0048, 3, false);
  rod('net', tiles.cord, middle, circlePoint(i + 1, 0.108, 2.56), 0.0048, 3, false);
  for (const [radius, y, phase] of [[0.205, 3.018, 0], [0.158, 2.785, 0.5], [0.108, 2.56, 0]]) {
    rod('net', tiles.cord, circlePoint(i, radius, y, phase), circlePoint(i + 1, radius, y, phase), 0.0048, 3, false);
  }
}

// Eight quiet 64x128 swatches form one 256x256 color atlas. All marks are
// geometric and original; the atlas contains no logo, lettering or photo.
const colors = [
  ['#1d2230', '#43495b'], ['#342747', '#5a426d'],
  ['#4c315f', '#76528a'], ['#aabcc3', '#e3e7de'],
  ['#b8451d', '#f0782f'], ['#d8d3bd', '#fff0d3'],
  ['#b7b4aa', '#f4efdf'], ['#5b6070', '#a4a8b1'],
];
const swatches = colors.map(([dark, light], index) => {
  const x = (index % 4) * 64;
  const y = Math.floor(index / 4) * 128;
  return `<rect x="${x}" y="${y}" width="64" height="128" fill="${dark}"/>
    <rect x="${x + 3}" y="${y + 4}" width="58" height="119" fill="${light}" opacity=".82"/>
    <path d="M${x + 5} ${y + 13}h49 M${x + 7} ${y + 87}h45" stroke="${dark}" stroke-width="2" opacity=".23"/>
    <path d="M${x + 9} ${y + 51}h33 M${x + 14} ${y + 107}h34" stroke="#ffffff" stroke-width="1" opacity=".16"/>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${swatches}</svg>`;

const chunks = [];
const views = [];
const accessors = [];
let byteLength = 0;
function append(data, target) {
  const pad = (4 - byteLength % 4) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  views.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length, target });
  chunks.push(buffer);
  byteLength += buffer.length;
  return views.length - 1;
}
function accessor(data, componentType, type, target, extra = {}) {
  const bufferView = append(data, target);
  accessors.push({ bufferView, componentType, count: data.length / (type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1), type, ...extra });
  return accessors.length - 1;
}
const meshes = [];
const nodes = [];
const counts = {};
let triangleCount = 0;
for (const name of names) {
  const data = part(name);
  const positions = new Float32Array(data.positions);
  if (positions.length / 3 > 65535) throw new Error(`${name} exceeds Uint16 indices`);
  const x = [], y = [], z = [];
  for (let i = 0; i < positions.length; i += 3) { x.push(positions[i]); y.push(positions[i + 1]); z.push(positions[i + 2]); }
  const position = accessor(positions, 5126, 'VEC3', 34962, { min: [Math.min(...x), Math.min(...y), Math.min(...z)], max: [Math.max(...x), Math.max(...y), Math.max(...z)] });
  const normal = accessor(new Float32Array(data.normals), 5126, 'VEC3', 34962);
  const texcoord = accessor(new Float32Array(data.uvs), 5126, 'VEC2', 34962);
  const indices = accessor(new Uint16Array(data.indices), 5123, 'SCALAR', 34963);
  meshes.push({ name, primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: texcoord }, indices, material: 0, mode: 4 }] });
  nodes.push({ name, mesh: meshes.length - 1 });
  counts[name] = data.indices.length / 3;
  triangleCount += counts[name];
}
if (triangleCount > 2000) throw new Error(`Hoop exceeds 2,000 triangles: ${triangleCount}`);
const gltf = {
  asset: { version: '2.0', generator: 'TheArena original hoop assembly recipe v1' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, index) => index) }],
  nodes, meshes,
  materials: [{ name: 'hoop_atlas_matte', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.12, roughnessFactor: 0.82 }, emissiveTexture: { index: 0 }, emissiveFactor: [0.16, 0.16, 0.16], doubleSided: false }],
  textures: [{ sampler: 0, source: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  images: [{ uri: '../../textures/hoop/atlas-v1.png' }],
  buffers: [{ byteLength }], bufferViews: views, accessors,
};
const padded = (buffer, fill) => {
  const pad = (4 - buffer.length % 4) % 4;
  return pad ? Buffer.concat([buffer, Buffer.alloc(pad, fill)]) : buffer;
};
const json = padded(Buffer.from(JSON.stringify(gltf)), 0x20);
const binary = padded(Buffer.concat(chunks), 0);
const header = Buffer.alloc(12);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(json.length, 0);
jsonHeader.write('JSON', 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binary.length, 0);
binHeader.write('BIN\0', 4);
const model = Buffer.concat([header, jsonHeader, json, binHeader, binary]);
if (model.length > 180000) throw new Error(`Hoop GLB exceeds 180 KB: ${model.length}`);
await mkdir(path.dirname(modelPath), { recursive: true });
await mkdir(path.dirname(atlasPath), { recursive: true });
const atlas = await sharp(Buffer.from(svg)).png({ palette: true, effort: 9 }).toBuffer();
await writeFile(atlasPath, atlas);
await writeFile(modelPath, model);
console.log(JSON.stringify({ modelPath, atlasPath, triangleCount, counts, materials: 1, meshes: meshes.length, modelBytes: model.length, atlasBytes: atlas.length }));
