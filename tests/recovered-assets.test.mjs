import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { accessor, parseGlb } from '../scripts/luke-rig-tools.mjs';
import { validateRecoveredDocument, validateRecoveredGlb, validateRecoveredRoster } from '../scripts/recovered-player-tools.mjs';

const playerFiles = ['player-one.glb', 'player-two.glb'];
const player = parseGlb(await readFile(new URL('../public/assets/models/player/nba2k9/player-one.glb', import.meta.url)));
const motions = parseGlb(await readFile(new URL('../public/assets/animations/nba2k9/motions.glb', import.meta.url)));
const roster = JSON.parse(await readFile(new URL('../src/nba2k9-roster.json', import.meta.url), 'utf8'));

function clone(source) {
  return { doc: structuredClone(source.doc), binary: Buffer.from(source.binary) };
}
function writeFloat(asset, accessorIndex, frame, component, value) {
  const entry = asset.doc.accessors[accessorIndex], view = asset.doc.bufferViews[entry.bufferView];
  assert.equal(entry.componentType, 5126, 'Mutation targets float accessor');
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[entry.type];
  const offset = (view.byteOffset || 0) + (entry.byteOffset || 0) + frame * (view.byteStride || width * 4) + component * 4;
  asset.binary.writeFloatLE(value, offset);
}

for (const filename of playerFiles) {
  test(`${filename} ships complete normalized skins with a compatible rest pose`, async () => {
    const data = await readFile(new URL(`../public/assets/models/player/nba2k9/${filename}`, import.meta.url));
    const metrics = validateRecoveredGlb(data);
    assert.equal(metrics.bones, 33);
    assert.equal(metrics.skins, 2);
    assert.ok(metrics.vertices > 1000 && metrics.triangles > 1000);
    assert.ok(metrics.maxWeightSumError < 0.0001 && metrics.maxBindError < 0.002);
  });
}

test('recovered animation pack has finite normalized bone motion with increasing time', () => {
  const metrics = validateRecoveredDocument(motions.doc, motions.binary, { animationOnly: true });
  assert.ok(metrics.clips >= 1 && metrics.channels >= 26 && metrics.durationSeconds > 0);
});

test('incomplete player assemblies fail the publication check', () => {
  const damaged = clone(player);
  damaged.doc.nodes.find(node => node.name === 'head').name = 'missing-head';
  assert.throws(() => validateRecoveredDocument(damaged.doc, damaged.binary), /Canonical bone required: head/);
});

test('unnormalized skin weights fail rather than deform unpredictably', () => {
  const damaged = clone(player);
  const index = damaged.doc.meshes[0].primitives[0].attributes.WEIGHTS_0;
  const weights = accessor(damaged.doc, damaged.binary, index)[0];
  const component = weights.findIndex(weight => weight > 0);
  writeFloat(damaged, index, 0, component, 0);
  assert.throws(() => validateRecoveredDocument(damaged.doc, damaged.binary), /Normalized skin weights/);
});

test('mismatched inverse bind matrices fail before the player can collapse at runtime', () => {
  const damaged = clone(player);
  const index = damaged.doc.skins[0].inverseBindMatrices;
  const translation = accessor(damaged.doc, damaged.binary, index)[0][12];
  writeFloat(damaged, index, 0, 12, translation + 1);
  assert.throws(() => validateRecoveredDocument(damaged.doc, damaged.binary), /Inverse bind\/rest agreement/);
});

test('non-monotonic recovered clip times are rejected', () => {
  const damaged = clone(motions);
  const sampler = damaged.doc.animations[0].samplers[0];
  writeFloat(damaged, sampler.input, 1, 0, 0);
  assert.throws(() => validateRecoveredDocument(damaged.doc, damaged.binary, { animationOnly: true }), /Strictly increasing finite key times/);
});

test('invalid recovered rotation quaternions are rejected', () => {
  const damaged = clone(motions);
  const animation = damaged.doc.animations[0];
  const channel = animation.channels.find(channel => channel.target.path === 'rotation');
  const sampler = animation.samplers[channel.sampler];
  for (let i = 0; i < 4; i += 1) writeFloat(damaged, sampler.output, 0, i, 0);
  assert.throws(() => validateRecoveredDocument(damaged.doc, damaged.binary, { animationOnly: true }), /Normalized animation quaternions/);
});

test('all gameplay actions map to existing recovered clips and valid segments', () => {
  assert.deepEqual(validateRecoveredRoster(roster, motions.doc, motions.binary), { players: 2, mappedActions: 7 });
});

test('missing action clips and segments outside a source clip fail publication', () => {
  const unknown = structuredClone(roster);
  unknown.animations.mapping.shoot.clip = 'missing-basketball-shot';
  assert.throws(() => validateRecoveredRoster(unknown, motions.doc, motions.binary), /Mapped recovered clip exists: shoot/);
  const overrun = structuredClone(roster);
  overrun.animations.mapping.move.end = 100;
  assert.throws(() => validateRecoveredRoster(overrun, motions.doc, motions.binary), /Valid recovered clip segment: move/);
});
