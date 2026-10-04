# TheArena — project handoff

## Canonical locations

- Repository: https://github.com/vindigit/TheArena
- Live game: https://vindigit.github.io/TheArena/
- Primary deployment branch: `main`
- This repository is the source of truth. Keep changes focused and preserve unrelated local work.

## Product direction

The goal is browser basketball with single-player and online 1v1, 2v2 and 3v3.
The current release remains a two-minute solo run. Player and animation migration
comes first; complete CPU 1v1 is the next gameplay milestone. Team modes and online
play are not implemented by this migration.

## Current player foundation

The ordinary URL loads a complete recovered NBA 2K9 player assembly. The start
screen offers Classic 01 and Classic 02; `?character=classic-two` selects the second
player directly. Both combine selected athletic body, head and original textures,
with 33 shared joints: the canonical 26-joint animation family and seven additional
body/clothing joints. Models are normalized to 2 m height and face the game's -Z
forward axis. Names are project labels, not verified real-player identities.

`src/nba2k9-player.js` loads the registry and compatible motion bundle behind the
stable gameplay root and attachment API. `src/nba2k9-motion.js` samples recovered
rotations, adapts them to gameplay clocks, blends transitions, grounds feet and
solves attached-ball contacts. The four recovered motions supply selected pose
segments; their original action meanings and exact original-game fidelity remain
unverified. In-place motion does not own gameplay translation, facing, jump,
possession, shot grades or free-ball physics. Loading failure blocks play explicitly.

See `docs/RECOVERED_PLAYER.md` for source selections, regeneration, validation and
known limits. The owner requested public integration and removal of the previous
rights-clearance prerequisite. Source hashes and provenance remain accurate;
unavailable license information is recorded as unknown, not as a grant.

Luke's binary, rig contract, old pose modules and associated tests remain historical
maintenance work. They are not the default character path. Unfinished local Luke
changes must not be overwritten by the migration.

The abandoned 22-bone `game-humanoid-v2` rebuild (`08e36e5`–`d52b8ec`, withdrawn by
`c613ad0`) is archived under [`archive/player-v2/`](archive/player-v2/README.md).
Nothing there is loaded, built or tested.

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

Build complete CPU 1v1: opponent, defense, contested shots, rebounds, turnovers,
possession rules, match winner and immediate rematch. Keep player-system refinements
focused on those interactions. Do not resume an unrelated placeholder-art checklist
as the project's primary direction.
