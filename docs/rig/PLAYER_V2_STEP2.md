# Player v2 Step 2: exact 22-bone Blender rebuild

Step 2 was performed in the isolated `codex/player-v2-step2` branch based on
published `3a4ecb5` plus the Step 1 contract commit only. Production player
assets and the default legacy loader remain unchanged.

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
| fictional-player-v2 | 586,028 | 4,704 | 3,265 | 2.05 m | 22 | 3 | 0 |
| luke-player-preview | 248,124 | 4,754 | 3,287 | 2.05 m | 22 | 4 | 0 |

Both have one mesh, one skin and one material, and pass the Step 1 contract.

## Visual deformation review

Five proof poses per character are under `docs/rig/v2-evidence/`: arms straight
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

These are Blender deformation proofs, not gameplay, live-browser, animation,
or physical-phone acceptance.

## Deliberately not done

No production asset replacement, runtime sockets, pose adapter, foot IK,
animation library, clip events, ball release, fallback badge, gameplay change,
deployment or main push was performed. Step 3 remains gated on explicit user
approval and the pending jersey replacement decision.
