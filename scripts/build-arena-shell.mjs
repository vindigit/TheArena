#!/usr/bin/env node

// Original, meter-scale arena shell. The generated GLB and its one signage
// atlas are the only runtime outputs; this small recipe is the source file.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = path.join(root, 'public/assets/models/arena/arena-shell-v1.glb');
const atlasPath = path.join(root, 'public/assets/textures/arena/atlas-v1.png');
const meshes = new Map();
const materials = [
  ['foundation', '#303545'],
  ['wall', '#202b3f'],
  ['wallShade', '#1a2335'],
  ['trim', '#494059'],
  ['riser', '#303a50'],
  ['seat', '#40375c'],
  ['amber', '#ad7848'],
  ['light', '#ffe3af'],
  ['screen', '#ffffff'],
  ['clock', '#ff3022'],
];
const materialIndex = Object.fromEntries(materials.map(([name], index) => [name, index]));

function mesh(name, material) {
  const key = `${name}|${material}`;
  if (!meshes.has(key)) meshes.set(key, { name, material, positions: [], normals: [], uvs: [], indices: [] });
  return meshes.get(key);
}

function quad(name, material, a, b, c, d, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
  const out = mesh(name, material);
  const base = out.positions.length / 3;
  const ab = b.map((value, i) => value - a[i]);
  const ac = c.map((value, i) => value - a[i]);
  const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(...cross);
  if (length < 1e-7) throw new Error(`degenerate quad in ${name}`);
  const normal = cross.map((component) => component / length);
  for (const [index, point] of [a, b, c, d].entries()) {
    out.positions.push(...point);
    out.normals.push(...normal);
    out.uvs.push(...uv[index]);
  }
  out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function box(name, material, x0, x1, y0, y1, z0, z1, faces = ['xp', 'xm', 'yp', 'ym', 'zp', 'zm']) {
  const corners = {
    xp: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    xm: [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]],
    yp: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    ym: [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]],
    zp: [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]],
    zm: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
  };
  for (const face of faces) quad(name, material, ...corners[face]);
}

function beam(name, material, from, to, width, depth) {
  const direction = to.map((value, index) => value - from[index]);
  const length = Math.hypot(...direction);
  const axis = direction.map((value) => value / length);
  const reference = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let side = [axis[1] * reference[2] - axis[2] * reference[1], axis[2] * reference[0] - axis[0] * reference[2], axis[0] * reference[1] - axis[1] * reference[0]];
  const sideLength = Math.hypot(...side);
  side = side.map((value) => value / sideLength);
  const up = [side[1] * axis[2] - side[2] * axis[1], side[2] * axis[0] - side[0] * axis[2], side[0] * axis[1] - side[1] * axis[0]];
  const point = (end, sx, sy) => end.map((value, i) => value + side[i] * sx * width / 2 + up[i] * sy * depth / 2);
  const near = [point(from, -1, -1), point(from, 1, -1), point(from, 1, 1), point(from, -1, 1)];
  const far = [point(to, -1, -1), point(to, 1, -1), point(to, 1, 1), point(to, -1, 1)];
  for (let sideIndex = 0; sideIndex < 4; sideIndex += 1) {
    const next = (sideIndex + 1) % 4;
    quad(name, material, near[sideIndex], far[sideIndex], far[next], near[next]);
  }
}

// The foundation is a visible surround, not a slab hidden beneath the wood.
for (const [x0, x1, z0, z1] of [
  [-11.5, -7.84, -11.5, 11.5], [7.84, 11.5, -11.5, 11.5],
  [-7.84, 7.84, -11.5, -7.25], [-7.84, 7.84, 7.25, 11.5],
]) box('arena foundation', 'foundation', x0, x1, -0.36, -0.025, z0, z1, ['yp']);
box('arena foundation', 'foundation', -11.5, 11.5, -0.36, -0.025, -11.5, 11.5, ['xp', 'xm', 'zp', 'zm']);

// Interior wall faces, a dark upper bowl, and a raised concourse band.
box('arena walls', 'wall', -15.3, 15.3, 0, 7.65, -11.52, -11.5, ['zp']);
box('arena walls', 'wallShade', -15.3, 15.3, 7.65, 11.15, -11.52, -11.5, ['zp']);
box('arena walls', 'wall', -15.3, 15.3, 0, 7.65, 11.5, 11.52, ['zm']);
box('arena walls', 'wallShade', -15.3, 15.3, 7.65, 11.15, 11.5, 11.52, ['zm']);
for (const sign of [-1, 1]) {
  const x = sign * 15.3;
  quad('arena walls', 'wall', [x, 0, sign * 11.5], [x, 7.65, sign * 11.5], [x, 7.65, -sign * 11.5], [x, 0, -sign * 11.5]);
  quad('arena walls', 'wallShade', [x, 7.65, sign * 11.5], [x, 11.15, sign * 11.5], [x, 11.15, -sign * 11.5], [x, 7.65, -sign * 11.5]);
}
for (const z of [-11.46, 11.46]) {
  const face = z < 0 ? 'zp' : 'zm';
  box('concourse fascia', 'trim', -15.1, 15.1, 3.72, 4.22, z - 0.03, z + 0.03, [face]);
  box('concourse accent', 'amber', -15.1, 15.1, 4.22, 4.3, z - 0.04, z + 0.04, [face]);
  box('upper wall stripe', 'seat', -15.1, 15.1, 7.73, 8.19, z - 0.04, z + 0.04, [face]);
  for (const x of [-13.7, -9.15, -4.57, 4.57, 9.15, 13.7]) {
    box('wall piers', 'trim', x - 0.16, x + 0.16, 4.3, 10.95, z - 0.10, z + 0.10, [face, 'xp', 'xm']);
    box('wall sconce', 'amber', x - 0.3, x + 0.3, 8.45, 8.53, z - 0.11, z + 0.11, [face]);
  }
}
for (const sign of [-1, 1]) {
  const x0 = sign < 0 ? -15.35 : 15.27;
  const x1 = sign < 0 ? -15.27 : 15.35;
  const face = sign < 0 ? 'xp' : 'xm';
  box('concourse fascia', 'trim', x0, x1, 3.72, 4.22, -11.2, 11.2, [face]);
  box('concourse accent', 'amber', x0, x1, 4.22, 4.3, -11.2, 11.2, [face]);
  box('upper wall stripe', 'seat', x0, x1, 7.73, 8.19, -11.2, 11.2, [face]);
  for (const z of [-8.5, -3.5, 1.5, 6.5]) {
    box('wall piers', 'trim', x0 - 0.08, x1 + 0.08, 4.3, 10.95, z - 0.16, z + 0.16, [face, 'zp', 'zm']);
  }
}

// Open step surfaces and risers: no buried bottom faces or full hidden blocks.
for (const sign of [-1, 1]) {
  for (let row = 0; row < 4; row += 1) {
    const center = sign * (8.18 + row * 1.04);
    const x0 = center - 0.52;
    const x1 = center + 0.52;
    const height = 0.62 + row * 0.58;
    const inward = sign < 0 ? 'xp' : 'xm';
    box('tiered bleachers', 'riser', x0, x1, 0, height, -7.4, 7.58, ['yp', inward, 'zp', 'zm']);
    box('seating platforms', 'seat', center - 0.5, center + 0.5, height, height + 0.075, -7.25, 7.47, ['yp', inward]);
    box('step nosings', 'amber', sign < 0 ? x1 - 0.04 : x0, sign < 0 ? x1 : x0 + 0.04, height + 0.077, height + 0.092, -7.2, 7.4, ['yp']);
  }
}
for (let row = 0; row < 4; row += 1) {
  const center = -8.25 - row * 1.03;
  const height = 0.62 + row * 0.58;
  box('tiered bleachers', 'riser', -7.7, 7.7, 0, height, center - 0.57, center + 0.57, ['yp', 'zp', 'xp', 'xm']);
  box('seating platforms', 'seat', -7.47, 7.47, height, height + 0.075, center - 0.51, center + 0.51, ['yp', 'zp']);
  box('step nosings', 'amber', -7.43, 7.43, height + 0.077, height + 0.092, center + 0.47, center + 0.51, ['yp']);
}

// Dark coffered ceiling and lightweight exposed lattice under it.
box('arena ceiling', 'wallShade', -15.3, 15.3, 11.1, 11.24, -11.5, 11.5, ['ym']);
for (const z of [-5.5, 0, 5.5]) {
  beam('ceiling trusses', 'trim', [-11.1, 10.69, z - 0.22], [11.1, 10.69, z - 0.22], 0.12, 0.13);
  beam('ceiling trusses', 'trim', [-11.1, 10.69, z + 0.22], [11.1, 10.69, z + 0.22], 0.12, 0.13);
  beam('ceiling trusses', 'trim', [-11.1, 10.24, z], [11.1, 10.24, z], 0.12, 0.12);
  for (let x = -10.8; x < 10.8; x += 2.7) {
    beam('ceiling trusses', 'trim', [x, 10.25, z], [x + 1.35, 10.7, z - 0.22], 0.07, 0.07);
    beam('ceiling trusses', 'trim', [x + 1.35, 10.7, z + 0.22], [x + 2.7, 10.25, z], 0.07, 0.07);
  }
}
for (const x of [-10.8, 10.8]) beam('ceiling trusses', 'trim', [x, 10.71, -10.9], [x, 10.71, 10.9], 0.13, 0.13);
for (const [x, z] of [[-5.2, -3.5], [5.2, -3.5], [-5.2, 4.5], [5.2, 4.5]]) {
  box('overhead light housing', 'trim', x - 1.15, x + 1.15, 10.48, 10.68, z - 0.4, z + 0.4, ['ym', 'xp', 'xm', 'zp', 'zm']);
  box('overhead light lens', 'light', x - 1.03, x + 1.03, 10.475, 10.48, z - 0.28, z + 0.28, ['ym']);
}

// Three textured venue video boards share one emissive material. Their mesh
// name is the presentation contract consumed by src/main.js.
const atlasUv = (startY) => [[0, startY + 0.25], [1, startY + 0.25], [1, startY], [0, startY]];
for (const [x0, x1, atlasY] of [[-10.2, -3.9, 0], [3.9, 10.2, 0.25]]) {
  quad('arena video board', 'screen', [x0, 5.45, -11.24], [x1, 5.45, -11.24], [x1, 6.8, -11.24], [x0, 6.8, -11.24], atlasUv(atlasY));
  box('video board frames', 'amber', x0 - 0.1, x1 + 0.1, 5.35, 5.43, -11.25, -11.18, ['zp', 'yp']);
  box('video board frames', 'amber', x0 - 0.1, x1 + 0.1, 6.82, 6.9, -11.25, -11.18, ['zp', 'ym']);
  for (const x of [x0 - 0.1, x1 + 0.1]) box('video board frames', 'trim', x - 0.07, x + 0.07, 5.35, 6.9, -11.25, -11.18, ['zp']);
}
quad('arena video board', 'screen', [-15.18, 5.65, -2.2], [-15.18, 5.65, 2.2], [-15.18, 6.7, 2.2], [-15.18, 6.7, -2.2], atlasUv(0.25));
quad('arena video board', 'screen', [15.18, 5.65, 2.2], [15.18, 5.65, -2.2], [15.18, 6.7, -2.2], [15.18, 6.7, 2.2], atlasUv(0.25));
for (const sign of [-1, 1]) {
  const x = sign * 15.19;
  for (const y of [5.55, 6.71]) box('video board frames', 'amber', x - 0.02, x + 0.02, y, y + 0.07, -2.3, 2.3, [sign < 0 ? 'xp' : 'xm']);
}

// The static 24 display is above the board's left edge, clear of the HUD.
const clockX = -1.35;
box('shot clock case', 'trim', clockX - 0.59, clockX + 0.59, 4.13, 4.91, -6.3, -6.14, ['zp', 'xp', 'xm', 'yp']);
const digitSegments = { 2: [0, 1, 6, 4, 3], 4: [5, 6, 1, 2] };
const segmentPositions = [[0, 0.26, 0.22, 0.055], [0.18, 0.13, 0.055, 0.22], [0.18, -0.13, 0.055, 0.22], [0, -0.26, 0.22, 0.055], [-0.18, -0.13, 0.055, 0.22], [-0.18, 0.13, 0.055, 0.22], [0, 0, 0.22, 0.055]];
for (const [digitX, digit] of [[-0.28, 2], [0.28, 4]]) {
  for (const segment of digitSegments[digit]) {
    const [sx, sy, width, height] = segmentPositions[segment];
    box('shot clock digits', 'clock', clockX + digitX + sx - width / 2, clockX + digitX + sx + width / 2, 4.52 + sy - height / 2, 4.52 + sy + height / 2, -6.133, -6.13, ['zp']);
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#1a1630"/>
<rect x="5" y="5" width="502" height="118" fill="#292145" stroke="#d99859" stroke-width="5"/>
<path d="M20 24h58l21 40-21 40H20l21-40z" fill="#68436c" stroke="#efb76f" stroke-width="5"/>
<path d="M51 42l19 22-19 22-19-22z" fill="#efb76f"/>
<text x="112" y="58" fill="#e7c69e" font-family="Arial,sans-serif" font-weight="bold" font-size="17" letter-spacing="5">AFTER HOURS</text>
<text x="108" y="98" fill="#fff0d1" font-family="Arial,sans-serif" font-weight="900" font-size="38" letter-spacing="2">SOLO ARENA</text>
<rect x="5" y="133" width="502" height="118" fill="#292145" stroke="#d99859" stroke-width="5"/>
<path d="M22 154h60l18 38-18 38H22l18-38z" fill="#31576b" stroke="#efb76f" stroke-width="4"/>
<text x="112" y="185" fill="#d7b886" font-family="Arial,sans-serif" font-weight="bold" font-size="18" letter-spacing="4">TONIGHT</text>
<text x="109" y="225" fill="#fff0d1" font-family="Arial,sans-serif" font-weight="900" font-size="38" letter-spacing="2">SOLO RUN</text>
<rect x="5" y="261" width="502" height="246" fill="#242a3d" stroke="#59486b" stroke-width="5"/>
<path d="M22 310h468M22 358h468M22 406h468M22 454h468" stroke="#3e4a5e" stroke-width="7"/>
</svg>`;

function color(hex) {
  const linear = (component) => {
    const srgb = component / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return [linear(parseInt(hex.slice(1, 3), 16)), linear(parseInt(hex.slice(3, 5), 16)), linear(parseInt(hex.slice(5, 7), 16)), 1];
}

const chunks = [];
const views = [];
const accessors = [];
let byteLength = 0;
function append(data, target) {
  const pad = (4 - byteLength % 4) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const viewIndex = views.length;
  views.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length, target });
  chunks.push(buffer);
  byteLength += buffer.length;
  return viewIndex;
}
function accessor(data, componentType, type, target, extra = {}) {
  const bufferView = append(data, target);
  const index = accessors.length;
  accessors.push({ bufferView, componentType, count: data.length / (type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1), type, ...extra });
  return index;
}
const gltfMeshes = [];
const nodes = [];
let triangleCount = 0;
for (const part of meshes.values()) {
  const positions = new Float32Array(part.positions);
  const count = positions.length / 3;
  if (count > 65535) throw new Error(`${part.name} exceeds Uint16 vertex capacity`);
  const x = [], y = [], z = [];
  for (let i = 0; i < positions.length; i += 3) { x.push(positions[i]); y.push(positions[i + 1]); z.push(positions[i + 2]); }
  const position = accessor(positions, 5126, 'VEC3', 34962, { min: [Math.min(...x), Math.min(...y), Math.min(...z)], max: [Math.max(...x), Math.max(...y), Math.max(...z)] });
  const normal = accessor(new Float32Array(part.normals), 5126, 'VEC3', 34962);
  const uv = accessor(new Float32Array(part.uvs), 5126, 'VEC2', 34962);
  const indices = accessor(new Uint16Array(part.indices), 5123, 'SCALAR', 34963);
  gltfMeshes.push({ name: part.name, primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }, indices, material: materialIndex[part.material], mode: 4 }] });
  nodes.push({ name: part.name, mesh: gltfMeshes.length - 1 });
  triangleCount += part.indices.length / 3;
}

const gltfMaterials = materials.map(([name, hex]) => {
  if (name === 'screen') return { name, pbrMetallicRoughness: { baseColorFactor: [0.23, 0.23, 0.23, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.7 }, emissiveFactor: [0.75, 0.7, 0.62], emissiveTexture: { index: 0 }, doubleSided: true };
  if (name === 'clock') return { name, pbrMetallicRoughness: { baseColorFactor: color(hex), metallicFactor: 0, roughnessFactor: 0.8 }, emissiveFactor: [0.9, 0.025, 0.008], doubleSided: true };
  return { name, pbrMetallicRoughness: { baseColorFactor: color(hex), metallicFactor: 0, roughnessFactor: 1 }, extensions: { KHR_materials_unlit: {} }, doubleSided: name !== 'wall' && name !== 'wallShade' };
});
const gltf = {
  asset: { version: '2.0', generator: 'TheArena original shell recipe v1' },
  extensionsUsed: ['KHR_materials_unlit'],
  scene: 0, scenes: [{ nodes: nodes.map((_, index) => index) }], nodes,
  meshes: gltfMeshes, materials: gltfMaterials,
  textures: [{ sampler: 0, source: 0 }], samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
  images: [{ uri: '../../textures/arena/atlas-v1.png' }],
  buffers: [{ byteLength }], bufferViews: views, accessors,
};

function padded(buffer, fill) {
  const pad = (4 - buffer.length % 4) % 4;
  return pad ? Buffer.concat([buffer, Buffer.alloc(pad, fill)]) : buffer;
}
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
await mkdir(path.dirname(modelPath), { recursive: true });
await mkdir(path.dirname(atlasPath), { recursive: true });
await writeFile(atlasPath, await sharp(Buffer.from(svg)).png({ palette: true, effort: 9 }).toBuffer());
await writeFile(modelPath, Buffer.concat([header, jsonHeader, json, binHeader, binary]));
console.log(JSON.stringify({ modelPath, atlasPath, triangleCount, materials: materials.length, meshes: gltfMeshes.length, modelBytes: 12 + 8 + json.length + 8 + binary.length }));
