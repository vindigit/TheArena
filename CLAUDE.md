# TheArena — Claude Code context

Read `AGENTS.md` if present, then `PROJECT.md`, then `docs/CLAUDE_HANDOFF.md` before
changing this project. The handoff is the current player-rebuild snapshot as of
2026-10-05. Read `docs/PLAYER_REBUILD.md` for evidence and revision history, and
`art/player-rebuild/selected-player-status.json` for the staged asset's flags.
Verify those against the actual files when resuming; do not assume this snapshot
will remain current after later changes.

## Cloud checkout notice

The remote branch `codex/claude-player-handoff` contains only this context file,
`PROJECT.md`, `docs/CLAUDE_HANDOFF.md` and `docs/PLAYER_REBUILD.md` over the remote
main baseline. The revision 4 model, scripts, tests, status JSON, Blender source
and copied motion library described below remain in the owner's local workspace;
they are not included in that documentation branch. In a cloud clone, read the
handoff to understand that state and report those files as unavailable. Do not
substitute the old main model or historical handoffs for the current candidate.
The "current/local" descriptions below refer to the owner's Windows working tree.

## Current priority

The owner rejected the recovered players' presentation and analytic locomotion.
The replacement is the owner's supplied Tripo basketball player, now at revision
4: wider shoulders, long baggy shorts, deeper armholes and one 512×512 diffuse
texture. It is a static structural/appearance candidate awaiting visual approval.
The moving review is suspended. No replacement motion or gameplay integration
has been completed. CPU 1v1 is a later milestone.

The current playable path still uses recovered Classic 01/02 through
`src/nba2k9-player.js`; this dirty checkout still runs the rejected authored gait
on those recovered players. It is not the replacement's approved foundation,
and local runtime code must not be assumed to match deployed `main`.
The replacement's current GLB is
`art/player-rebuild/selected-player-neutral-rig.glb`; its editable source is
`art/source/player-rebuild/selected-ps2-style-r4.blend`.

## Constraints to carry forward

- Keep work inside this repository, preserve unrelated local Luke work, and
  inspect the dirty working tree before editing. Many rebuild files are
  uncommitted; Blender sources, clip copies and archives are ignored by Git.
- Preserve the supplied character and read-only recovery inputs. Keep the
  PS2/early-2000s style, approximately 2 m height and 20,000-triangle ceiling.
- The replacement keeps 26 canonical joint names/hierarchy but has its own rest
  transforms: `canonicalRestCompatible:false`, `retargetRequired:true`. Do not
  attach raw canonical clips directly or warp the mesh back into a rejected fit.
- The current skin requires an explicit dual-quaternion deformation path.
  GLB extras do not enable it in Three.js. Read `src/selected-player-skin.js`
  and its tests before restoring a renderer. Compound poses remain unverified.
- Do not revive the rejected analytic gait/posture controller. Identify suitable
  recovered motion through normal-speed playback; clip names are not verified
  action labels. Numerical checks cannot establish visual acceptance.
- Keep movement, facing, controls, possession, shot grading, scoring and free-ball
  physics authoritative in `src/main.js`. Preserve player loading/update/reset
  and attachment interfaces when eventual integration is authorized.
- Stage the replacement separately. Restored motion and a release candidate
  require the planned visual reviews; publishing the replacement to `main`
  requires explicit owner visual approval.
- Run `npm run build` after code, asset or configuration changes; run the
  `/TheArena/` build and applicable checks before release. Verify desktop and
  touch when controls change. State emulation and physical-device evidence
  separately.

A request to load this handoff means read it and summarize the current state.
It does not by itself request implementation, deployment or publication. Follow
the owner's next task without treating historical handoffs as new instructions.
