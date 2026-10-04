# Recovered player migration

The default game uses the two assemblies registered in `src/nba2k9-roster.json`.
Classic 01 and Classic 02 are project labels. Each has 4,676 triangles, 6,637
serialized vertices, the compatible 26-joint player family and seven additional
clothing joints. The source body/head skins share the recovered joint objects;
rest translations, inverse binds, UVs and normalized skin influences are retained.
The source units are normalized by the registry wrapper to 2 m height, floor Y=0,
and -Z facing. Head and jersey selections differ; this is not a broad roster yet.

## Build inputs

Run from the repository with the supplied study directory:

```powershell
node scripts/build-nba2k9-assets.mjs 'C:/path/to/nba2k9-study'
node scripts/update-recovered-manifest.mjs
npm run assets:check
npm run build -- --base=/TheArena/
```

The generator copies selected source geometry, merges compatible joint references,
excludes alternative outfit/accessory surfaces, embeds selected recovered textures
and packages four compatible source clips. It never edits the study package.
`public/assets/models/player/nba2k9/provenance.json` records exact source files,
resource identifiers, texture assignments, output hashes and interpretation limits.
Only the compact selected output is published; the study library and executable
are not game dependencies.

The owner requested recovered assets as the public player foundation and removed
the repository's previous clearance prerequisite. The manifest records unknown
commercial-use status as `null`; it does not assert a license grant.

## Runtime contract

`createPlayer()` in `src/nba2k9-player.js` keeps the stable gameplay root and palm,
chest and head attachments. `setCharacter(id)` replaces only the visual and pose
controller. Concurrent requests discard superseded visuals; a missing model or
motion bundle leaves an explicit error and disables game start. No Luke fallback
is used. The start-screen picker works with keyboard, mouse and touch.

`src/nba2k9-motion.js` samples original recovered rotations and blends state
changes. Gameplay owns player translation, facing, jump height, possession and
ball trajectories. Translation channels are excluded; native root heading is
removed. Additional clothing joints retain their source rest transforms.

Motion names such as `recovered-run` describe this project's intended adaptation,
not verified original clip meanings. The registry maps selected segments to idle,
movement, dribble, gather, shooting and finishes. Contact IK adapts the hands to
the game ball; planted feet and shoe vertices determine grounding. This is a
hybrid recovered/procedural presentation rather than original NBA 2K9 gameplay.

Shot input retains the existing grade. Physical detachment happens once at 0.20 s,
landing at 0.40 s, recovery ends at 0.70 s, and movement can cancel recovery after
landing. Finish detachment samples the current pose at 59% of the layup or 57% of
the dunk. Frame subdivision preserves these event times across render rates.
The release segment is not integrated again as free flight. Perfect-shot arcs
remain active while a below-rim release rises; ordinary collision behavior resumes
after the ball descends below the basket.

## Validation and limits

- `npm run assets:check` checks inventory, fingerprints, finite geometry, normalized
  weights, compatible inverse binds, clip data and all registry URLs/segments.
- Recovered asset and motion tests reject incompatible bindings, invalid weights,
  missing joints, malformed timelines and incompatible action mappings.
- Actual model pose checks exercised both casts over 112 frames and 92,918 sampled
  skin vertices. Maximum required displayed palm-center error was 15.16 mm; sampled
  shoe soles stayed at least 2 mm above the local floor. These are numerical checks,
  not a claim that every hand triangle stays outside the ball or all poses are approved.
- `scripts/verify-recovered-browser.mjs URL OUTPUT_DIR` checks the actual game at
  desktop and emulated portrait/landscape touch sizes. Set `PLAYWRIGHT_MODULE` and
  optionally `PLAYWRIGHT_EXECUTABLE` to use an installed browser runtime.
- `?inspect=1` exposes a read-only `window.__arenaInspection.snapshot()` for browser
  verification. Ordinary play shows no implementation diagnostics.

Recovered clip semantics, original controller behavior, original cloth motion,
and exact NBA 2K9 rendering are not reconstructed. Physical-phone performance and
the owner's visual acceptance require separate observation. This migration does
not add opponents, passing, multiplayer or team modes.

Historical Luke source, tests and the canonical binary remain available without
loading them in ordinary play. Their private work is not overwritten or folded
into the recovered rig.
