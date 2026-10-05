# TheArena — project handoff

## Canonical locations

- Repository: https://github.com/vindigit/TheArena
- Live game: https://vindigit.github.io/TheArena/
- Primary deployment branch: `main`
- This repository is the source of truth. Keep changes focused and preserve unrelated local work.

Cloud handoff: `codex/claude-player-handoff` is a documentation-only branch.
The player-rebuild state described here is the owner's local workspace snapshot;
its new assets/scripts and ignored Blender/motion sources are not included in
that remote branch. Read `docs/CLAUDE_HANDOFF.md` before interpreting missing files.

## Product direction

The goal is browser basketball with single-player and online 1v1, 2v2 and 3v3.
The current release remains a two-minute solo run. The selected-player rebuild
and its visual reviews are the immediate priority; complete CPU 1v1 is a later
gameplay milestone. Team modes and online play are not implemented by this migration.

## Current player foundation

The owner has rejected this player presentation and requested a replacement
around reviewed 2K motion. The moving review at `/dev/player-rebuild.html` is
suspended; the current static review is `/dev/player-skin-review.html`.
See `docs/PLAYER_REBUILD.md` and `docs/CLAUDE_HANDOFF.md`. Its source audit and
earlier deformation blockout are staged only; the blockout is not the selected player.
The owner selected the
existing Tripo athlete `73d1ba25-094d-47c5-9b34-40203d7a2f82` as the replacement;
its supplied GLB is now imported with an editable Blender source and an unapproved
revision 2 was rejected for structural collapse, arms, posture and clothing.
Both local and phone motion previews are suspended. The phone review now shows
selectable static poses of the rebuilt structure at the owner's request. A source-centered neutral
26-joint rig is now staged in `art/player-rebuild/selected-player-neutral-rig.glb`.
Revision 4 widens shoulders 15%, extends baggy shorts four inches below the knee,
deepens armholes and uses one baked 512×512 diffuse atlas (5,139 triangles);
its own rest basis requires validated retargeting before any 2K playback.
Final character quality,
action mappings, gameplay integration and visual approval remain incomplete.
The current game remains playable during development.

The ordinary URL loads a complete recovered NBA 2K9 player assembly. The start
screen offers Classic 01 and Classic 02; `?character=classic-two` selects the second
player directly. Both combine selected athletic body, head and original textures,
with 33 shared joints: the canonical 26-joint animation family and seven additional
body/clothing joints. Models are normalized to 2 m height and face the game's -Z
forward axis. Names are project labels, not verified real-player identities.

`src/nba2k9-player.js` loads the registry and compatible motion bundle behind the
stable gameplay root and attachment API. `src/nba2k9-motion.js` samples recovered
action rotations, blends transitions, grounds feet and solves attached-ball contacts.
The rejected local locomotion candidate still executes in this dirty checkout's
Classic 01/02 path and uses separate authored walk/run recipes in
`src/recovered-locomotion.js`, distance-driven phase and stance footprints, with an
independent dribble-arm layer. See `docs/LOCOMOTION_REVIEW.md` for local review
footage and checks; it is unapproved and must not become the new replacement's
controller. This local state must not be assumed to match deployed `main`. The four
recovered motions still supply action pose segments; their original action meanings
and exact original-game fidelity remain unverified. In-place motion does not own gameplay translation, facing, jump,
possession, shot grades or free-ball physics. Loading failure blocks play explicitly.

See `docs/RECOVERED_PLAYER.md` for source selections, regeneration, validation and
known limits. The owner requested public integration and removal of the previous
rights-clearance prerequisite. Source hashes and provenance remain accurate;
unavailable license information is recorded as unknown, not as a grant.

Luke's binary, rig contract, old pose modules and associated tests remain historical
maintenance work. They are not the default character path. Unfinished local Luke
changes must not be overwritten by the migration.

## Playable slice

- Indoor arena, player, basketball, hoop, backboard and net.
- Keyboard/mouse and touch movement, sprint, timed jump shots, layups, dunks and reset.
- Two-minute solo scoring run with deterministic shot grading and arcs.
- PS2-era presentation, validated court/arena/ball assets and sampled audio with
  procedural fallback. The arena, court and audio keep their accepted implementations.

## Working agreement

- Keep the early-2000s console basketball look and readable movement.
- Preserve desktop and touch playability and verify both when controls change.
- The owner has selected recovered NBA 2K9 player models and motions as project inputs.
- Keep gameplay orchestration in `src/main.js`; player, arena and audio implementations
  remain replaceable modules. Animation cannot move the authoritative gameplay root.
- Run `npm run build` after code, asset or configuration changes.
- Build production with `npm run build -- --base=/TheArena/`; a push to `main` publishes
  through GitHub Pages. Verify the actual deployed build after the workflow completes.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Input, game loop, camera, ball interactions, shot/finish timing, HUD and player selection |
| `src/nba2k9-player.js`, `src/nba2k9-motion.js` | Recovered player loading, pose sampling, transitions, feet and palms |
| `src/recovered-locomotion.js` | Authored walk/run recipes, stride phase sampling and speed blending |
| `src/nba2k9-roster.json` | Playable assemblies, scale/orientation and adapted motion segments |
| `src/ball.js`, `src/arena.js`, `src/audio.js` | Replaceable ball, arena and audio presentation |
| `scripts/build-nba2k9-assets.mjs` | Reproducible selected body/head/texture assembly and motion bundle |
| `scripts/validate-recovered-players.mjs` | Independent recovered geometry, skin, clip and roster validation |
| `public/assets/manifest.json` | Runtime inventory, hashes, source provenance and measured budgets |
| `src/player.js`, Luke rig/pose/mocap files | Historical Luke work, retained independently of the default player |

## Resume and validation

Run `npm ci`, then `npm run dev`. Before publishing, run asset checks, recovered
runtime tests, the existing rig/loading/motion/audio regression suites and the
production build. Inspect the built preview at desktop, narrow portrait and narrow
landscape sizes. Browser touch emulation does not establish physical-phone
performance or visual approval.

## Next milestone

Review the selected revision 4 player's silhouette and compound-pose deformation,
then establish suitable source clips and validated retargeting onto its own rest
basis before restoring moving review. Build the fresh clip-based controller and
gameplay integration in reviewed stages; require owner visual approval before
publishing the replacement to `main`. See `docs/CLAUDE_HANDOFF.md` for the current
state, constraints and validation limits. CPU 1v1 follows the player rebuild.
