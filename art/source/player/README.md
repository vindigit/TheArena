# Local Luke source

`luke-player-v1.blend` is the maintained editable source copied from the already
integrated Luke rig and cleaned to its `Luke_Candidate` scene. The original
`.tmp/luke/luke-rigged.blend` and supplied mesh staging remain untouched. The
copy preserves Luke's mesh, skin weights, 17-bone rest rig and packed original
512×512 uniform atlas. Historical non-Luke scene data and its missing external
image and scene-only add-on properties were removed from the maintained copy;
no runtime geometry was changed. Only rig/mesh contract metadata is exported.

Source `.blend` files remain ignored, following this repository's publication
convention. Do not move them into `public/` or add them as production build
dependencies. The runtime GLB, source hashes and exact exported rig contract
are tracked in `docs/rig/luke-source-provenance.json` and
`docs/rig/luke-rig-contract.json`. A clean clone gets the canonical GLB and
contract; the local Blender source can be restored by importing that GLB if
the separate local source copy is unavailable (original pre-optimization
geometry cannot be reconstructed from runtime alone).

For maintenance, open the source with Blender 5.2.1 LTS. Blender coordinates
are Z-up and +Y-forward; glTF export produces Y-up and -Z-forward. Mesh and rig
object transforms are applied/identity. All exported joint rotations are
identity but Blender's edit-bone basis is not the glTF basis. Preserve the
exported rest frames and inverse matrices, not bone names alone.

To create a staged, neutral GLB without modifying the production asset:

```powershell
blender --background art/source/player/luke-player-v1.blend --python scripts/export-luke-source.py
node scripts/validate-luke-source-roundtrip.mjs
```

The script exports only Luke mesh/rig, Y-up, required custom-axis metadata,
JPEG quality 90, no animations, to
ignored `.tmp/luke/luke-maintained-source-export.glb`. Inspect appearance and
deformation, run the strict rig checks and deliberately version the canonical
binary/contract together before shipping a changed export. The supplied Part 1
runtime binary remains byte-identical to the previously integrated Luke.
The source roundtrip check requires identical embedded geometry/skin/texture
bytes, exact parsed glTF structure, rest frames and inverse binds; only exporter
generator metadata or JSON encoding can differ. It cannot approve or replace a
new production asset hash.

`luke-repaired-source.blend` is optional historical pre-rig local staging,
retained separately for topology repair provenance. It is not a retarget
target. Part 2 targets `luke-player-v1.glb` and the exact JSON rig contract.
