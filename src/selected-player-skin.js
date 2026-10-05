// Volume-preserving skinning for the neutral character foundation.
// This module is not connected to gameplay or recovered clips.
import * as THREE from 'three';

export function dualQuaternionPalette(matrices) {
  return matrices.map(matrix => {
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    matrix.decompose(position, rotation, scale);
    if (scale.distanceTo(new THREE.Vector3(1, 1, 1)) > 1e-5) {
      throw new Error('Character skin requires rigid bone transforms');
    }
    rotation.normalize();
    const translation = new THREE.Quaternion(position.x, position.y, position.z, 0);
    const dual = translation.multiply(rotation).toArray().map(value => value * .5);
    return {real: rotation.toArray(), dual};
  });
}

export function skinDualQuaternion(point, indices, weights, palette, normal = false) {
  const reference = palette[indices[weights.findIndex(w => w > 0)]].real;
  const real = [0, 0, 0, 0], dual = [0, 0, 0, 0];
  for (let i = 0; i < weights.length; i++) {
    if (!weights[i]) continue;
    const bone = palette[indices[i]];
    const sign = bone.real.reduce((sum, value, k) => sum + value * reference[k], 0) < 0 ? -1 : 1;
    for (let k = 0; k < 4; k++) {
      real[k] += bone.real[k] * weights[i] * sign;
      dual[k] += bone.dual[k] * weights[i] * sign;
    }
  }
  const length = Math.hypot(...real);
  if (length < 1e-8) throw new Error('Degenerate character skin blend');
  const rotation = new THREE.Quaternion(...real.map(v => v / length));
  const output = new THREE.Vector3(...point).applyQuaternion(rotation);
  if (!normal) {
    const displacement = new THREE.Quaternion(...dual.map(v => v / length)).multiply(rotation.clone().conjugate());
    output.add(new THREE.Vector3(displacement.x, displacement.y, displacement.z).multiplyScalar(2));
  }
  return output.toArray();
}

// Returns an ordinary Mesh, so Three.js cannot skin the result a second time.
// Attach it to source.parent and hide/remove the source skin before rendering.
// Shared wrapper transforms are then applied exactly once by that parent.
export function createVolumePreservingMesh(source) {
  if (!source.isSkinnedMesh) throw new Error('Expected a character skin');
  const geometry = source.geometry.clone(), output = new THREE.Mesh(geometry, source.material);
  const positions = source.geometry.attributes.position, normals = source.geometry.attributes.normal;
  const joints = source.geometry.attributes.skinIndex, weights = source.geometry.attributes.skinWeight;
  output.name = source.name + '-volume-preserving';
  output.matrixAutoUpdate = false;
  function update() {
    source.updateWorldMatrix(true, false);
    const inverse = source.matrixWorld.clone().invert();
    const palette = dualQuaternionPalette(source.skeleton.bones.map((bone, i) => {
      bone.updateWorldMatrix(true, false);
      return inverse.clone().multiply(bone.matrixWorld).multiply(source.skeleton.boneInverses[i]).multiply(source.bindMatrix);
    }));
    for (let i = 0; i < positions.count; i++) {
      const index = [joints.getX(i), joints.getY(i), joints.getZ(i), joints.getW(i)];
      const weight = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
      geometry.attributes.position.setXYZ(i, ...skinDualQuaternion([positions.getX(i), positions.getY(i), positions.getZ(i)], index, weight, palette));
      geometry.attributes.normal.setXYZ(i, ...skinDualQuaternion([normals.getX(i), normals.getY(i), normals.getZ(i)], index, weight, palette, true));
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    geometry.computeBoundingSphere();
    output.matrix.copy(source.matrix);
  }
  update();
  return {mesh: output, update};
}
