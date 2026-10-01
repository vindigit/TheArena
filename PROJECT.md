# TheArena — project handoff

## Canonical locations

- **Repository:** `https://github.com/vindigit/TheArena`
- **Live demo:** `https://vindigit.github.io/TheArena/`
- **Local checkout:** `C:\\Users\\valexander\\Documents\\Codex\\2026-09-27\\codex-mcp-add-scenario-url-https\\TheArena`
- **Primary branch:** `main`

The Git repository is the source of truth. Work in this checkout, commit focused changes, and push to `main`; GitHub Pages publishes the production build.

## Current playable slice

### Luke character foundation (Part 1)

The ordinary game URL loads the supplied Luke unconditionally from `public/assets/models/player/luke-player-v1.glb`. The former `?player=luke` review selector is obsolete. Luke is the sole playable character during normal play and reset; a failed Luke load shows an explicit error and never substitutes a mannequin or previous character. His supplied appearance, uniform, texture and proportions are preserved byte-for-byte from the integrated Luke asset. This user-requested exception to the original fictional uniform direction does not establish new branding rights.

The exact 17-bone local rest frames, hierarchy, inverse bind matrices, axes and attachment conventions are pinned in [`docs/rig/luke-rig-contract.json`](docs/rig/luke-rig-contract.json). See [`docs/PLAYER_ASSET.md`](docs/PLAYER_ASSET.md) for maintenance and Part 2 handoff. Editable Blender source stays local and ignored under `art/source/player/`; only the canonical GLB is published. `npm run rig:check` checks the actual binary and the same strict contract used at runtime.

### Superseded hybrid dribble experiment

The old forward-dribble companion targeted a different rest pose and is removed from production assets and loading paths. `?animation=hybrid` cannot load that clip onto Luke. Luke uses the baseline procedural adapter while Luke-specific animation authoring remains Part 2. [`docs/HYBRID_DRIBBLE.md`](docs/HYBRID_DRIBBLE.md) and the historical validation/provenance remain an audit record; they are not current rig compatibility or animation approval. `scripts/retarget-dribble.py` now validates the Luke target only and exports no clips.

The initial release is a browser-based, third-person solo basketball demo with:

- One indoor arena, player, basketball, hoop, backboard, and net
- Keyboard/mouse and touch controls
- Dribbling, jump shots, layups, dunks, a two-minute run, and reset
- Procedural PS2-era visual treatment, validated runtime assets, sampled ball/hoop impacts with synthesized fallback, and a quiet guarded-loop arena bed

The court wood, basketball, and arena shell are accepted runtime assets. The basketball combines a Scenario-generated leather concept with an original local low-poly mesh; the shell and fictional venue atlas are locally authored. Three original local variants now back each basketball bounce, metal-rim impact, tempered-glass backboard hit, and hardwood shoe squeak, while one compact layered impact backs the authored dunk event. One quiet original indoor-arena ambience file loops behind an independent low-level gain path after game-start unlock. All live behind `AudioDirector` with synthesized gameplay fallback and failure-isolated ambience; the remaining one-shot audio cues are procedural placeholders. Luke's supplied branded uniform is the explicitly requested exception to fictional presentation. See [`docs/ASSET_PIPELINE.md`](docs/ASSET_PIPELINE.md) and `public/assets/manifest.json` for provenance, license scope, measurements, and validation limits.

## Project rules

- Keep the PS2/early-2000s console look: chunky silhouettes, readable textures, bold contrast, and focused post-processing.
- Preserve both desktop and touch playability whenever movement or controls change.
- Keep third-party/generated assets clearly licensed for a public browser demo before committing them.
- Prefer replacing a procedural asset behind its existing module boundary instead of mixing asset-loading logic into gameplay code.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Game loop, input, camera, ball interactions, shooting state, HUD |
| `src/ball.js` | Replaceable basketball GLB visual, procedural loading/error fallback, contact-shadow reference |
| `src/player.js` | Player model, animation readiness/state, stable dribble attachment points |
| `src/player-pose.js`, `src/luke-rig-contract.js` | Luke baseline procedural posing, explicit joint ownership and strict canonical rest/skin contract |
| `src/arena.js` | Court, arena, basket, net, lighting, collision references |
| `src/audio.js` | Sample-backed basketball bounces, rim/backboard/dunk impacts, and shoe squeaks with synthesized fallback; guarded-loop arena ambience on an independent gain path; synthesized swish and crowd/game feedback |
| `src/styles.css` | HUD, start screen, and responsive touch controls |
| `.github/workflows/pages.yml` | GitHub Pages build and deployment |

## Resume workflow

```powershell
cd C:\Users\valexander\Documents\Codex\2026-09-27\codex-mcp-add-scenario-url-https\TheArena
npm ci
npm run dev
```

Before committing gameplay or visual changes, run:

```powershell
npm run build
```

Then test desktop controls and a narrow touch viewport. A push to `main` triggers the Pages deployment; verify the live URL after the workflow finishes.

## Asset pipeline status and next milestone

The pipeline now has a style guide, budgets, a machine-readable manifest and schema, `npm run assets:check`, and a repeatable WebP optimization command. The first court wood material is integrated behind `src/arena.js` with procedural fallback. It has passed source/runtime seam checks, a production build with the GitHub Pages base path, and local desktop/touch checks.

Continue replacing the remaining placeholders in small passes:

1. Basketball replacement completed: centered 0.12 m radius, 352 triangles, one 256² color map, and a narrow renderer in `src/ball.js` with the original fallback. Desktop and emulated touch checks passed. A tested green-timed jumper missed identically in the original and replacement builds; physics remains unchanged. See the manifest for this existing limitation and detailed checks.
2. Arena shell replacement completed: an 85.7 KB GLB with 956 triangles, one 512² fictional venue atlas, and 240 instanced seats. The original procedural shell is the loading/error fallback. The court wood, hoop landmarks, lights, camera, and controls remain unchanged. Desktop and narrow portrait/landscape game views and a missing-model fallback were checked; physical-phone FPS remains unmeasured.
3. Add the remaining tiling materials and short gameplay-audio categories behind `src/arena.js` and `src/audio.js`, one category at a time.
4. Build a named hoop assembly, preserving the fixed gameplay landmarks and mutable net reference.
5. Part 1 establishes supplied Luke's canonical rig and baseline pose path. Part 2 may author or retarget Luke-compatible idle, movement, dribble, gather, pickup and finish clips against the pinned contract; do not reuse the superseded old-rig clip.

`main` remains the deployment branch. Verify each replacement before pushing; the current live build should remain on the last accepted asset set. The Scenario project used for the first texture is still named “Default Project”; renaming it to “TheArena” remains a workspace follow-up.
