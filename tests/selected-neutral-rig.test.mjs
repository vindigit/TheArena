// Structural preflight only. These checks do not certify knee-ring volume or
// visual quality, and deliberately never connect recovered animation clips.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {parseGlb, accessor} from '../scripts/luke-rig-tools.mjs';
import {parseRecoveredScene} from '../scripts/recovered-game-harness.mjs';
import {dualQuaternionPalette, skinDualQuaternion, createVolumePreservingMesh} from '../src/selected-player-skin.js';

const read = name => fs.readFileSync(new URL('../art/player-rebuild/' + name, import.meta.url));
const sourceBytes = read('selected-player-source.glb');
const modelBytes = read('selected-player-neutral-rig.glb');
const source = parseGlb(sourceBytes), model = parseGlb(modelBytes);
const canonical = parseGlb(read('athlete-blockout.glb'));
const sourcePrimitive = source.doc.meshes[0].primitives[0];
const primitive = model.doc.meshes[0].primitives[0];
const sourcePoints = accessor(source.doc, source.binary, sourcePrimitive.attributes.POSITION);
const points = accessor(model.doc, model.binary, primitive.attributes.POSITION);
const jointIndices = accessor(model.doc, model.binary, primitive.attributes.JOINTS_0);
const weights = accessor(model.doc, model.binary, primitive.attributes.WEIGHTS_0);
const triangles = accessor(model.doc, model.binary, primitive.indices).flat();
const style=model.doc.asset.extras.style;
const origins=style.vertexOrigins;
const subset = predicate => points.map((p,i)=>origins[i]<sourcePoints.length&&predicate(sourcePoints[origins[i]])?i:-1).filter(i=>i>=0);
const hierarchy = doc => doc.nodes.slice(0, 26).map(n => ({name: n.name, children: n.children || []}));

async function sceneFixture() {
  const gltf = await parseRecoveredScene(modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength));
  const bones = new Map(); let mesh;
  gltf.scene.traverse(object => {
    if (object.isBone) bones.set(object.name, object);
    if (object.isSkinnedMesh) { assert.ok(!mesh, 'one skinned mesh'); mesh = object; }
  });
  const update = () => { gltf.scene.updateMatrixWorld(true); mesh.skeleton.update(); };
  const posed = ids => { update(); return ids.map(i => mesh.applyBoneTransform(i, new THREE.Vector3(...points[i]))); };
  update();
  return {scene: gltf.scene, bones, mesh, posed, update};
}

function connectedEdges(ids) {
  const members = new Set(ids), edges = new Map();
  for (let k = 0; k < triangles.length; k += 3) {
    for (const [a, b] of [[triangles[k], triangles[k + 1]], [triangles[k + 1], triangles[k + 2]], [triangles[k + 2], triangles[k]]]) {
      if (members.has(a) && members.has(b) && a !== b) edges.set([a, b].sort((x, y) => x - y).join(','), [a, b]);
    }
  }
  return [...edges.values()].filter(([a, b]) => new THREE.Vector3(...points[a]).distanceTo(new THREE.Vector3(...points[b])) > 1e-8);
}

function transverseThickness(positions, axis) {
  const center = positions.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / positions.length);
  return Math.sqrt(positions.reduce((sum, p) => {
    const delta = p.clone().sub(center); delta.addScaledVector(axis, -delta.dot(axis));
    return sum + delta.lengthSq();
  }, 0) / positions.length);
}

test('neutral rig retains 26 named hierarchy joints and explicitly requires retargeting', () => {
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), '26d97a1a31ac65445f06ac0595f08ae3f02174d9aea2ee6225cfffaa6041ada9');
  assert.deepEqual(hierarchy(model.doc), hierarchy(canonical.doc));
  assert.deepEqual(model.doc.skins[0].joints, Array.from({length: 26}, (_, i) => i));
  assert.equal(model.doc.asset.extras.basis, 'selected-athlete-neutral');
  assert.equal(model.doc.asset.extras.retargetRequired, true);
  assert.equal(model.doc.asset.extras.canonicalRestCompatible, false);
  assert.equal(model.doc.asset.extras.motionConnected, false);
  assert.equal(model.doc.asset.extras.skinningRequired, 'dual-quaternion');
  assert.equal(model.doc.animations?.length || 0, 0, 'no clips attached to the new rest basis');
  assert.ok(model.doc.nodes.slice(0, 26).every(n => n.extras.basis === 'selected-athlete-neutral'));
  assert.notDeepEqual(model.doc.nodes[2].translation, canonical.doc.nodes[2].translation, 'own knee rest landmark replaces canonical rest translation');
  assert.ok(model.doc.nodes.slice(0, 26).every(n => !n.rotation || new THREE.Quaternion(...n.rotation).angleTo(new THREE.Quaternion()) < 1e-8));
});

test('style asset retains unrelated source surfaces and source UVs, with a single baked diffuse atlas', () => {
  assert.ok(points.length >= 4673); assert.ok(triangles.length / 3 <= 20000);
  const originalIndices=accessor(source.doc,source.binary,sourcePrimitive.indices).flat();
  const retained=triangles.slice(0,style.retainedSourceFaces.length*3).map(i=>origins[i]);
  assert.deepEqual(retained,style.retainedSourceFaces.flatMap(i=>originalIndices.slice(i*3,i*3+3)));
  assert.deepEqual(accessor(model.doc,model.binary,primitive.attributes.TEXCOORD_1).slice(0,sourcePoints.length),accessor(source.doc,source.binary,sourcePrimitive.attributes.TEXCOORD_0));
  assert.equal(model.doc.images.length,1);assert.equal(model.doc.materials.length,1);assert.equal(model.doc.meshes[0].primitives.length,1);
  const image=model.doc.images[0],view=model.doc.bufferViews[image.bufferView],atlas=model.binary.subarray(view.byteOffset,view.byteOffset+view.byteLength);
  assert.equal(image.mimeType,'image/png');assert.equal(atlas.readUInt32BE(16),512);assert.equal(atlas.readUInt32BE(20),512);
  assert.deepEqual(atlas,read('selected-player-ps2-diffuse.png'));
  assert.equal(model.doc.materials[0].normalTexture,undefined);assert.equal(model.doc.materials[0].occlusionTexture,undefined);
  let unchanged = 0, shaped = 0;
  sourcePoints.forEach((p, i) => {
    if (p[1] <= .545 || p[1] >= .835) {
      assert.deepEqual(points[i], p, `source vertex ${i} outside the upper-body style area remains unchanged`); unchanged++;
    } else if (points[i].some((v, k) => v !== p[k])) shaped++;
  });
  assert.ok(unchanged > 2000); assert.ok(shaped > 0, 'uniform silhouette has an actual authored change');
  for (const key of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'WEIGHTS_0']) {
    assert.ok(accessor(model.doc, model.binary, primitive.attributes[key]).every(row => row.every(Number.isFinite)), `${key} finite`);
  }
  for (let i = 0; i < weights.length; i++) {
    assert.ok(weights[i].every(w => w >= 0 && w <= 1));
    assert.ok(Math.abs(weights[i].reduce((a, b) => a + b, 0) - 1) < 1e-6);
    assert.ok(jointIndices[i].every(j => Number.isInteger(j) && j >= 0 && j < 26));
  }
});

test('clavicles and shoulders widen fifteen percent without lengthening either arm chain',()=>{
  const baseline=JSON.parse(read('history/neutral-rig-r3-rest.json'));
  function world(doc,name){const i=doc.nodes.findIndex(n=>n.name===name),parent=doc.nodes.findIndex(n=>n.children?.includes(i));return new THREE.Vector3(...doc.nodes[i].translation).add(parent<0?new THREE.Vector3():world(doc,doc.nodes[parent].name));}
  for(const side of ['l','r']){
    for(const bone of ['collar','humerus'])assert.ok(Math.abs(world(model.doc,side+bone).x/world(baseline,side+bone).x-1.15)<1e-7);
    for(const [a,b]of [['humerus','elbow'],['elbow','hand']])assert.ok(Math.abs(world(model.doc,side+a).distanceTo(world(model.doc,side+b))-world(baseline,side+a).distanceTo(world(baseline,side+b)))<1e-7);
  }
  const moved=subset(p=>Math.abs(p[0])>.16&&p[1]>.70&&p[1]<.835);
  assert.ok(moved.length>500);
  for(const id of moved){const p=sourcePoints[origins[id]];assert.ok(Math.abs(points[id][0]-p[0]-Math.sign(p[0])*.021)<1e-7);assert.equal(points[id][1],p[1]);assert.equal(points[id][2],p[2]);}
});

test('actual cloth hems sit four inches below knees with wider openings and unit surface normals',()=>{
  for(const [side,sign]of [['l',1],['r',-1]]){
    const knee=JSON.parse(read('selected-neutral-landmarks.json')).landmarks[side+'tibia'];
    const expected=knee[1]-.1016/(2/.998291015625);
    const ring=points.filter((p,i)=>origins[i]>=sourcePoints.length&&p[0]*sign>0&&Math.abs(p[1]-expected)<1e-7);
    assert.ok(ring.length>=20);assert.ok(Math.abs((knee[1]-ring[0][1])*(2/.998291015625)-.1016)<1e-7);
    const width=Math.max(...ring.map(p=>p[0]))-Math.min(...ring.map(p=>p[0]));assert.ok(width*(2/.998291015625)>.26);
    const original=sourcePoints.filter(p=>p[0]*sign>0&&p[1]>.305&&p[1]<.34);
    assert.ok(width>Math.max(...original.map(p=>p[0]))-Math.min(...original.map(p=>p[0])));
  }
  const normals=accessor(model.doc,model.binary,primitive.attributes.NORMAL);
  for(const id of new Set(triangles))assert.ok(Math.abs(new THREE.Vector3(...normals[id]).length()-1)<1e-5,'finite unit normals on rendered surfaces');
});

test('own inverse binds reproduce the neutral mesh without deformation', async () => {
  const {bones, posed} = await sceneFixture(); assert.equal(bones.size, 26);
  const ids = points.map((_, i) => i), result = posed(ids);
  const error = Math.max(...result.map((p, i) => p.distanceTo(new THREE.Vector3(...points[i]))));
  assert.ok(error < 1e-6, `maximum bind error ${error}`);
});

test('each shin shaft belongs exclusively to its own tibia', () => {
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    const ids = subset(p => p[0] * sign > 0 && p[1] > .115 && p[1] < .235);
    assert.ok(ids.length > 30, `${side} actual source shin vertices`);
    ids.forEach(i => {
      const active = weights[i].flatMap((w, k) => w > 0 ? [[model.doc.nodes[jointIndices[i][k]].name, w]] : []);
      assert.deepEqual(active, [[side + 'tibia', 1]], `shaft vertex ${i} must not follow femur or opposite leg`);
    });
  }
});

test('isolated knee hinges preserve shaft edges and thickness, with no opposite-leg motion', async t => {
  // Shaft rigidity does not measure the blended knee ring; deep knee flexion
  // remains a separate volume and silhouette review gate.
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    const {bones, posed, update} = await sceneFixture();
    const ids = subset(p => p[0] * sign > 0 && p[1] > .115 && p[1] < .235);
    const otherIds = subset(p => p[0] * sign < -.03 && p[1] < .43);
    const edges = connectedEdges(ids); assert.ok(edges.length > 30, 'connected shaft edges exist');
    const rest = posed(ids), otherRest = posed(otherIds), lookup = new Map(ids.map((id, k) => [id, k]));
    const knee = bones.get(side + 'tibia'), ankle = bones.get(side + 'foot');
    const axis = ankle.getWorldPosition(new THREE.Vector3()).sub(knee.getWorldPosition(new THREE.Vector3())).normalize();
    const thickness = transverseThickness(rest, axis);
    let maximumEdgeError = 0, maximumThicknessError = 0, maximumOtherDrift = 0;
    for (const angle of [0, 30, 60, 90, 110]) {
      knee.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(angle)); update();
      const current = posed(ids), other = posed(otherIds);
      const posedAxis = ankle.getWorldPosition(new THREE.Vector3()).sub(knee.getWorldPosition(new THREE.Vector3())).normalize();
      const thicknessError = Math.abs(transverseThickness(current, posedAxis) / thickness - 1);
      maximumThicknessError = Math.max(maximumThicknessError, thicknessError);
      assert.ok(thicknessError <= .02, `${side} shaft thickness at ${angle} degrees`);
      for (const [a, b] of edges) {
        const ia = lookup.get(a), ib = lookup.get(b), error = Math.abs(current[ia].distanceTo(current[ib]) / rest[ia].distanceTo(rest[ib]) - 1);
        maximumEdgeError = Math.max(maximumEdgeError, error);
        assert.ok(error <= .02, `${side} shaft edge ${a}/${b} at ${angle} degrees`);
      }
      const drift = Math.max(...other.map((p, k) => p.distanceTo(otherRest[k])));
      maximumOtherDrift = Math.max(maximumOtherDrift, drift);
      assert.ok(drift < 1e-7, `${side} knee cannot move opposite leg`);
    }
    t.diagnostic(`${side}: ${ids.length} shaft vertices, ${edges.length} connected edges; max relative edge ${maximumEdgeError}, thickness ${maximumThicknessError}, opposite drift ${maximumOtherDrift}`);
  }
});

test('isolated elbow hinges move forearms without shrinking them or pulling the opposite arm', async t => {
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    const {bones, posed, update} = await sceneFixture();
    const ids = subset(p => p[0] * sign > .325 && p[0] * sign < .39 && p[1] > .72);
    const otherIds = subset(p => p[0] * sign < -.16 && p[1] > .72);
    const upperIds = subset(p => p[0] * sign > .16 && p[0] * sign < .27 && p[1] > .72);
    assert.ok(ids.length > 5); const edges = connectedEdges(ids); assert.ok(edges.length > 5);
    const rest = posed(ids), otherRest = posed(otherIds), upperRest = posed(upperIds), lookup = new Map(ids.map((id, k) => [id, k]));
    const elbow = bones.get(side + 'elbow'), wrist = bones.get(side + 'hand');
    const axis = wrist.getWorldPosition(new THREE.Vector3()).sub(elbow.getWorldPosition(new THREE.Vector3())).normalize();
    const thickness = transverseThickness(rest, axis); let moved = false;
    for (const angle of [0, 30, 60, 90, 110]) {
      elbow.quaternion.setFromAxisAngle(new THREE.Vector3(0, -sign, 0), THREE.MathUtils.degToRad(angle)); update();
      const current = posed(ids), other = posed(otherIds), upper = posed(upperIds);
      const posedAxis = wrist.getWorldPosition(new THREE.Vector3()).sub(elbow.getWorldPosition(new THREE.Vector3())).normalize();
      assert.ok(Math.abs(transverseThickness(current, posedAxis) / thickness - 1) <= .02, `${side} forearm thickness at ${angle} degrees`);
      for (const [a, b] of edges) {
        const ia = lookup.get(a), ib = lookup.get(b);
        assert.ok(Math.abs(current[ia].distanceTo(current[ib]) / rest[ia].distanceTo(rest[ib]) - 1) <= .02, `${side} forearm edge at ${angle} degrees`);
      }
      assert.ok(Math.max(...other.map((p, k) => p.distanceTo(otherRest[k]))) < 1e-7, 'opposite arm stays fixed');
      assert.ok(Math.max(...upper.map((p, k) => p.distanceTo(upperRest[k]))) < 1e-7, 'elbow hinge does not pull upper-arm shaft');
      if (angle > 0) moved ||= current.some((p, k) => p.distanceTo(rest[k]) > .01);
    }
    assert.ok(moved, 'hinge actually moves the forearm');
    t.diagnostic(`${side}: ${ids.length} forearm vertices, ${edges.length} connected edges checked`);
  }
});

test('dual-quaternion blends preserve each knee-ring radius around isolated hinges where linear blends collapse', async t => {
  // This measures radial preservation under a single hinge, not the entire
  // character silhouette, compound joint poses or source-motion acceptance.
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    const {bones, mesh, posed, update} = await sceneFixture();
    const ring = subset(p => p[0] * sign > .03 && p[1] > .235 && p[1] < .275);
    const blended = ring.filter(i => weights[i].filter(w => w > .1).length === 2);
    assert.ok(blended.length > 5, 'actual knee ring has multiple weighted vertices');
    const knee = bones.get(side + 'tibia'), pivot = knee.getWorldPosition(new THREE.Vector3());
    const radialDistance = p => Math.hypot(p.y - pivot.y, p.z - pivot.z);
    let dqError = 0, minimumLinearRatio = 1;
    for (const angle of [0, 30, 60, 90, 110]) {
      knee.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(angle)); update();
      const inverse = mesh.matrixWorld.clone().invert();
      const palette = dualQuaternionPalette(mesh.skeleton.bones.map((bone, k) =>
        inverse.clone().multiply(bone.matrixWorld).multiply(mesh.skeleton.boneInverses[k]).multiply(mesh.bindMatrix)));
      const linear = posed(ring);
      ring.forEach((id, k) => {
        const original = new THREE.Vector3(...points[id]);
        const corrected = new THREE.Vector3(...skinDualQuaternion(points[id], jointIndices[id], weights[id], palette));
        const restRadius = radialDistance(original);
        assert.ok(restRadius > 1e-5, 'ring fixture is away from hinge axis');
        const error = Math.abs(radialDistance(corrected) / restRadius - 1); dqError = Math.max(dqError, error);
        assert.ok(error < 1e-5, `${side} knee vertex ${id} radius at ${angle} degrees`);
        // A rotation around the lateral hinge also preserves full pivot distance.
        assert.ok(Math.abs(corrected.distanceTo(pivot) / original.distanceTo(pivot) - 1) < 1e-5);
        if (angle === 110 && blended.includes(id)) minimumLinearRatio = Math.min(minimumLinearRatio, radialDistance(linear[k]) / restRadius);
      });
    }
    assert.ok(minimumLinearRatio < .75, 'fixture demonstrates substantial linear-skin radial collapse');
    t.diagnostic(`${side}: ${ring.length} knee-ring vertices; DQ max relative radial error ${dqError}, worst linear radius ratio at 110 degrees ${minimumLinearRatio}`);
  }
});

test('CPU volume-preserving mesh matches neutral bind and hinge DQ, and is an ordinary mesh', async () => {
  const {bones, mesh, update} = await sceneFixture();
  const output = createVolumePreservingMesh(mesh);
  assert.equal(output.mesh.isMesh, true); assert.ok(!output.mesh.isSkinnedMesh);
  assert.equal(output.mesh.skeleton, undefined, 'ordinary mesh has no second skinning stage');
  assert.notEqual(output.mesh.geometry, mesh.geometry, 'dynamic geometry does not overwrite source');
  assert.equal(output.mesh.material, mesh.material);
  const originalNormals = accessor(model.doc, model.binary, primitive.attributes.NORMAL);
  let maximumNeutralError = 0;
  for (let i = 0; i < points.length; i++) {
    maximumNeutralError = Math.max(maximumNeutralError, new THREE.Vector3().fromBufferAttribute(output.mesh.geometry.attributes.position, i).distanceTo(new THREE.Vector3(...points[i])));
  }
  assert.ok(maximumNeutralError < 1e-6, `neutral CPU bind error ${maximumNeutralError}`);
  const knee = bones.get('ltibia'); knee.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(90)); update(); output.update();
  const inverse = mesh.matrixWorld.clone().invert();
  const palette = dualQuaternionPalette(mesh.skeleton.bones.map((bone, k) => inverse.clone().multiply(bone.matrixWorld).multiply(mesh.skeleton.boneInverses[k]).multiply(mesh.bindMatrix)));
  for (let i = 0; i < points.length; i++) {
    const cpu = new THREE.Vector3().fromBufferAttribute(output.mesh.geometry.attributes.position, i);
    const direct = new THREE.Vector3(...skinDualQuaternion(points[i], jointIndices[i], weights[i], palette));
    assert.ok(cpu.distanceTo(direct) < 1e-6, `CPU position ${i} matches direct DQ`);
    const normal = new THREE.Vector3().fromBufferAttribute(output.mesh.geometry.attributes.normal, i);
    assert.ok(Math.abs(normal.length() - new THREE.Vector3(...originalNormals[i]).length()) < 1e-6, 'normal rotation preserves length');
  }
  assert.ok(output.mesh.geometry.boundingSphere.radius > 0);
});

test('common height and facing wrapper cancels from skin palette and applies once to ordinary mesh', async () => {
  const {scene, bones, mesh, update} = await sceneFixture();
  bones.get('ltibia').quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(110)); update();
  const output = createVolumePreservingMesh(mesh), baseline = output.mesh.geometry.attributes.position.array.slice();
  mesh.parent.add(output.mesh);
  const wrapper = new THREE.Group(); wrapper.scale.setScalar(2 / .998291015625); wrapper.rotation.y = Math.PI; wrapper.position.set(.3, 0, -.2); wrapper.add(scene);
  wrapper.updateMatrixWorld(true); output.update(); wrapper.updateMatrixWorld(true);
  const current = output.mesh.geometry.attributes.position.array;
  assert.equal(current.length, baseline.length);
  for (let i = 0; i < current.length; i++) assert.ok(Math.abs(current[i] - baseline[i]) < 1e-6, 'common wrapper must not scale local skinned geometry');
  for (const i of [0, 1024, 3207, points.length - 1]) {
    const expected = new THREE.Vector3().fromArray(baseline, i * 3).applyMatrix4(mesh.matrixWorld);
    const actual = new THREE.Vector3().fromBufferAttribute(output.mesh.geometry.attributes.position, i).applyMatrix4(output.mesh.matrixWorld);
    assert.ok(actual.distanceTo(expected) < 1e-6, 'rendered mesh receives exactly one height/facing transform');
  }
});

test('dual-quaternion path rejects unsupported per-bone scale', async () => {
  assert.throws(() => dualQuaternionPalette([new THREE.Matrix4().makeScale(1, 1.04, 1)]), /rigid bone transforms/);
  assert.throws(() => dualQuaternionPalette([new THREE.Matrix4().makeScale(1.04, 1.04, 1.04)]), /rigid bone transforms/);
  const {bones, mesh, update} = await sceneFixture();
  bones.get('ltibia').scale.y = 1.04; update();
  assert.throws(() => createVolumePreservingMesh(mesh), /rigid bone transforms/);
});
