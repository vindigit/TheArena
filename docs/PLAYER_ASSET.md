# Fictional player

The accepted player is `public/assets/models/player/fictional-player-v1.glb`:
3,931 rendered triangles, 523,940 bytes, one embedded 512-square atlas,
one material, 17 bones and at most two nonzero skin influences. It has no
animation clips. The floor root is at zero, Y is up and forward is negative Z.

Scenario P-Image supplied the original design concept. The Tripo mesh request
exceeded the Free-plan limit; available humanoid riggers required paid plans.
The mesh, atlas and skeleton were therefore authored locally with
`scripts/build-player.mjs`. Exact prompts, settings, concept IDs, the failed
mesh request, license scope, measurements and SHA-256 are in the manifest.
No raw generations, source screenshots or DCC files are runtime dependencies.

`src/player.js` retains its original public interface and loads the validated
GLB behind that boundary. `src/player-procedural.js` is the unchanged original
implementation and remains visible while loading and after failures.
`src/player-pose.js` handles the skeleton, two-bone arm IK and wrist poses.
Gameplay movement, facing, jump, ball physics and input remain in `src/main.js`.
Gather poses follow the game's fixed shot anchor; layups and dunks expose the
right-hand ball anchor. The attachment objects remain stable across loading.

Run the game with `npm run dev` and open the URL printed by Vite. Desktop:
WASD to move, Shift to sprint, hold/release Space to shoot, F to finish near
the basket, R to reset. Touch: left stick, RUN, HOLD SHOOT, FINISH, RESET RUN;
drag the court to move the camera.

Validation commands:

```powershell
node tests/player.test.mjs
npm run assets:check
npm run build
```

To reproduce the asset into ignored staging, run `node scripts/build-player.mjs`.
To prepare a browser regression harness, run `node scripts/prepare-player-check.mjs`
and open `/.tmp/player/game.html` on the Vite server. In the browser console,
`arenaPlayerCheck.runChecks(false)` exercises desktop handlers. Use a browser
with **actual coarse-pointer/touch emulation enabled**, then
`arenaPlayerCheck.runChecks(true)` for touch. A small viewport alone does not
enable touch input. `--candidate` tests the staged GLB instead of the runtime file.
The harness is ignored and never included in the production build.

Validation covers 305 skeletal poses, normalized weights, bind matrices,
dimensions, texture size, all actions, root ownership, hand/ball contact,
desktop and touch control handlers, layup/dunk scoring, and missing/invalid
model fallback. Khronos glTF Validator reported zero errors or warnings.
Browser touch events also exercised movement, camera, shoot, finish and reset
with hit testing and pointer capture. Physical-phone frame rate is unmeasured.
The current license scope remains the project's noncommercial evaluation demo.
