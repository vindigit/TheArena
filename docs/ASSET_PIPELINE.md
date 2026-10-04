# TheArena asset pipeline

This pipeline replaces presentation assets behind their module boundaries. The default player system now uses recovered NBA 2K9 assemblies and motions; see `RECOVERED_PLAYER.md`. Player loading fails explicitly rather than substituting a different character. Luke source and tests are retained as historical work. Gameplay timing, collision values, camera, desktop controls, and touch controls remain owned by the existing code.

## Visual target

- **Era:** an original early-2000s console basketball game. Use low-poly forms, broad shoulders and shoes, a readable ball and hoop, and a compact arena silhouette.
- **Surface detail:** 256–512 px color textures, broad painted color regions, subtle grain and wear, and baked-looking ambient shading. Preserve crisp court lines and ball seams at gameplay distance.
- **Lighting:** warm pools on the court against cool, dark seating. Keep strong light/dark separation and restrained specular highlights. Check textures under the current arena lights, fog, tone mapping, and low-resolution shadows.
- **Palette:** parquet amber, worn orange leather, cream markings, muted purple paint and seating, charcoal concrete and metal. Reuse a small set of material colors across categories.
- **Identity:** the owner has selected the recovered NBA 2K9 models and animations for the public player migration. Keep source identifiers and hashes in the manifest; source filenames alone do not prove player identity. Existing arena assets keep their accepted appearance.
- **Presentation check:** inspect the camera view at desktop and narrow touch sizes. A close-up render alone cannot prove that the object reads during play.

## Existing replacement contracts

Three.js units are meters; Y is up, X is court width, and the basket is at negative Z. These values are gameplay contracts, even when a mesh looks different.

| Asset | Current owner and replacement seam | Values and references to preserve |
| --- | --- | --- |
| Player | `src/nba2k9-player.js` returns `group`, `update(dt, state)`, `rightHand`, `leftHand`, `chest`, `head`, and hand world-position helpers. | Root at the floor; action states include idle, move, shoot, layup, and dunk. The recovered pose adapter handles source skeletons and contact; `src/player.js` retains historical Luke work. |
| Basketball | `createBasketball()` in `src/ball.js` loads the accepted GLB and retains the original procedural fallback; `src/main.js` owns ball movement, rotation, scoring, and collision. | Visual radius **0.12 m**, origin at ball center, and `group.userData.shadow` for the contact shadow. The root and shadow survive asynchronous visual replacement. |
| Court and arena | `src/arena.js` returns `{ group, hoop, court }`; visual geometry can change inside this module. | Court **15.2 × 14 m**, floor Y **0**, bounds X **±7.6**, Z **−7 to 7**. Retain the court data and current lighting/gameplay references. |
| Hoop assembly | `src/arena.js` owns hoop visuals and exported coordinate data. | Rim center **(0, 3.05, −5.82)**, radius **0.23 m**; backboard center **(0, 3.56, −6.25)**, **1.83 × 1.07 m**. `hoop.net` is animated through `userData.energy`, rotation, and scale. Keep collision data independent of decorative mesh topology. |
| Materials | Court planks, painted key/lines, concrete shell, painted metal, and seating are currently colored procedural meshes in `src/arena.js`. | Replace material assignments or selected presentation meshes behind `createArena`; preserve world dimensions and line visibility. |
| Audio | `src/audio.js` exposes `AudioDirector` and its `unlock`, `bounce`, `rim`, `dunk`, `backboard`, `swish`, `shoe`, `crowd`, `score`, master/ambience volume, enabled, and dispose methods. | Preserve gesture unlock, intensity inputs, cooldown behavior, and synthesized gameplay fallback. Sample and ambience loading begins only after `unlock()` runs from game start. |

## Runtime layout

Use stable, lowercase names and versioned filenames when content changes. Vite serves files in `public/` at the configured site base path; build URLs with Vite's base URL so GitHub Pages' `/TheArena/` prefix works.

```text
public/assets/
  manifest.json                    # accepted runtime inventory and provenance
  manifest.schema.json             # manifest validation contract
  models/
    ball/basketball-v1.glb
    player/luke-player-v1.glb
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
    gameplay/dunk-impact-01.ogg
    ambience/arena-loop-01.ogg
```

These paths describe slots, not a requirement to fill them all at once. Keep generation intermediates, source scans, project files, and rejected outputs outside `public/assets/` and outside commits. Use GLB for meshes, WebP or optimized PNG for color and alpha textures, and compressed MP3 or OGG for audio. Use KTX2 only after confirming a transcoder and fallback path on target browsers. For tiling maps, preserve UV repeat and texture color space; color maps use sRGB and data maps use linear color space.

Luke's maintained editable source is local, ignored `art/source/player/luke-player-v1.blend`, with tracked hashes and export provenance in `art/source/player/README.md` and `docs/rig/luke-source-provenance.json`. `docs/rig/luke-rig-contract.json` is the exact rig target, and `src/luke-rig-contract.js` checks it before runtime posing. The production player asset directory must contain only Luke's GLB. Historical character/CMU provenance is quarantined in `docs/rig/superseded-player-assets.json` and Git history; the former binaries and generator are removed. `scripts/retarget-dribble.py` validates Luke's target and exports no animation in Part 1.

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

## Accepted arena shell

- `scripts/build-arena-shell.mjs` deterministically authors the original meter-scale GLB and one 512² fictional venue atlas. The runtime files are `public/assets/models/arena/arena-shell-v1.glb` and `public/assets/textures/arena/atlas-v1.png`. The five supplied screenshots were broad era/style references; no pixels, real marks, or copied signs were used.
- The GLB has 956 triangles, 20 batched meshes, 10 shared materials, an origin pivot, Y up, and no node transforms. One 24-triangle seat mesh is drawn in 240 instances. Open risers, inward wall faces, and an exposed lattice avoid full buried bleacher blocks. The separate spotlights, gameplay court, hoop assembly, player, camera, controls, and audio keep their existing contracts.
- `src/arena.js` displays the original procedural shell while loading and on any GLB load/validation failure; after a valid load, it removes and disposes the fallback geometry. The decoded board mesh restores the exact name consumed by the existing emissive presentation pulse.
- The manifest records the exact recipe, original-art rights, optimized bytes and hashes, scale, bounds, geometry checks, viewport inspections, and fallback test. Narrow portrait and landscape views were inspected in a fine-pointer browser viewport; physical touch-device FPS has not been measured.

## Accepted basketball bounce set

- `scripts/build-bounce-audio.mjs` deterministically authors three original, single-impact hardwood basketball bounces. Each is mono 32 kHz Ogg Vorbis, 0.217–0.237 seconds after decode, and about 4.3 KB. No recorded source, voice, crowd, music, branding, or broadcast audio is used.
- Scenario's live audio recommendations were checked first. Sonilo V1.1 Text to SFX required Pro, MM Audio 2 required Starter, and a no-charge ElevenLabs Sound Effects 2 dry run required cu-basic; the current Free-plan project had no owned suitable take, so no Scenario job was launched and the manifest records null job and asset IDs plus the exact local recipe.
- `AudioDirector.unlock()` starts the three fetch/decode operations only after the game start gesture. `bounce(intensity)` rotates through decoded buffers, maps intensity to gain and playback rate, and retains the original 72 ms cooldown. While loading, or when all requests or decodes fail, it uses the unchanged synthesized bounce.
- Native-rate Chromium measurements show 0–0.031 ms leading silence, −18.53 to −18.23 dBFS RMS, and peaks at or below −3.37 dBFS. Desktop keyboard/mouse and a 390 × 844 forced-coarse-pointer touch harness exercised start/unlock, standing and moving dribbles, an early-shot floor impact, finish, and reset. The touch pass is emulation rather than a physical-phone audio test.

## Accepted basketball rim-impact set

- `scripts/build-rim-audio.mjs` deterministically authors light, medium, and hard dry metal-rim hits from one modal family. The mono 32 kHz Ogg Vorbis files decode to 0.217–0.327 seconds and 4.2–4.4 KB, with a sharp noise attack, paired inharmonic metal modes, restrained ball contact, and no recorded source, backboard, voice, crowd, music, ambience, or reverb.
- The `scenario-game-assets` workflow routed the audio category to `scenario-audio`. The existing Scenario Free-plan project had no owned matching audio; live recommendations returned ElevenLabs Sound Effects 2 and MM Audio 2 behind Starter and Sonilo V1.1 behind Pro, so no inaccessible generation or dry-run job was launched. The manifest records the exact assessment and null Scenario job/asset IDs.
- `AudioDirector.unlock()` starts the three additional fetch/decode operations only after the same game-start gesture. `rim(intensity)` chooses light below 0.4, medium below 0.75, and hard at or above 0.75, then preserves continuous intensity response through gain and a narrow playback-rate range. The existing 95 ms cooldown and complete original synthesized rim fallback remain unchanged; partial loads use the nearest decoded strength.
- Chromium measurements show 0 ms leading silence, −20.10 to −19.96 dBFS RMS, peaks at or below −2.01 dBFS, and zero clipped samples. A browser runtime harness exercised ordinary, hard, dunk-strength, and rapid repeated calls; desktop and a 390 × 844 forced-coarse-pointer touch harness both reached a running audio context with all three samples decoded. The touch pass is emulation rather than a physical-phone test.

## Accepted basketball backboard-impact set

- `scripts/build-backboard-audio.mjs` deterministically authors soft, medium, and hard tempered-glass backboard contacts from one compact panel family. The mono 32 kHz Ogg Vorbis files decode to 0.162–0.237 seconds and about 4.3 KB, combining a flat low-mid body, brief high-frequency glass/hardware rattle, and one restrained 15 ms indoor reflection. No recorded source, rim ring, crowd, speech, music, branding, or broadcast ambience is used.
- The `scenario-game-assets` workflow again routed the audio category to `scenario-audio`. The current Free-plan project had no owned matching audio; live recommendations returned ElevenLabs Sound Effects 2 and MM Audio 2 behind Starter and Sonilo V1.1 behind Pro, so no inaccessible generation or dry-run job was launched. The manifest records this assessment and null Scenario job/asset IDs.
- `AudioDirector.unlock()` starts these three fetch/decode operations only after the same game-start gesture. `backboard(intensity)` selects soft below 0.45, medium below 0.78, and hard at or above 0.78, with continuous gain and narrow playback-rate response. The existing 110 ms cooldown and complete original synthesized backboard fallback remain unchanged; partial loads use the nearest decoded strength.
- Chromium measurements show 0 ms leading silence, −20.84 to −20.75 dBFS RMS, peaks at or below −1.11 dBFS, and zero clipped samples. A runtime harness exercised soft, hard, and immediate repeated calls. Desktop game start and a 390 × 844 forced-coarse-pointer touch start both unlocked successfully with all three backboard samples decoded; the touch pass is emulation rather than a physical-phone test.

## Accepted basketball shoe-squeak set

- `scripts/build-shoe-audio.mjs` deterministically authors two compact rubber chirps and one brief lateral skid on polished hardwood. The mono 32 kHz Ogg Vorbis files decode to 0.117–0.197 seconds and 4.4–4.8 KB. Seeded chirps and 6.2 kHz-low-passed friction noise keep the attack readable without harsh phone-speaker fizz; no recorded source, footsteps, speech, whistles, crowd, music, ambience, or reverb is used.
- The `scenario-game-assets` workflow routed the category to `scenario-audio`. The current Scenario Free-plan project had no matching owned audio; live recommendations returned ElevenLabs Sound Effects 2 and MM Audio 2 behind Starter and Sonilo V1.1 behind Pro, so no inaccessible generation or dry-run job was launched. The manifest records the assessment and null Scenario job/asset IDs.
- `AudioDirector.unlock()` starts the three fetch/decode operations only after the game-start gesture. `shoe(intensity)` rotates chirp/chirp/skid variants and preserves continuous gain and playback-rate response. The original 58 ms cue cooldown remains configured, while an additional 170–235 ms movement cadence guard prevents frame-driven machine-gun repetition. Loading and complete request/decode failure use the original synthesized shoe cue.
- Chromium measurements show 0 ms leading silence, −22.33 to −21.63 dBFS RMS, peaks at or below −9.67 dBFS, and zero clipped samples. A 260–6800 Hz offline phone-speaker render remained unclipped with peaks at or below −14.36 dBFS. Desktop start plus walking, sprinting, and alternating direction inputs were exercised. A 390 × 844 browser pass exercised start/unlock and the same three runtime calls; this is touch-sized and phone-band emulation, not a physical-device speaker or touch-hardware test.

## Accepted basketball dunk-impact cue

- `scripts/build-dunk-audio.mjs` deterministically authors one dry, layered finish hit from a ball-compression thump, paired inharmonic rim-flex modes, a short band-limited net snap, five compact knot ticks, and low support vibration. The original mono 32 kHz Ogg Vorbis cue is 4.8 KB and decodes to 0.452 seconds. It contains no recorded source, crowd, speech, music, horn, whistle, branding, broadcast effect, backboard strike, or long room tail.
- The `scenario-game-assets` workflow routed the category to `scenario-audio`. The only Scenario project had no matching owned audio. Current recommendations returned ElevenLabs Sound Effects 2 and MM Audio 2 behind Starter and Sonilo V1.1 behind Pro, so the Free-plan workspace could not run any appropriate model; no job was launched and the manifest records the exact prompt, recommendation result, and null Scenario asset/job IDs.
- `AudioDirector.unlock()` starts the single fetch/decode only after `unlockAndStart()` has set `game.started`. `dunk(intensity)` uses the shared enable, master-volume, compressor, and cooldown architecture; intensity controls gain and a narrow playback-rate range. A 420 ms cue cooldown rejects duplicate finish callbacks, and loading, request, or decode failure uses a complete layered synthesized fallback.
- The established `releaseFinish()` dunk branch still supplies the same 0.42-second launch, release threshold, net energy, and `rim(0.92)` call; it now adds exactly one `dunk(1)` call. The score path remains `score(1)` for a dunk. Native Chromium decode measured −19.93 dBFS RMS, −1.02 dBFS peak, zero clipped samples, and zero leading/trailing samples below −60 dBFS. Desktop 1280 × 720 and 390 × 844 touch-sized browser starts both reached a running context and decoded the cue; the latter is responsive-browser emulation, not physical touch hardware.

## Accepted indoor arena ambience loop

- `scripts/build-arena-ambience.mjs` deterministically authors one restrained indoor bed from a circularly filtered crowd-like texture, low HVAC air and 60/120 Hz room modes, plus three soft movement swells. It uses only seeded mathematical noise and oscillators—no recording, intelligible speech, music, chant, whistle, announcement, buzzer, team name, brand, or broadcast source. The mono 32 kHz Ogg Vorbis file is 38,860 bytes.
- The `scenario-game-assets` workflow routed the category to `scenario-audio`. The only project had no matching owned audio. Sonilo V1.1 Text to SFX was the correct recommendation but required Pro; the only ranked Free-plan option was a music model and was rejected because music is explicitly excluded. No Scenario generation or job was created, and the manifest records the team/project/model IDs and exact outcome.
- The encoded buffer includes 250 ms guards around an exact 8-second periodic cycle. `AudioDirector` loops the decoded interior from 0.25 to 8.25 seconds, keeping the runtime seam away from Vorbis edge windows. Chromium measured a −53.17 dBFS join (17.16 dB below its 99.9th-percentile ordinary sample step), a 0.407 dB first/last 250 ms level difference, −28.56 dBFS decoded RMS, −16.13 dBFS peak, and zero clipped samples.
- The ambience request starts only inside the existing gesture-driven `unlock()` call after game start. Its 0.22 gain path bypasses the gameplay compressor and feeds the master independently, putting the estimated post-gain bed near −49.25 dBFS while leaving every sampled and synthesized court cue unchanged. Missing/decode failure is silent, suspend/resume retains one loop source, and disposal stops/disconnects the source and clears its buffer. Desktop start and the shared touch-compatible click path were checked; a physical-phone speaker and touch-hardware listening pass remains recommended.
- Rebuild the deterministic file with `npm run assets:build:ambience`, run its loading/lifecycle/fallback coverage with `npm run test:audio`, and use `npm run dev` to listen after clicking or tapping the game start overlay. The bed should remain subtle beneath dribbles, shoe cues, rim/backboard hits, dunks, and scoring feedback.

## Generation order and ceilings

Budgets are acceptance targets for the **optimized runtime files**. They are ceilings rather than instructions to add detail until a limit is reached. Maintain a target of **under 3 MB total added runtime assets** for the full first pass; load audio and the accepted ambience only after the game starts.

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

1. **Provenance:** record source files, checksums, selection and conversion steps. The owner removed the rights-clearance requirement for public integration; record unavailable license information as unknown rather than inventing a grant. Preserve the supplied appearance of selected assets.
2. **Mesh:** inspect GLB node transforms, dimensions, triangle count, material count, normals, UVs, winding, and pivot. Verify Y-up, meter scale, and no unexpected negative scale. Confirm the ball center, player floor origin and hand anchors, and hoop landmarks against the contracts above.
3. **Texture:** inspect source and encoded size; check sRGB/linear assignment, alpha fringes, compression artifacts, and a 2×2 tiled preview. Compare opposite edges numerically and visually under arena lighting. Check repeated surfaces at the camera's normal distance.
4. **Rig:** inspect skeleton weights, bone axes, bind pose, and deformation. Exercise idle, movement, shoot, layup, and dunk through `player.update`; compare hand/chest/head world positions with the current implementation and verify ball attachment and release.
5. **Sound:** normalize levels, remove clipped samples and excess silence, verify loop joins, and test rapid cue calls with the current cooldowns. Test unlock and playback on desktop and a touch browser; confirm a missing file falls back to synthesized sound.
6. **Integration:** load only the approved file behind its module boundary, keep the procedural fallback, and retain gameplay dimensions. Run `npm run build`; test a complete desktop run and a narrow touch layout, including dribble, shot, finish, score, and reset. Inspect Network and console for missing paths or decode errors.
7. **Release:** record actual bytes, hash, measurements, and test results in the manifest. Keep `main` and the live Pages build on the last accepted assets until the replacement passes every applicable check; then commit only optimized runtime files and focused integration changes.
