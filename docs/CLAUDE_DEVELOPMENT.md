# Claude development branch — revision 4 transfer

Use `codex/claude-player-development`. It is based on the documentation handoff
over remote main, with only the selected-player rebuild added. No replacement
has been activated in gameplay, and main has not been changed.

## Available inputs

- All files in `art/player-rebuild`: immutable supplied GLB, current rigged R4
  GLB, diffuse/source atlas, authoring GLB, UV recipe, landmarks, status, six pose
  stills, audit and historical test fixtures. Historical fits/blockout are
  rejected and must not be selected for gameplay.
- Six editable Blender sources in `art/source/player-rebuild`, including the
  current `selected-ps2-style-r4.blend`, neutral R3 source and original import.
  These files were deliberately committed despite the ordinary ignore rule.
  Backup .blend1 files and unrelated Luke work are not included.
- All 976 compatible source-motion GLBs in
  `art/player-rebuild/source-motion`, byte-for-byte checked against the audit's
  glbHash, plus all 976 original metadata JSONs checked against metadataHash.
  Root trajectories and event data are retained without interpreting them.
  Audit URLs, the preparation script and historical test fixture path
  now use that tracked directory. No unresolved-binding clips are included.
- Current generator/style/bake/skin scripts, audit preparation and historical
  capture/blockout scripts; current DQ utility and the two rebuild test files.
- Suspended moving review and working static gallery in `dev`.

The transfer manifest at `art/player-rebuild/cloud-transfer-manifest.json` lists
SHA-256 hashes for the supplied art, Blender files and motion copies. These are
actual tracked binaries, not external download placeholders. No Git LFS setup
is needed. Keep recovery copies and the supplied source GLB read-only. Original
external recovery archives, archived videos and external recovery tools are not
bundled. Raw metadata is included for inspection; its event semantics remain
unverified. The preparation script still expects the original external study
catalog and prior analysis when regenerating the whole audit. Use the supplied
audit and source copies for current review.

## Start and checks

From the repository root:

```sh
npm ci
node --test tests/selected-neutral-rig.test.mjs tests/player-rebuild.test.mjs
npm run assets:check
npm run build
npm run build -- --base=/TheArena/
npm run dev
```

Open `/dev/player-skin-review.html` for the six static poses.
`/dev/player-rebuild.html` intentionally has no motion renderer. The historical
capture script depends on that removed renderer API and cannot capture new
footage until a suitable review renderer is deliberately implemented.

The bake script now takes `PROJECT_ROOT` when provided inside Blender, otherwise
the current working directory; run from the repository root. It no longer
assumes a Windows path. Load the included R4/neutral Blender source first: baking
still needs the neutral scene, and rendering needs the saved R4 scene and named
objects. Blender and any optional MCP bridge are environment prerequisites,
not supplied by npm. A fresh bake is not part of this transfer.

## Review boundaries

The flags remain approved:false, motionConnected:false and previewEnabled:false.
The static gallery remains usable. The own rest basis still requires validated
retargeting and explicit DQ skinning. The 12 current structural checks and six
historical checks do not establish visual acceptance or current motion coverage.
Start by inspecting current assets and the owner's silhouette/compound-pose
review gate. Keep the fresh clip-based controller separate from the rejected
analytic gait. Preserve gameplay ownership/interfaces. No replacement publication
to main before explicit owner visual approval.

This transfer makes the implementation available; it does not itself begin
retargeting, change animation or grant visual approval. Read the prior handoff
for history, then report your actual inspection/check results before the next
authorized implementation task.

## Transfer verification

Run `node scripts/verify-selected-player-transfer.mjs` to check all transferred
art/source hashes and the 976 clip/metadata pairs against the audit. The transfer
was checked in isolation: 18 focused tests, runtime asset checks and both builds
passed; existing bundle-size warnings remain. Blender rebaking, new motion
playback and compound-pose visual acceptance were not performed.
