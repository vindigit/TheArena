// Independent inspection of shipped glTF geometry, skins and animation data.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { accessor, parseGlb } from './luke-rig-tools.mjs';

export const RECOVERED_BONES = [
  'root', 'lfemur', 'ltibia', 'lfoot', 'ltoes', 'rfemur', 'rtibia', 'rfoot', 'rtoes',
  'waist', 'lowback', 'thorax', 'neck', 'head', 'lcollar', 'lhumerus', 'ltwist',
  'lelbow', 'lwrist', 'lhand', 'rcollar', 'rhumerus', 'rtwist', 'relbow', 'rwrist', 'rhand',
];

function worldMatrices(doc) {
  const parents = new Map();
  doc.nodes.forEach((node, i) => (node.children || []).forEach(child => {
    assert.ok(Number.isInteger(child) && doc.nodes[child], 'Child node index in range');
    assert.ok(!parents.has(child), 'A node has only one parent');
    parents.set(child, i);
  }));
  const result = [], visiting = new Set();
  function world(index) {
    if (result[index]) return result[index];
    assert.ok(!visiting.has(index), 'Node hierarchy is acyclic');
    visiting.add(index);
    const node = doc.nodes[index];
    const matrix = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
      new THREE.Vector3(...(node.translation || [0, 0, 0])),
      new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])),
      new THREE.Vector3(...(node.scale || [1, 1, 1])),
    );
    assert.ok(matrix.elements.every(Number.isFinite), 'Finite node rest transform');
    if (parents.has(index)) matrix.premultiply(world(parents.get(index)));
    visiting.delete(index);
    result[index] = matrix;
    return matrix;
  }
  doc.nodes.forEach((_, i) => world(i));
  return result;
}

export function validateRecoveredDocument(doc, binary, { animationOnly = false } = {}) {
  assert.equal(doc.asset.version, '2.0', 'glTF version');
  assert.equal(doc.buffers.length, 1, 'One embedded binary buffer');
  assert.ok(!doc.buffers.some(buffer => buffer.uri), 'External buffers forbidden');
  assert.ok(!(doc.images || []).some(image => image.uri), 'External images forbidden');
  assert.ok(!doc.extensionsRequired?.length, 'No external runtime decoder required');
  const named = new Map();
  for (const [i, node] of doc.nodes.entries()) {
    if (RECOVERED_BONES.includes(node.name)) {
      assert.ok(!named.has(node.name), `Unique canonical bone: ${node.name}`);
      named.set(node.name, i);
    }
  }
  for (const name of RECOVERED_BONES) assert.ok(named.has(name), `Canonical bone required: ${name}`);
  const worlds = worldMatrices(doc);
  const joints = new Set(), identity = new THREE.Matrix4().elements;
  let vertices = 0, triangles = 0, maxWeightSumError = 0, maxBindError = 0;
  for (const [skinIndex, skin] of (doc.skins || []).entries()) {
    assert.ok(skin.joints.length >= 26, 'Canonical skin retains at least 26 joints');
    assert.equal(new Set(skin.joints).size, skin.joints.length, 'Distinct skin joint indices');
    const inverse = accessor(doc, binary, skin.inverseBindMatrices);
    assert.equal(inverse.length, skin.joints.length, 'One inverse bind matrix per skin joint');
    skin.joints.forEach((joint, j) => {
      assert.ok(doc.nodes[joint], 'Skin joint node in range');
      assert.ok(inverse[j].every(Number.isFinite), 'Finite inverse bind matrix');
      joints.add(joint);
    });
    for (const [nodeIndex, node] of doc.nodes.entries()) {
      if (node.skin !== skinIndex) continue;
      const meshInverse = worlds[nodeIndex].clone().invert();
      skin.joints.forEach((joint, j) => {
        const bind = meshInverse.clone().multiply(worlds[joint]).multiply(new THREE.Matrix4().fromArray(inverse[j]));
        const error = Math.max(...bind.elements.map((value, k) => Math.abs(value - identity[k])));
        maxBindError = Math.max(maxBindError, error);
        assert.ok(error < 0.002, `Inverse bind/rest agreement: ${doc.nodes[joint].name}`);
      });
      const mesh = doc.meshes[node.mesh];
      assert.ok(mesh, 'Skinned mesh exists');
      for (const primitive of mesh.primitives) {
        assert.equal(primitive.mode ?? 4, 4, 'Triangle geometry');
        const positions = accessor(doc, binary, primitive.attributes.POSITION);
        const weights = accessor(doc, binary, primitive.attributes.WEIGHTS_0);
        const skinIndices = accessor(doc, binary, primitive.attributes.JOINTS_0);
        assert.equal(weights.length, positions.length, 'Skin weight/position counts');
        assert.equal(skinIndices.length, positions.length, 'Skin joint/position counts');
        for (const [i, position] of positions.entries()) {
          assert.ok(position.every(Number.isFinite), 'Finite vertex positions');
          assert.ok(weights[i].every(w => Number.isFinite(w) && w >= 0 && w <= 1), 'Finite bounded skin weights');
          assert.ok(skinIndices[i].every(j => Number.isInteger(j) && j >= 0 && j < skin.joints.length), 'Skin indices in range');
          const error = Math.abs(weights[i].reduce((sum, weight) => sum + weight, 0) - 1);
          maxWeightSumError = Math.max(maxWeightSumError, error);
          assert.ok(error < 0.0001, 'Normalized skin weights');
        }
        for (const attribute of ['NORMAL', 'TEXCOORD_0']) {
          if (primitive.attributes[attribute] === undefined) continue;
          const values = accessor(doc, binary, primitive.attributes[attribute]);
          assert.equal(values.length, positions.length, `${attribute}/position counts`);
          assert.ok(values.every(row => row.every(Number.isFinite)), `Finite ${attribute}`);
        }
        const indices = primitive.indices === undefined ? positions.map((_, i) => i) : accessor(doc, binary, primitive.indices).flat();
        assert.equal(indices.length % 3, 0, 'Complete triangles');
        assert.ok(indices.every(i => Number.isInteger(i) && i >= 0 && i < positions.length), 'Triangle indices in range');
        vertices += positions.length;
        triangles += indices.length / 3;
      }
    }
  }
  if (!animationOnly) {
    assert.ok(vertices > 100 && triangles > 100, 'Complete skinned player geometry');
    for (const name of RECOVERED_BONES) assert.ok(joints.has(named.get(name)), `Skinned canonical bone: ${name}`);
  }
  let durationSeconds = 0, channels = 0;
  const animations = doc.animations || [], names = new Set();
  for (const animation of animations) {
    assert.ok(animation.name && !names.has(animation.name), 'Named distinct clips');
    names.add(animation.name);
    const targets = new Set();
    assert.ok(animation.channels.length > 0, 'Clip contains channels');
    for (const channel of animation.channels) {
      assert.ok(doc.nodes[channel.target.node], 'Animation target node in range');
      assert.ok(RECOVERED_BONES.includes(doc.nodes[channel.target.node].name), 'Animation targets a canonical player bone');
      assert.ok(['rotation', 'translation', 'scale'].includes(channel.target.path), 'Supported animation target path');
      const target = `${channel.target.node}:${channel.target.path}`;
      assert.ok(!targets.has(target), 'One channel per target property');
      targets.add(target);
      const sampler = animation.samplers[channel.sampler];
      assert.ok(sampler, 'Animation sampler exists');
      assert.ok(['LINEAR', 'STEP'].includes(sampler.interpolation || 'LINEAR'), 'Supported animation interpolation');
      const times = accessor(doc, binary, sampler.input).flat();
      const values = accessor(doc, binary, sampler.output);
      assert.ok(times.length >= 2, 'Clip has at least two frames');
      assert.equal(times.length, values.length, 'Animation frame/output counts');
      assert.ok(times.every((time, i) => Number.isFinite(time) && time >= 0 && (!i || time > times[i - 1])), 'Strictly increasing finite key times');
      assert.ok(times.at(-1) > 0, 'Positive clip duration');
      assert.ok(values.every(row => row.every(Number.isFinite)), 'Finite animation values');
      if (channel.target.path === 'rotation') {
        assert.ok(values.every(row => row.length === 4 && Math.abs(Math.hypot(...row) - 1) < 0.001), 'Normalized animation quaternions');
      }
      durationSeconds = Math.max(durationSeconds, times.at(-1));
      channels += 1;
    }
  }
  if (animationOnly) assert.ok(animations.length > 0, 'Animation pack contains recovered clips');
  return { vertices, triangles, bones: joints.size || named.size, skins: (doc.skins || []).length,
    clips: animations.length, channels, durationSeconds, maxWeightSumError, maxBindError };
}

export function validateRecoveredGlb(data, options) {
  const { doc, binary } = parseGlb(data);
  return validateRecoveredDocument(doc, binary, options);
}

export function validateRecoveredRoster(roster, animationDoc, animationBinary) {
  assert.equal(roster.schema, 1, 'Recovered roster schema');
  assert.ok(roster.players.length >= 1, 'Recovered roster contains players');
  assert.equal(new Set(roster.players.map(player => player.id)).size, roster.players.length, 'Distinct roster identifiers');
  assert.equal(new Set(roster.players.map(player => player.url)).size, roster.players.length, 'Distinct roster model URLs');
  assert.ok(roster.players.some(player => player.id === roster.defaultPlayerId), 'Default player is in roster');
  for (const player of roster.players) {
    assert.ok(Number.isFinite(player.scale) && player.scale > 0, 'Finite positive player scale');
    assert.ok(Number.isFinite(player.rootOffsetY), 'Finite player floor offset');
  }
  const clips = new Map(animationDoc.animations.map(animation => [animation.name,
    Math.max(...animation.samplers.map(sampler => accessor(animationDoc, animationBinary, sampler.input).at(-1)[0]))]));
  for (const action of ['idle', 'move', 'dribble', 'gather', 'shoot', 'layup', 'dunk']) {
    const mapping = roster.animations.mapping[action];
    assert.ok(mapping && clips.has(mapping.clip), `Mapped recovered clip exists: ${action}`);
    assert.ok(Number.isFinite(mapping.start) && Number.isFinite(mapping.end) && mapping.start >= 0 &&
      mapping.end > mapping.start && mapping.end <= clips.get(mapping.clip) + 0.001, `Valid recovered clip segment: ${action}`);
    if (mapping.release !== undefined) assert.ok(Number.isFinite(mapping.release) &&
      mapping.release >= mapping.start && mapping.release <= mapping.end, `Release lies inside recovered clip segment: ${action}`);
  }
  return { players: roster.players.length, mappedActions: Object.keys(roster.animations.mapping).length };
}
