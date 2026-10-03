# Player v2 (22-bone rig) — shelved

> Historical, not shipped. This is the abandoned 22-bone `game-humanoid-v2`
> rebuild. Nothing here is loaded, built, tested or validated by the current
> game, which runs Luke only on the 17-bone contract in
> [`docs/rig/luke-rig-contract.json`](../../docs/rig/luke-rig-contract.json).
> It is retained so the work can be audited or resumed.

## History

| Commit | Step |
| --- | --- |
| `08e36e5` | Step 1: 22-bone contract and validator in `src/player.js` |
| `d868481` | Step 2: Blender rebuild of both players, staged GLBs, proof renders |
| `f7a3dad` | Runtime integration: fictional v2 by default, Luke v2 via `?player=luke`; browser evidence; CI steps |
| `117e832` | Supplied kit fitted to Luke v2 (376,264-byte GLB, not archived here); default switched to Luke v2, fictional via `?player=fictional` |
| `d52b8ec` | Reverted `117e832`; tree identical to `f7a3dad` |
| `c613ad0` | Restored the pre-rig build (`3a4ecb5`); the v2 work was abandoned |

The first three commits were pushed together with `117e832`. GitHub Pages
deployed `117e832` and `d52b8ec` on 2026-10-02 (UTC) until `c613ad0` replaced
them, so three 22-bone GLBs were briefly public. Their publication windows,
hashes, measurements and license notes are recorded in
[`docs/rig/superseded-player-assets.json`](../../docs/rig/superseded-player-assets.json)
as `fictional-player-v2-rig22`, `luke-player-preview-rig22-kit` and
`luke-player-preview-rig22`.

## Layout

This folder mirrors the original repository paths. To resolve a path cited in
the archived documents, prefix it with `archive/player-v2/`. For example,
`docs/evidence/player-v2/` is now `archive/player-v2/docs/evidence/player-v2/`.
The files were moved unedited, so the hashes in
`docs/rig/player-v2-step2-provenance.json` still verify.

| Path | Contents |
| --- | --- |
| `docs/rig/PLAYER_V2_STEP2.md` | Step 2 write-up: deliverables, skin approach, validation table, deformation review |
| `docs/rig/player-rig-v2-contract.json` | 22-bone contract: required bones, budgets, `mixamorig:` normalization |
| `docs/rig/player-v2-step2-provenance.json` | Source/output hashes for the GLBs and the (untracked) `.blend` files |
| `docs/evidence/player-v2/*.png` | Blender deformation proofs of the final build (five poses per character) |
| `docs/evidence/player-v2-{fictional,luke}.png` | Local production-build captures of the v2 runtime |
| `scripts/build-player-v2-rig.py` | Blender builder: 17-bone GLB → 22-bone `.blend` + no-animation GLB |
| `scripts/render-player-v2-proof.py` | Blender renderer for the five proof poses |
| `art/staging/player/*.glb` | The two 22-bone outputs; byte-identical to the copies once placed in `public/` |

### Name collision

The ledger holds two files named `fictional-player-v2.glb`. Entry
`fictional-player-v2` is the accepted 17-bone Tripo asset (SHA-256 `af5fba26…`).
Entry `fictional-player-v2-rig22` is the 22-bone rebuild archived here
(SHA-256 `e7862c25…`). The 17-bone file is the builder's input; the 22-bone
file is its output.

## Removed instead of archived

These depended on v2 exports in `src/player.js`, such as `STAGED_PLAYER_RIG_CONTRACT`
and `validateStagedPlayerRigContract`, that the Luke-only runtime does not have.
They could not run, so they were deleted. Recover them with `git show <commit>:<path>`.

| Path | Added in |
| --- | --- |
| `tests/player-rig-v2-contract.test.mjs` | `08e36e5` |
| `tests/player-v2-runtime.test.mjs` | `f7a3dad` |
| `scripts/validate-player-v2-assets.mjs` | `d868481` |
| `scripts/check-player-v2-browser.mjs` | `f7a3dad` |
| `docs/rig/v2-evidence/*.png` | `d868481` (first-pass renders of the `d868481` build; superseded in `f7a3dad`) |
| `public/assets/models/player/{fictional-player-v2,luke-player-preview}.glb` | `f7a3dad` (removed in a separate change) |

## Resuming

- **Runtime.** The v2 loader, pose adapter and validator are in `src/player.js`,
  `src/player-pose.js` and `src/polished-pose.js` at `f7a3dad`. The CI steps it
  added are in `.github/workflows/pages.yml` at the same commit.
- **Luke input still matches.** The builder's 17-bone source names match the
  current Luke contract. The source hash in the provenance file (`9eedd88b…`)
  equals today's `public/assets/models/player/luke-player-v1.glb`.
- **Editable sources are gone.** The `.blend` outputs were never tracked and
  are absent from the local `art/source/player/`. Re-running the builder
  recreates them, including the `RigProofPoses` action that the proof renderer
  requires. The fictional player's input is the 17-bone GLB at `ae16694`.
- **Open gates when shelved:** Luke's uniform replacement; re-verification of the
  fictional player's input rights before shipping; physical-phone comparison.
