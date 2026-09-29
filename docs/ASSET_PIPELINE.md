# TheArena asset pipeline

This pipeline replaces original procedural presentation assets one category at a time. Keep the current geometry and synthesized audio available as fallbacks until each replacement passes the checks below. Gameplay timing, collision values, camera, desktop controls, and touch controls remain owned by the existing code.

## Visual target

- **Era:** an original early-2000s console basketball game. Use low-poly forms, broad shoulders and shoes, a readable ball and hoop, and a compact arena silhouette.
- **Surface detail:** 256–512 px color textures, broad painted color regions, subtle grain and wear, and baked-looking ambient shading. Preserve crisp court lines and ball seams at gameplay distance.
- **Lighting:** warm pools on the court against cool, dark seating. Keep strong light/dark separation and restrained specular highlights. Check textures under the current arena lights, fog, tone mapping, and low-resolution shadows.
- **Palette:** parquet amber, worn orange leather, cream markings, muted purple paint and seating, charcoal concrete and metal. Reuse a small set of material colors across categories.
- **Identity:** fictional uniform and venue graphics only. Use original references with documented rights; no league marks, real teams, real-player likenesses, or borrowed audio.
- **Presentation check:** inspect the camera view at desktop and narrow touch sizes. A close-up render alone cannot prove that the object reads during play.

## Existing replacement contracts

Three.js units are meters; Y is up, X is court width, and the basket is at negative Z. These values are gameplay contracts, even when a mesh looks different.

| Asset | Current owner and replacement seam | Values and references to preserve |
| --- | --- | --- |
| Player | `src/player.js` returns `group`, `update(dt, state)`, `rightHand`, `leftHand`, `chest`, `head`, and hand world-position helpers. | Root at the floor; action states include idle, move, shoot, layup, and dunk. Hand anchors must remain correct throughout each action. A rigged GLB needs a pose adapter inside this module. |
| Basketball | `createBasketball()` in `src/ball.js` loads the accepted GLB and retains the original procedural fallback; `src/main.js` owns ball movement, rotation, scoring, and collision. | Visual radius **0.12 m**, origin at ball center, and `group.userData.shadow` for the contact shadow. The root and shadow survive asynchronous visual replacement. |
| Court and arena | `src/arena.js` returns `{ group, hoop, court }`; visual geometry can change inside this module. | Court **15.2 × 14 m**, floor Y **0**, bounds X **±7.6**, Z **−7 to 7**. Retain the court data and current lighting/gameplay references. |
| Hoop assembly | `src/arena.js` owns hoop visuals and exported coordinate data. | Rim center **(0, 3.05, −5.82)**, radius **0.23 m**; backboard center **(0, 3.56, −6.25)**, **1.83 × 1.07 m**. `hoop.net` is animated through `userData.energy`, rotation, and scale. Keep collision data independent of decorative mesh topology. |
| Materials | Court planks, painted key/lines, concrete shell, painted metal, and seating are currently colored procedural meshes in `src/arena.js`. | Replace material assignments or selected presentation meshes behind `createArena`; preserve world dimensions and line visibility. |
| Audio | `src/audio.js` exposes `AudioDirector` and its `unlock`, `bounce`, `rim`, `backboard`, `swish`, `shoe`, `crowd`, `score`, volume, enabled, and dispose methods. | Preserve gesture unlock, intensity inputs, cooldown behavior, and synthesized fallback. Add a `dunk` cue inside this module when that sample set is accepted. |

## Runtime layout

Use stable, lowercase names and versioned filenames when content changes. Vite serves files in `public/` at the configured site base path; build URLs with Vite's base URL so GitHub Pages' `/TheArena/` prefix works.

```text
public/assets/
  manifest.json                    # accepted runtime inventory and provenance
  manifest.schema.json             # manifest validation contract
  models/
    ball/basketball-v1.glb
    player/fictional-player-v1.glb
    hoop/hoop-assembly-v1.glb
    arena/arena-detail-v1.glb
  textures/
    court/wood-v1.webp
    concrete/concrete-v1.webp
    metal/painted-metal-v1.webp
    fabric/fabric-v1.webp
    seating/seating-v1.webp
  audio/
    gameplay/dribble-01.mp3
    gameplay/rim-01.mp3
    gameplay/backboard-01.mp3
    gameplay/swish-01.mp3
    gameplay/shoe-01.mp3
    gameplay/dunk-01.mp3
    ambience/arena-loop-01.mp3
```

These paths describe slots, not a requirement to fill them all at once. Keep generation intermediates, source scans, project files, and rejected outputs outside `public/assets/` and outside commits. Use GLB for meshes, WebP or optimized PNG for color and alpha textures, and compressed MP3 or OGG for audio. Use KTX2 only after confirming a transcoder and fallback path on target browsers. For tiling maps, preserve UV repeat and texture color space; color maps use sRGB and data maps use linear color space.

## Manifest contract

`public/assets/manifest.json` is the accepted-asset ledger. One record describes one logical replacement, even if it has several runtime files. `manifest.schema.json` validates the structure. Keep paths relative to `public/` so every file can be checked during a build. A representative record shape is:

```json
{
  "version": 1,
  "assets": [
    {
      "id": "court-wood-v1",
      "category": "texture",
      "status": "accepted",
      "source": {
        "type": "scenario",
        "prompt": "Exact generation prompt",
        "modelId": "catalog model ID",
        "modelVersion": "version or null",
        "settings": { "width": 512, "height": 512 },
        "seed": 1234,
        "scenarioAssetId": "asset ID or null",
        "scenarioJobId": "job ID or null",
        "generatedAt": "2026-09-29T00:00:00Z"
      },
      "license": {
        "name": "license or service grant",
        "url": "https://example.invalid/terms",
        "commercialUse": false,
        "attribution": "required credit or null",
        "evidence": "terms version, receipt, or rights note"
      },
      "runtime": [
        {
          "path": "assets/textures/court/wood-v1.webp",
          "format": "webp",
          "bytes": 0,
          "sha256": "64 lowercase hexadecimal characters",
          "dimensions": { "width": 512, "height": 512 }
        }
      ],
      "validation": {
        "checks": { "seam": "pass", "gameView": "pass", "mobile": "pass" },
        "measured": { "edgeError": 0, "downloadBytes": 0 },
        "notes": "What was inspected and any remaining limits"
      },
      "integration": {
        "module": "src/arena.js",
        "fallback": "procedural board materials"
      }
    }
  ]
}
```

Use `null` for unavailable generation fields on locally authored assets. A sample URL or Scenario dashboard link is useful provenance but does not replace a committed runtime path or a rights record. Record the exact prompt, negative prompt if present, model and version, seed, all material settings, source/reference asset IDs, generation job ID, optimization steps, and output notes. Update measured values from the shipped file, not the generator preview.

`npm run assets:check` validates the schema, normalized paths, file signatures, bytes, hashes, image dimensions, and declared tiling thresholds. Use `npm run assets:check -- --seam <repo-local PNG-or-WebP>` while evaluating source and optimized textures. A `pass` in the manifest represents a completed manual check; the command cannot determine whether a license covers a particular release.

## First accepted slice: court wood

- [Scenario source](https://app.scenario.com/assets?openAssetId=asset_YxkmLkYFT9wktoHxXn1jXpUf&teamId=team_yNLWgjS1fAtTk5MtpGfW7vRy&projectId=proj_A12xiMpm5rjCs8EuszXCaqPh): Scenario Texture, 512², medium quality, seam erasing on, 64 px overlap and 32 px feather. The exact prompt, job ID, and asset ID are in `public/assets/manifest.json`; this model did not expose a seed or version.
- Export the source PNG to an ignored `.tmp/` directory. Reproduce the runtime WebP with `npm run assets:optimize:texture -- .tmp/court-wood-source.png .tmp/court-wood-candidate.webp 76`. Compare candidate bytes, seam metrics, and 2×2 tiling before placing the accepted file in `public/assets/textures/court/wood-v1.webp`. The shipped file is **8,868 bytes** at 512²; a repeat encode produced the same SHA-256.
- The WebP's left/right and top/bottom mean edge differences are **3.66** and **2.64** RGB levels, below the recorded threshold of 5. A 2×2 tile proof and desktop/touch game views were inspected. `src/arena.js` loads the one shared texture on the existing 16 planks and keeps their color materials until the file loads or if loading fails. Court geometry, lines, lighting, collision data, and controls did not change.
- [Scenario pricing](https://www.scenario.com/pricing) describes Free plan outputs as personal/evaluation use. The manifest records `commercialUse: false` for this noncommercial evaluation demo. [Scenario's terms](https://www.scenario.com/terms-and-conditions) assign rights in generated outputs but leave use review to the user. Recheck the license before a commercial release; the project rename from “Default Project” to “TheArena” is also pending.

## Generation order and ceilings

Budgets are acceptance targets for the **optimized runtime files**. They are ceilings rather than instructions to add detail until a limit is reached. Maintain a target of **under 3 MB total added runtime assets** for the full first pass; load audio after the game starts and keep optional ambience deferred.

| Priority | Asset and generation approach | Runtime target |
| --- | --- | --- |
| 1 | One seamless parquet court material as the first vertical slice. Use `scenario-game-assets`, then `scenario-textures` for a tiling generator. Keep procedural lines and paint. | 512² WebP color map, **≤80 KB**. |
| 2 | Basketball: generate a clean, single-object concept, use `scenario-3d` for a mesh, then retopology/UV and texture cleanup. Keep the local center pivot and procedural contact shadow. | **≤600 triangles**, one material, 256² color map, GLB **≤80 KB**. |
| 3 | Concrete, painted metal, fabric, and seating materials. Use the same palette and seam test as the court; share materials across meshes. | 256² per map, **≤50 KB each**; five tiling maps combined **≤280 KB**. |
| 4 | Gameplay sounds: short dry variants of dribble, rim, board, swish, shoe, and dunk, then a quiet arena loop. `scenario-audio` only if generation is needed. | Mono 22–32 kHz MP3/OGG, **≤40 KB** per short cue; total gameplay set **≤600 KB**, ambience **≤250 KB**. |
| 5 | Hoop, rim, backboard, net, and support, built as a named assembly. Preserve the measured collision landmarks and a separable animated net. | **≤2,000 triangles**, 256–512² atlas, GLB **≤180 KB**. |
| 6 | Arena shell and seating detail. Reuse instancing and the existing crowd strategy; keep the visible layout and lights. | Added unique geometry **≤10,000 triangles**, one 512² atlas where useful, GLB **≤500 KB**. |
| 7 | Generic fictional player. Generate the approved design, make a game-ready mesh, rig separately, then adapt current procedural action states to the skeleton. | **≤6,000 triangles**, ≤2 × 512² atlases, GLB **≤800 KB** including rig; no unnecessary baked clips. |

For Scenario work, discover a suitable catalog model for each asset at run time, inspect its schema, price the exact request with a dry run, then generate. Review the Scenario result before export. Record the actual model, settings, seed, job ID, asset ID, and licensing evidence in the manifest. A generated low-poly appearance does not prove a low-poly mesh; count triangles after export.

## Acceptance gate for each replacement

1. **Provenance:** source files and reference rights are known; the model/service output grant permits a public browser game; the manifest records the license and exact recipe. Reject branding and likeness drift.
2. **Mesh:** inspect GLB node transforms, dimensions, triangle count, material count, normals, UVs, winding, and pivot. Verify Y-up, meter scale, and no unexpected negative scale. Confirm the ball center, player floor origin and hand anchors, and hoop landmarks against the contracts above.
3. **Texture:** inspect source and encoded size; check sRGB/linear assignment, alpha fringes, compression artifacts, and a 2×2 tiled preview. Compare opposite edges numerically and visually under arena lighting. Check repeated surfaces at the camera's normal distance.
4. **Rig:** inspect skeleton weights, bone axes, bind pose, and deformation. Exercise idle, movement, shoot, layup, and dunk through `player.update`; compare hand/chest/head world positions with the current implementation and verify ball attachment and release.
5. **Sound:** normalize levels, remove clipped samples and excess silence, verify loop joins, and test rapid cue calls with the current cooldowns. Test unlock and playback on desktop and a touch browser; confirm a missing file falls back to synthesized sound.
6. **Integration:** load only the approved file behind its module boundary, keep the procedural fallback, and retain gameplay dimensions. Run `npm run build`; test a complete desktop run and a narrow touch layout, including dribble, shot, finish, score, and reset. Inspect Network and console for missing paths or decode errors.
7. **Release:** record actual bytes, hash, measurements, and test results in the manifest. Keep `main` and the live Pages build on the last accepted assets until the replacement passes every applicable check; then commit only optimized runtime files and focused integration changes.
