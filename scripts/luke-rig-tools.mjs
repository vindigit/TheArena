// Independent checks on the shipped GLB; no generator or visual pose writer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LUKE_BONES, validateLukeRig } from '../src/luke-rig-contract.js';

const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const types = { 5120: [1, 'readInt8'], 5121: [1, 'readUInt8'], 5122: [2, 'readInt16LE'],
  5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE'] };
export function parseGlb(data) {
  assert.equal(data.toString('ascii', 0, 4), 'glTF', 'GLB magic');
  assert.equal(data.readUInt32LE(4), 2, 'GLB version');
  assert.equal(data.readUInt32LE(8), data.length, 'GLB byte length');
  assert.equal(data.readUInt32LE(16), 0x4e4f534a, 'JSON chunk type');
  const size = data.readUInt32LE(12), binHeader = 20 + size;
  const doc = JSON.parse(data.toString('utf8', 20, binHeader));
  assert.equal(data.readUInt32LE(binHeader + 4), 0x004e4942, 'BIN chunk type');
  assert.equal(binHeader + 8 + data.readUInt32LE(binHeader), data.length, 'BIN chunk byte length');
  return { doc, binary: data.subarray(binHeader + 8) };
}
export function accessor(doc, binary, index) {
  const entry = doc.accessors[index], view = doc.bufferViews[entry.bufferView];
  assert.ok(!entry.sparse, 'Sparse accessors are not in the Luke contract');
  assert.equal(view.buffer, 0, 'Only embedded buffer zero is allowed');
  const count = widths[entry.type], component = types[entry.componentType];
  assert.ok(count && component, 'Unsupported accessor format');
  const stride = view.byteStride || count * component[0];
  const offset = (view.byteOffset || 0) + (entry.byteOffset || 0);
  assert.ok(offset + (entry.count - 1) * stride + count * component[0] <= (view.byteOffset || 0) + view.byteLength,
    'Accessor escapes its buffer view');
  return Array.from({ length: entry.count }, (_, i) => Array.from({ length: count }, (_, k) => {
    const value = binary[component[1]](offset + i * stride + k * component[0]);
    if (!entry.normalized || entry.componentType === 5126) return value;
    const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 }[entry.componentType];
    return Math.max(-1, value / max);
  }));
}
export async function loadLukeScene(data) {
  const { doc, binary } = parseGlb(data), parseDoc = structuredClone(doc);
  // Node has no image decoder. Runtime and browser checks inspect the original
  // embedded atlas; this parser removes only its texture links for rig checks.
  parseDoc.images = []; parseDoc.textures = []; parseDoc.samplers = [];
  parseDoc.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }];
  parseDoc.buffers[0].uri = 'data:application/octet-stream;base64,' + binary.toString('base64');
  globalThis.ProgressEvent ||= class { constructor(type, init) { Object.assign(this, { type, ...init }); } };
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(parseDoc), '');
  const bones = new Map(), meshes = [];
  gltf.scene.traverse(node => { if (node.isBone) bones.set(node.name, node); if (node.isSkinnedMesh) meshes.push(node); });
  return { gltf, bones, meshes, doc, binary };
}
export async function validateLukeAsset(data, contract) {
  assert.deepEqual(contract.bones, LUKE_BONES, 'Machine-readable/runtime rest contract differs');
  const { doc, binary } = parseGlb(data);
  assert.equal(doc.asset.version, '2.0', 'glTF version');
  assert.equal(doc.buffers.length, 1, 'One embedded buffer');
  assert.ok(!doc.buffers.some(buffer => buffer.uri), 'External buffers forbidden');
  assert.ok(!doc.images.some(image => image.uri), 'External images forbidden');
  assert.equal(doc.skins.length, 1, 'One Luke skin');
  assert.equal(doc.skins[0].joints.length, 17, 'Seventeen Luke joints');
  assert.equal(doc.meshes.length, 1, 'One Luke mesh');
  assert.equal(doc.materials.length, 1, 'One Luke material');
  assert.equal(doc.images.length, 1, 'One Luke atlas');
  assert.ok(!doc.animations?.length, 'Part 1 canonical asset has no clips');
  assert.ok(!doc.extensionsRequired?.length, 'No runtime decoder extension');
  const primitive = doc.meshes[0].primitives[0];
  assert.equal(doc.meshes[0].primitives.length, 1, 'One Luke primitive');
  assert.equal(primitive.mode ?? 4, 4, 'Triangle geometry');
  const positions = accessor(doc, binary, primitive.attributes.POSITION);
  const normals = accessor(doc, binary, primitive.attributes.NORMAL);
  const uvs = accessor(doc, binary, primitive.attributes.TEXCOORD_0);
  const joints = accessor(doc, binary, primitive.attributes.JOINTS_0);
  const weights = accessor(doc, binary, primitive.attributes.WEIGHTS_0);
  const indices = accessor(doc, binary, primitive.indices).flat();
  assert.equal(positions.length, contract.geometry.vertices, 'Luke vertex count');
  assert.equal(indices.length / 3, contract.geometry.triangles, 'Luke triangle count');
  assert.ok([normals, uvs, joints, weights].every(rows => rows.length === positions.length), 'Attribute counts');
  let maxWeightError = 0, maxNormalError = 0, maxInfluences = 0, minTriangleArea = Infinity;
  const bounds = new THREE.Box3();
  for (let i = 0; i < positions.length; i++) {
    assert.ok([...positions[i], ...normals[i], ...uvs[i]].every(Number.isFinite), 'Finite geometry');
    bounds.expandByPoint(new THREE.Vector3(...positions[i]));
    assert.ok(joints[i].every(j => Number.isInteger(j) && j >= 0 && j < 17), 'Skin index in range');
    assert.ok(weights[i].every(w => Number.isFinite(w) && w >= 0 && w <= 1), 'Skin weights finite and positive');
    const error = Math.abs(weights[i].reduce((sum, w) => sum + w, 0) - 1);
    maxWeightError = Math.max(maxWeightError, error);
    assert.ok(error < 1e-6, 'Normalized skin weights');
    maxInfluences = Math.max(maxInfluences, weights[i].filter(w => w > 0).length);
    maxNormalError = Math.max(maxNormalError, Math.abs(new THREE.Vector3(...normals[i]).length() - 1));
    assert.ok(uvs[i].every(v => v >= 0 && v <= 1), 'UV bounds');
  }
  assert.ok(maxInfluences <= 2, 'Luke maximum two skin influences');
  assert.ok(maxNormalError < 1e-5, 'Unit normals');
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3);
    assert.ok([a, b, c].every(v => Number.isInteger(v) && v >= 0 && v < positions.length), 'Triangle index in range');
    const area = new THREE.Vector3(...positions[b]).sub(new THREE.Vector3(...positions[a]))
      .cross(new THREE.Vector3(...positions[c]).sub(new THREE.Vector3(...positions[a]))).length() * .5;
    minTriangleArea = Math.min(minTriangleArea, area);
    assert.ok(area > 1e-12, 'Nondegenerate triangle');
  }
  for (const key of ['min', 'max']) bounds[key].toArray().forEach((v, i) =>
    assert.ok(Math.abs(v - contract.geometry.bounds[key][i]) < 1e-6, 'Canonical bounds'));
  const { gltf, bones, meshes } = await loadLukeScene(data);
  const rig = validateLukeRig(THREE, gltf.scene, bones, meshes);
  let maxBindError = 0;
  for (const mesh of meshes) {
    mesh.skeleton.update();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      const original = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i);
      maxBindError = Math.max(maxBindError, mesh.applyBoneTransform(i, original.clone()).distanceTo(original));
    }
  }
  assert.ok(maxBindError < 1e-6, 'Bind deformation must be identity');
  assert.equal(createHash('sha256').update(data).digest('hex'), contract.asset.sha256, 'Canonical Luke SHA-256');
  return { bytes: data.length, vertices: positions.length, triangles: indices.length / 3, bones: bones.size,
    maxInfluences, maxWeightError, maxNormalError, minTriangleArea, maxBindError,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, ...rig };
}
