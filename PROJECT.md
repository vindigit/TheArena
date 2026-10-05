# TheArena — rebuild v2

Browser basketball in a PS2/early-2000s style (Three.js + Vite). This branch,
`rebuild/v2`, restarts the whole game from an empty tree. `main` and the live
site (https://vindigit.github.io/TheArena/) keep the previous version until the
owner approves this rebuild; the old code remains in `main` and Git history.

## Inputs (never edit)

- `art/input/selected-player-source.glb` — owner-supplied athlete, SHA-256
  `26d97a1a…6041ada9`, checked by `tests/inputs.test.mjs`.
- Recovered 2K motion clips — selected in Stage 2 from the audited library on
  `codex/claude-player-development`; only chosen clips are copied in.

## Stages and review gates

0. Skeleton project — done.
1. Re-rig the supplied athlete (standard humanoid, plain linear skinning) and
   show compound poses on a dev page. Gate: owner approves silhouette/poses.
2. Clip browser, owner-tagged clip selection, retarget onto the new rig.
   Gate: owner approves each clip on the player.
3. Minimal game: court, hoop, ball, movement, dribble, jump shot, scoring.
   Gate: desktop and touch playtest footage.
4. Layup, dunk, sprint, reset, timer, audio. Gate: release candidate approval.
5. Merge to `main` and restore the Pages deploy workflow — owner approval only.

## Rules

- `src/main.js` owns gameplay; the player module renders/animates behind
  `load`, `update(dt, state)`, `reset`, `getHandAttachment`.
- ~2 m player, ≤20,000 triangles, plain linear skinning.
- Run `npm test` and `npm run build` for every change; verify desktop and touch
  when controls change, and report emulation separately from physical devices.
