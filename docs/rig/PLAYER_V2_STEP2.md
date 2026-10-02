# Player v2 Step 2: exact 22-bone Blender rebuild

Step 2 was performed in the isolated `codex/player-v2-step2` branch based on
published `3a4ecb5` plus the Step 1 contract commit only. A subsequent local
integration copies both GLBs into runtime assets. It has not been deployed.

## Deliverables

Both existing character meshes were rebuilt onto the exact 22-bone
`game-humanoid-v2` armature. No Mixamo auto-rigging, upload, or asset was used.

- Local editable sources (ignored):
  - `art/source/player/fictional-player-v2.blend`
  - `art/source/player/luke-player-v2.blend`
- Staged, tracked GLBs:
  - `art/staging/player/fictional-player-v2.glb`
  - `art/staging/player/luke-player-preview.glb`
- Reproducible build, validation, and proof-render scripts:
  - `scripts/build-player-v2-rig.py`
  - `scripts/validate-player-v2-assets.mjs`
  - `scripts/render-player-v2-proof.py`

The armature has exactly Hips, three spine segments, Neck, Head, two shoulder
bones, arm/forearm/hand chains, and up-leg/leg/foot/toe-base chains. Hips is the
skeleton root; no extra Root or finger bones are present. The rest pose is a
2.05 m T-pose. Shoulder pivots lie from the upper chest toward the arm heads;
toe pivots sit at the ball of each shoe.

## Skin and appearance

The original 17-group weights were remapped and redistributed into the three
spine, shoulder, hip and toe regions, normalized per vertex, with at most four
influences. The second shoulder pass also draws upper-chest weights into the
clavicles, reducing the visible armhole separation found in the first arms-up
render.

Geometry, proportions, UVs, material slots and source image bytes are retained.
The embedded Luke JPEG and fictional-player PNG hashes exactly match their
inputs. No jersey texture, branding, color or material was edited. These local
renders have not been shared externally; jersey replacement remains pending.

Hands retain their existing open/spread modeled shapes with one hand bone per
side and no finger bones. No new hand blend shapes were fabricated in this
step.

## Machine validation

| Asset | Bytes | Triangles | Exported vertices | Height | Bones | Max influences | Clips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fictional-player-v2 | 586,056 | 4,704 | 3,265 | 2.05 m | 22 | 3 | 0 |
| luke-player-preview | 248,152 | 4,754 | 3,287 | 2.05 m | 22 | 4 | 0 |

Both have one mesh, one skin and one material, and pass the Step 1 contract.

## Visual deformation review

Five proof poses per character are under `docs/evidence/player-v2/`: arms straight
up, deep squat, back arch, torso twist, and toes down. The action exists only in
the editable Blender files; GLB export explicitly disables animation.

Observed results:

- Arms-up: both arm chains reach overhead and stay connected after the
  upper-chest/shoulder weight correction. Loose sleeve/armhole folds still show
  hard PS2-era topology at the extreme pose, but no open tear is visible.
- Deep squat: hips, knees and ankles remain connected. Baggy shorts bunch and
  stretch noticeably; this is the source mesh's low-density loose-cloth limit
  and should be rechecked against actual basketball clips.
- Back arch and torso twist: the three spine regions deform independently with
  no torso separation. Texture stretch in jersey folds is visible at extremes.
- Toes down: toe regions bend independently at the shoe ball. The chunky shoe
  topology produces a blocky crease rather than a smooth sole roll.

These are Blender deformation proofs, not animation or physical-phone
acceptance. Local production-build browser evidence is under `docs/evidence/`.
Both runtime variants loaded without fallback and survived repeated move/shoot
input. The first visual pass exposed an absolute-local/bind-basis mismatch that
folded the standard legs upward; the adapter now applies the legacy temporary
pose rotations as deltas from each v2 bind basis, and the rerun shows upright
feet, torso and shoulders. This is compatibility plumbing, not a new motion.

## Local integration and remaining gate

The local branch now loads Fictional Player v2 by default and Luke v2 with
`?player=luke`, retaining the legacy GLB as a rollback asset. It adds runtime
load/fallback tests and CI validation for the 22-bone contract. It does not add
or select a replacement basketball motion, alter release timing, or change
gameplay physics ownership.

No deployment or main push was performed. Luke still contains the old branded
uniform. The authorized Library helper fails on this Windows host at
`os.setxattr`, so the supplied replacement GLB has not materialized and was not
silently substituted. Physical-phone comparison remains unperformed.
