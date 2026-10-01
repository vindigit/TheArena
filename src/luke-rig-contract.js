// Canonical Luke glTF rest frames. Captured from the supplied integrated asset.
// Contract changes require deliberate source/export + JSON contract + test updates.
export const LUKE_BONES = Object.freeze([
  {
    "name": "root",
    "parent": "luke_player_rig",
    "translation": [
      0,
      0,
      0
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    ]
  },
  {
    "name": "pelvis",
    "parent": "root",
    "translation": [
      0,
      1.059999942779541,
      0
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      1.059999942779541,
      0,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      -1.059999942779541,
      0,
      1
    ]
  },
  {
    "name": "chest",
    "parent": "pelvis",
    "translation": [
      0,
      0.36999988555908203,
      0.014999999664723873
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      1.429999828338623,
      0.014999999664723873,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      -1.429999828338623,
      -0.014999999664723873,
      1
    ]
  },
  {
    "name": "left_upper_arm",
    "parent": "chest",
    "translation": [
      -0.23999999463558197,
      0.20500004291534424,
      0.03500000014901161
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.23999999463558197,
      1.6349998712539673,
      0.049999999813735485,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.23999999463558197,
      -1.6349998712539673,
      -0.05000000074505806,
      1
    ]
  },
  {
    "name": "left_forearm",
    "parent": "left_upper_arm",
    "translation": [
      -0.3100000023841858,
      -0.009999990463256836,
      0.009999997913837433
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.5499999970197678,
      1.6249998807907104,
      0.05999999772757292,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.550000011920929,
      -1.6249998807907104,
      -0.05999999865889549,
      1
    ]
  },
  {
    "name": "left_hand",
    "parent": "left_forearm",
    "translation": [
      -0.3349999785423279,
      -0.019999980926513672,
      -0.054999999701976776
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.8849999755620956,
      1.6049998998641968,
      0.004999998025596142,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.8849999904632568,
      -1.6049998998641968,
      -0.004999998956918716,
      1
    ]
  },
  {
    "name": "neck",
    "parent": "chest",
    "translation": [
      0,
      0.3200000524520874,
      -0.009999999776482582
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      1.7499998807907104,
      0.004999999888241291,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      -1.7499998807907104,
      -0.004999999888241291,
      1
    ]
  },
  {
    "name": "head",
    "parent": "neck",
    "translation": [
      0,
      0.059999942779541016,
      -0.009999999776482582
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      1.8099998235702515,
      -0.004999999888241291,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      -1.8099998235702515,
      0.004999999888241291,
      1
    ]
  },
  {
    "name": "right_upper_arm",
    "parent": "chest",
    "translation": [
      0.23999999463558197,
      0.20500004291534424,
      0.03500000014901161
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.23999999463558197,
      1.6349998712539673,
      0.049999999813735485,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.23999999463558197,
      -1.6349998712539673,
      -0.05000000074505806,
      1
    ]
  },
  {
    "name": "right_forearm",
    "parent": "right_upper_arm",
    "translation": [
      0.3100000023841858,
      -0.009999990463256836,
      0.009999997913837433
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.5499999970197678,
      1.6249998807907104,
      0.05999999772757292,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.550000011920929,
      -1.6249998807907104,
      -0.05999999865889549,
      1
    ]
  },
  {
    "name": "right_hand",
    "parent": "right_forearm",
    "translation": [
      0.3349999785423279,
      -0.019999980926513672,
      -0.054999999701976776
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.8849999755620956,
      1.6049998998641968,
      0.004999998025596142,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.8849999904632568,
      -1.6049998998641968,
      -0.004999998956918716,
      1
    ]
  },
  {
    "name": "left_thigh",
    "parent": "pelvis",
    "translation": [
      -0.15000000596046448,
      -0.019999980926513672,
      0
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.15000000596046448,
      1.0399999618530273,
      0,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.15000000596046448,
      -1.0399999618530273,
      0,
      1
    ]
  },
  {
    "name": "left_shin",
    "parent": "left_thigh",
    "translation": [
      -0.04499998688697815,
      -0.4299999475479126,
      0.014999999664723873
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.19499999284744263,
      0.6100000143051147,
      0.014999999664723873,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.19499999284744263,
      -0.6100000143051147,
      -0.014999999664723873,
      1
    ]
  },
  {
    "name": "left_foot",
    "parent": "left_shin",
    "translation": [
      -0.050000011920928955,
      -0.4399999976158142,
      0.030000001192092896
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.24500000476837158,
      0.17000001668930054,
      0.04500000085681677,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.24500000476837158,
      -0.17000001668930054,
      -0.04500000178813934,
      1
    ]
  },
  {
    "name": "right_thigh",
    "parent": "pelvis",
    "translation": [
      0.15000000596046448,
      -0.019999980926513672,
      0
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.15000000596046448,
      1.0399999618530273,
      0,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.15000000596046448,
      -1.0399999618530273,
      0,
      1
    ]
  },
  {
    "name": "right_shin",
    "parent": "right_thigh",
    "translation": [
      0.04499998688697815,
      -0.4299999475479126,
      0.014999999664723873
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.19499999284744263,
      0.6100000143051147,
      0.014999999664723873,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.19499999284744263,
      -0.6100000143051147,
      -0.014999999664723873,
      1
    ]
  },
  {
    "name": "right_foot",
    "parent": "right_shin",
    "translation": [
      0.050000011920928955,
      -0.4399999976158142,
      0.030000001192092896
    ],
    "rotation": [
      0,
      0,
      0,
      1
    ],
    "scale": [
      1,
      1,
      1
    ],
    "worldRestMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0.24500000476837158,
      0.17000001668930054,
      0.04500000085681677,
      1
    ],
    "inverseBindMatrix": [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -0.24500000476837158,
      -0.17000001668930054,
      -0.04500000178813934,
      1
    ]
  }
]);
export const LUKE_BONE_NAMES = Object.freeze(LUKE_BONES.map(b => b.name));

export function validateLukeRig(THREE, visual, bones, meshes) {
  const tolerance = 1e-6;
  const fail = message => { throw new Error('Luke rig contract: ' + message); };
  const near = (actual, expected, message) => {
    if (actual.length !== expected.length || actual.some((v, i) => !Number.isFinite(v) || Math.abs(v - expected[i]) > tolerance)) fail(message);
  };
  if (bones.size !== LUKE_BONES.length || meshes.length !== 1) fail('expected 17 bones and one skinned mesh');
  visual.updateMatrixWorld(true);
  for (const entry of LUKE_BONES) {
    const bone = bones.get(entry.name);
    if (!bone || bone.parent?.name !== entry.parent) fail(entry.name + ' hierarchy differs');
    near(bone.position.toArray(), entry.translation, entry.name + ' rest translation differs');
    near(bone.quaternion.toArray(), entry.rotation, entry.name + ' rest rotation differs');
    near(bone.scale.toArray(), entry.scale, entry.name + ' rest scale differs');
  }
  const container = bones.get('root').parent;
  if (container.userData.game_axes_corrected !== true) fail('T-pose axis metadata absent');
  near(container.position.toArray(), [0, 0, 0], 'container translation differs');
  near(container.quaternion.toArray(), [0, 0, 0, 1], 'container rotation differs');
  near(container.scale.toArray(), [1, 1, 1], 'container scale differs');
  for (const mesh of meshes) {
    near(mesh.position.toArray(), [0, 0, 0], 'mesh translation differs');
    near(mesh.quaternion.toArray(), [0, 0, 0, 1], 'mesh rotation differs');
    near(mesh.scale.toArray(), [1, 1, 1], 'mesh scale differs');
    near(mesh.bindMatrix.toArray(), new THREE.Matrix4().toArray(), 'mesh bind matrix differs');
    if (mesh.skeleton.bones.length !== LUKE_BONES.length) fail('skin joint count differs');
    LUKE_BONES.forEach((entry, i) => {
      if (mesh.skeleton.bones[i] !== bones.get(entry.name)) fail('skin joint order differs at ' + entry.name);
      near(mesh.skeleton.boneInverses[i].toArray(), entry.inverseBindMatrix, entry.name + ' inverse bind matrix differs');
    });
  }
  return { contract: 'luke-player-v1', restPoseValidated: true, inverseBindMatricesValidated: true };
}
