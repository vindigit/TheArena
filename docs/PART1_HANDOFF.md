# Luke foundation — Part 1 handoff

Part 1 is complete in the local worktree, starting from clean `main` at
`e436aa2f2003924fb634d656b1b3528e84b5c0cc`. Luke is the sole runtime character.
His isolated rig and baseline poses were rendered and inspected. The lower-body
gather discontinuity is fixed, and the incompatible legacy pickup/hybrid writer
has been removed. Publication to `main` was subsequently authorized by the user.

## Diagnosis and correction

The current-game recording shows the old navy number-7 player with the CMU
motion credit. This strongly identifies the hybrid preview, but its complete
query, deployed commit and actual clip-load status cannot be recovered from
the footage. The other recording is reference footage from another game.
The clearest recorded transitions are gathers around 8.1–8.2 and 18.7–18.8
seconds; the 13–15-second return is a separate loose-ball pickup.

Three independently reproduced changes explain the reported foundation issue:

- The old hybrid gather dropped weight from 0.999972 to zero, released its foot
  plants and exposed the procedural shooting stance in one frame. The shin
  changed 55.49°, the pelvis rose 11.69 cm and one ankle moved 34.04 cm.
- Luke's former procedural preview also replaced its moving legs immediately
  on gather, moving one ankle 22.61 cm. It did not use the hybrid clip.
- On moving loose-ball pickup, the old hybrid applied full leg IK while clip
  weight was only 0.2212: a 34.94° shin change and 2.59 cm pelvis drop.

The bones were being driven through discontinuities. The isolated Luke mesh
follows sensible poses; there is no evidence requiring new weights, joint
placement or topology. The detailed recording evidence, raw transforms and
remaining uncertainty are in [the diagnosis](PART1_RECORDING_DIAGNOSIS.md).

Luke now has one procedural pose writer. Every frame begins with captured rest
translation, quaternion and scale. A 160 ms lower-body handoff preserves the
outgoing stride through gather, movement, stop and finish action changes.
Reset clears that pose history. Arms retain the authoritative gameplay ball
anchors. The verified -Z-facing rig also requires negative local-X shin
flexion; locomotion, squat and finish targets now bend knees forward.
There is no active clip mixer, hybrid leg IK, foot-plant correction or post-ball
arm writer. The game still owns movement, facing, jump height and possession.

At four sampled stride phases, first-gather ankle motion at 120 Hz is at most
16.55 mm, pelvis movement 0.058 mm and knee rotation 1.41°. The mesh, rest
frames and supplied uniform remain unchanged. Camera and gameplay mechanics
were not changed to hide the defect.

## Canonical asset and animation contract

- Runtime: [`luke-player-v1.glb`](../public/assets/models/player/luke-player-v1.glb),
  244,360 bytes, SHA-256
  `9eedd88b85386084bc1b19ab70d000376d2ab750dfb6d129bb5dd264767a9135`.
- Exact contract: [`luke-rig-contract.json`](rig/luke-rig-contract.json);
  readable hierarchy, units, joint landmarks and hand/sole conventions:
  [`PLAYER_ASSET.md`](PLAYER_ASSET.md).
- Maintained editable source: local ignored
  `art/source/player/luke-player-v1.blend`, with packed atlas and Luke-only
  scene. [Source instructions](../art/source/player/README.md) and
  [measured provenance](rig/luke-source-provenance.json) are tracked.
- The maintained source's safe export reproduces the **entire canonical GLB
  byte-for-byte**, including geometry, skin, texture, hierarchy and inverse
  binds. Source add-on scene metadata is excluded from export.
- Luke-only [retarget configuration](../scripts/luke-retarget-config.json)
  and [target validation script](../scripts/retarget-dribble.py) export no clips.

The contract has 17 joints, identity glTF local rest rotations/scales and
Luke-specific translations. Units are meters, +Y is up and -Z is forward.
Neutral soles are Y=0; ankle joints are 0.170 m above the soles and 0.490 m
apart. Animation must be in place: `player.group` retains root translation,
facing and jump ownership. Stable hand anchors use the documented mirrored
bind-local palm offsets. Bone names alone do not establish compatibility.

Skin inspection measured 3,286 vertices, 4,754 triangles, one material,
one 512×512 atlas, maximum two nonzero influences, weight-sum error 2.98e-8
and bind-position error 6.42e-8 m. Strict runtime and offline checks reject
incorrect rest frames, hierarchy, inverse matrices and skin indices/weights.

## Repeatable inspection

Run `npm run dev`, then open `/dev/rig.html` on the printed local URL.
This development page is excluded from the production entry and build.
It provides a plain lit floor, 0.25 m grid, colored bones/joints, front, side
and three-quarter cameras, fixed stress controls and transition loops.

Ten pose controls cover neutral bind standing, alternating knee bends,
shallow squat, athletic crouch, forward step, wide stance, torso lean,
arm raise and ball hold. In isolated mode, rest-derived stress targets are
fixed and gameplay writers do not run. Ball hold uses one static arm IK solve.
In adapter mode, the procedural base runs first and the same stress targets
own their selected joints last. Thus both modes expose the selected lower-body
targets while allowing the procedural upper-body result to be compared.
Move-to-gather and loose-to-pickup loops run the adapter without hybrid or
foot correction. The actual game harness separately exercises possession.

```powershell
node scripts/prepare-player-check.mjs
# Open /.tmp/player/game.html; window.arenaPlayerCheck exposes deterministic checks.
# Start an owned agent-browser session, then pass its local `get cdp-url` output:
node scripts/check-player-browser.mjs <owned-cdp-url> <dev-server-url>
node scripts/capture-player-motion.mjs <owned-cdp-url> <dev-server-url>
```

Historical comparison is optional: `--compare-before` uses the preserved,
ignored `.tmp/part1-before/` snapshot of the starting revision. Normal current
checks and the production build require no old character or old clip.
`--reuse-rig` reuses unchanged first-pass pose captures during browser-runner
repair and is recorded as such; a fresh normal run recaptures every pose.

## Visual evidence and verification

The rendered review found stable lateral knee spacing, forward knee bends,
flat grounded squat soles and no unexplained pelvis collapse. Hip, knee,
ankle, shoulder, elbow and wrist poses were checked with joint overlays;
hands meet the gather and finish anchors. The modest 17-bone skin retains
the supplied low-poly appearance. This is baseline rig approval, not approval
of a full animation pack.

- [Isolated lower body, three views](evidence/part1-rig-isolated-legs.jpg)
  and [isolated upper body](evidence/part1-rig-isolated-upper.jpg).
- [Adapter plus lower-body stresses](evidence/part1-rig-adapter-legs.jpg)
  and [adapter plus upper-body stresses](evidence/part1-rig-adapter-upper.jpg).
- [Comparable Luke before/after gather](evidence/part1-gather-before-after.jpg),
  using the same fixed root-relative diagnostic camera, with no gameplay
  camera change.
- [Repeated actual pickup/gather/release frames](evidence/part1-gameplay-transitions.jpg),
  [captured replay](evidence/part1-repeated-transitions.webm) and
  [game-state samples](evidence/part1-repeated-transitions.json).
- [Sequential rendered-motion review](PART1_MOTION_REVIEW.md) and
  [three gather sequences](evidence/part1-motion-review.jpg) confirm no recurring
  inward collapse or pelvis pop across three gathers and three pickup windows.
  Decoder timestamps, source hash and capture cadence are recorded separately.
- [Fresh built ordinary-URL launch](evidence/part1-production-ordinary-launch.png),
  [intentional Luke-load failure](evidence/part1-intentional-load-failure.png),
  and touch captures at [320×568](evidence/part1-touch-320x568.png),
  [390×844](evidence/part1-touch-390x844.png) and
  [844×390](evidence/part1-touch-844x390.png).
- [Browser validation](evidence/part1-browser-validation.json): 21 checks pass,
  desktop/touch handlers, real CDP touch input, reset/reload, Luke-only network
  requests and failed-load isolation. Sixty pose/view captures were reviewed.

Final automated checks: **51/51 tests pass**, `npm run rig:check` passes,
`npm run assets:check` passes, maintained-source roundtrip passes, and
`npm run build -- --base=/TheArena/` passes. The existing bundle-size warning
remains. The full 305-pose skin test stays within 3 mm floor penetration;
an additional 54-case gather/stop sweep at 30/60/120 Hz stays within 1.45 mm
for sampled vertices. Small numerical tolerances do not replace rendered review.

The built preview must use the same base as the build:
`npm run preview -- --base=/TheArena/ --port 5185`.
A fresh launch of `/TheArena/` rendered Luke and requested only the canonical
player GLB. Built `assets/models/player/` contains Luke and historical terms,
with no old player or dribble GLB. Development network traces also verified
no old requests on ordinary launch or an intentional Luke-load failure.
The failure card blocks play; reload with the asset available recovers Luke.

The recording proves visible discontinuities but cannot identify its deployed
commit or blend diagnostics. New motion capture uses fixed 60 Hz simulation
steps with variable capture wall time; it is not a phone-FPS benchmark.
Touch checks use browser emulation, not a physical phone. These evidence files
describe local verification; publication status is reported separately.

## Files and Part 2 boundary

Runtime work is in `src/player.js`, `src/player-root.js`, `src/player-pose.js`,
`src/luke-rig-contract.js` and the loading/reset changes in `src/main.js`,
`src/styles.css` and `index.html`. The procedural mannequin and hybrid writer
were deleted. The player manifest and validators, source/export/retarget
scripts, tests, development inspection/harness, project handoff and asset
documentation now use Luke. Old GLBs, old generator and old-rig fixture/test
were removed; their provenance is retained in Git and the
[superseded asset ledger](rig/superseded-player-assets.json).

Part 2 can rely on the pinned Luke asset/rest/skin contract, maintained source,
in-place gameplay root, stable hand anchors, repeatable inspection and explicit
single-writer baseline. It must author or retarget idle, locomotion, dribble,
pickup, gather, release/follow-through and finishes against Luke's frames,
then validate clip blends and hand/foot contacts visually. The old hybrid is
superseded, **not migrated**. Arms and the ball still change directly into
their gameplay gather anchors; a dedicated pickup and a polished upper-body
transition remain Part 2. No new mechanics, environment, opponents or full
animation pack were started.
