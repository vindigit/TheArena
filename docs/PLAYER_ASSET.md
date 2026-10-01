# Luke canonical character foundation

`public/assets/models/player/luke-player-v1.glb` is the sole playable character.
It is the exact previously integrated Luke binary: **244,360 bytes**, SHA-256
`9eedd88b85386084bc1b19ab70d000376d2ab750dfb6d129bb5dd264767a9135`.
Canonicalization preserves his supplied geometry, proportions, uniform and
embedded color atlas. It does not generate a different character or migrate an
old mesh by renaming it. The runtime loader accepts Luke only; loading and
failure states contain no substitute character.

## Exact rig target

The machine-readable contract is [`rig/luke-rig-contract.json`](rig/luke-rig-contract.json).
[`../src/luke-rig-contract.js`](../src/luke-rig-contract.js) enforces the same
hierarchy, joint order, local translation/quaternion/scale and inverse bind
matrices before the procedural writer starts. Every rest local rotation is
identity and every local scale is one. These are glTF joint frames, not a claim
that Blender's bone roll is zero. All 17 Blender edit bones point along Blender
Z with the common rest basis; export converts Blender Z-up/+Y-forward into
game Y-up/-Z-forward. Match the glTF contract when authoring runtime clips.

```text
luke_player_rig (identity scene container)
  root (floor origin)
    pelvis
      chest
        left_upper_arm -> left_forearm -> left_hand
        neck -> head
        right_upper_arm -> right_forearm -> right_hand
      left_thigh -> left_shin -> left_foot
      right_thigh -> right_shin -> right_foot
```

| Joint landmark | Asset-local rest position, meters |
| --- | --- |
| Pelvis | (0, 1.060, 0) |
| Chest | (0, 1.430, 0.015) |
| Left/right hip | (±0.150, 1.040, 0) |
| Left/right knee | (±0.195, 0.610, 0.015) |
| Left/right ankle | (±0.245, 0.170, 0.045) |
| Left/right shoulder | (±0.240, 1.635, 0.050) |
| Left/right elbow | (±0.550, 1.625, 0.060) |
| Left/right wrist | (±0.885, 1.605, 0.005) |

The table rounds for reading; JSON contains exact exported floats. The ankles
are **0.490 m apart**, with a 0.045 m lateral hip-to-knee offset and 0.050 m
knee-to-ankle offset. Those translations differ from the old character despite
matching bone names. Do not replace them with old-rig offsets.

Game units are meters, right is +X, up is +Y and forward is -Z. The asset's
floor origin is (0,0,0); its mesh bounds are
(-1.042692,0,-0.216936) to (1.042692,2.050,0.195091). Bounds include T-pose arms.
`player.group` alone receives gameplay translation, facing and jump height;
animation is in place and must not animate `root` or the scene container.

The shoe soles rest at floor Y=0. Ankle joints sit 0.170 m above them. Foot
placement must account for the sole offset; treating the ankle as the ground
target sinks the player. Baseline numerical checks allow at most 0.005 m of
sole penetration; this small numerical tolerance is not visual approval.

Stable hand attachments remain under the gameplay root. The pose adapter maps
T-pose sideways wrists into the gameplay palm frame. Gameplay palm offset is
(0,-0.075,-0.125); corresponding bind-local offsets are right
(0.075,-0.125,0) and left (-0.075,-0.125,0). Gather targets continue to follow the
authoritative game ball. Chest/head references are presentation attachments,
not separate character geometry.

## Skin and static validation

The canonical mesh has 3,286 vertices, 4,754 triangles, one material and one
opaque embedded 512×512 atlas. No external buffers/images, decoder dependency
or baked clip are required. Four glTF skin slots exist; at most two contain
nonzero weights. All indices are in range and weights are normalized.

Fresh independent static checks measured maximum weight-sum error **2.98e-8**,
normal-length error **1.04e-7**, minimum triangle area **1.51e-7 m²** and maximum
neutral bind deformation **6.42e-8 m**. Exact inverse matrices and hierarchy
pass. These results show that neutral bones reproduce the supplied mesh; they
do not by themselves establish that every animated pose is attractive.

Repeat checks:

```powershell
npm run rig:check
npm run test:rig
node tests/player.test.mjs
npm run assets:check
npm run build
```

The rig regression tests deliberately mutate hip rest translation, joint
orientation, inverse matrices, weights and skin indices to verify that strict
validation rejects each error. Asset checks reject any additional player GLB
or player inventory record. Runtime pose/transition and visual results are
recorded separately by the Part 1 inspection evidence.

## Maintained source and Part 2

The editable source is local ignored `art/source/player/luke-player-v1.blend`.
Its Luke-only `Luke_Candidate` scene contains the original maintained skinned
mesh, 17-bone rig, packed atlas and review lights/camera. Non-Luke historical
scene data were removed from this source copy; original staging files remain
untouched. [`../art/source/player/README.md`](../art/source/player/README.md)
and [`rig/luke-source-provenance.json`](rig/luke-source-provenance.json) record
hashes, provenance and export conventions. The source is not a runtime or
production-build dependency.

The maintained-source export was repeated through Blender 5.2.1 LTS and
`scripts/validate-luke-source-roundtrip.mjs`: it reproduced the **entire canonical
GLB byte-for-byte**, including embedded geometry, skin, texture, exact rest
frames, inverse matrices and only the required rig/mesh metadata. Scene-only
add-on settings are excluded by the source/export recipe.

The old playable GLB, primitive fallback and old-rig forward-dribble companion
are removed from production. Historical provenance and CMU terms remain in
[`HYBRID_DRIBBLE.md`](HYBRID_DRIBBLE.md), its archived measurements and
[`rig/superseded-player-assets.json`](rig/superseded-player-assets.json).
These are not Luke-compatible animations. `scripts/retarget-dribble.py` now
checks Luke's pinned target only; `scripts/luke-retarget-config.json` gives the
starting source-name map, not a completed retarget.

Part 2 can rely on Luke's exact skeleton/skin contract and stable gameplay
attachments. Author or retarget idle, locomotion, dribble, pickup, shot gather,
release/follow-through and finishes against those frames. Keep root motion
game-owned, validate hand/foot contacts and transition blends, and inspect
deformation from multiple angles before calling a clip compatible. Part 1
does not deliver that animation pack or claim the old hybrid was migrated.
