# Part 1 recording and transition diagnosis

Inspected against starting revision `e436aa2f2003924fb634d656b1b3528e84b5c0cc`, before Part 1 edits. These findings describe the superseded runtime, not the final Luke baseline.

## Which footage and which transitions

`ScreenRecording_09-30-2026 21-45-41_1.mov` is a 720 × 1558 phone recording of TheArena on `vindigit.github.io`. It shows the old navy number-7 fictional player, not the supplied Luke character. The visible **Motion: CMU · usage terms** link strongly identifies the experimental hybrid URL: this revision displayed that link only for `animation=hybrid` with Luke unselected. The collapsed address bar does not reveal the complete query, and the recording contains no build hash or live animation diagnostics. Thus the exact deployed commit and successful companion-load status cannot be established from pixels alone.

The other file, `ScreenRecording_09-30-2026 21-36-12_1.mov`, records a YouTube Shorts clip from another basketball game. It is a movement reference, not a reproduction of TheArena's rig or code. Its frames remain in ignored local evidence and were not added as game assets.

The corrected gather windows were inspected first. At roughly **8.1–8.2 seconds** and **18.7–18.8 seconds**, a moving/dribbling pose becomes an upright, much less staggered stance as the hands raise and the shot meter begins filling. This visible change occurs before ball release. The footage supports a stance/animation handoff defect; it does not demonstrate bad skin weights. The apparent inward silhouette includes perspective and the loss of longitudinal stride, so it should not be described as a measured knee-valgus angle.

The **13–15-second** passage is a separate loose-ball return. The ball is on the floor around 13.3 seconds and **BALL SECURED** is visible by 13.6 seconds. The player also turns during this passage. Pickup and turn-related foot correction can therefore both contribute to its appearance; the exact rendered frame on which each subsystem changed is not observable in the recording.

Evidence:

- [Full-game overview](evidence/part1-recording-2145-overview.jpg)
- [Comparable player crops across both gathers](evidence/part1-recording-2145-gathers-close.jpg)
- [Player crops across pickup and turning](evidence/part1-recording-2145-pickup-close.jpg)
- [Video metadata](evidence/part1-recording-metadata.json)

Timestamps label requested decoder positions and are approximate. Crops use the same image rectangle, preserve the original lighting, and are enlarged for inspection. They are not corrected renderings.

## Reproduced causes in the actual starting code

### Gather: two abrupt lower-body changes

The old `src/main.js:startCharge` immediately sets `action='shoot'`, resets action progress to zero, and switches `ball.mode` from `dribble` to `gather`. The next `updatePlayer` keeps the gameplay root stationary while damping speed and advancing shot charge. The old `src/player-pose.js:update` resets all local bone positions and quaternions, constructs locomotion, and then **replaces** both thighs, shins and feet with the small symmetrical shooting crouch. There is no transition from the final moving leg pose. This abrupt procedural replacement also occurs on Luke's previous preview, which never used the hybrid clip.

For the old hybrid model, `src/player-hybrid.js:update` first calculates a gradual target-weight decay, then sets the weight to **zero immediately** when ball mode is not dribble or action is not move/idle. It releases both foot plants and returns before clip rotations, pelvis lowering, and leg-ground correction run. Consequently the previously corrected dribbling stance loses all those contributions in one frame and exposes the already-replaced shooting pose. The advertised stop/start fade did not cover this gather path.

A deterministic skeletal reproduction loads the actual historical shipped meshes and companion, performs 42 walking updates at 120 Hz and 3.38 m/s, then evaluates the first shooting/gather update with the real 1300 ms charge clock. Results:

| Starting path | First-gather bone/stance discontinuity |
| --- | --- |
| Old fictional player, hybrid | Weight **0.999972 → 0**; right shin local rotation changes **55.49°**; pelvis rises **11.69 cm**; left ankle moves **34.04 cm** longitudinally. |
| Old fictional player, procedural | Right shin changes **20.03°**; left ankle moves **20.40 cm** longitudinally. |
| Luke preview, procedural | Right shin changes **20.03°**; left ankle moves **22.61 cm** longitudinally. |

These measurements establish that the **bones themselves** are driven through a discontinuity. They are not evidence that a mesh incorrectly deforms around sensible unchanged bones. Measurements concern bone frames, not skinned shoe soles or exact screen-space inward angles.

### Pickup: a separate old-hybrid foot-correction enable

The old `updateLooseBall` changes directly from `loose` to `dribble` when the low ball lies within 0.78 m of the player. There is no pickup action. Since `updatePlayer` runs before `updateBall`, the adapter sees the old possession state on the securing update and the new dribble state on the following update.

For moving hybrid play, that following update enables hybrid sampling and leg-ground correction. Clip rotation and pelvis changes use the rising hybrid weight, but the final `solveLeg` results are **not blended by that weight**. A separate fixed-speed pickup reproduction measures weight **0 → 0.2212**, a **34.94°** left-shin change and a **2.59 cm** pelvis drop on the first dribble pose. After subtracting intended root travel, ankle changes are approximately **6.5 cm** and **9.1 cm**. No turn was applied in this isolated test, so pickup enable alone is sufficient to produce a discontinuity in that old path.

With the same possession change and movement, the old and Luke procedural paths show only the ordinary next-stride update: at most **0.41°** of shin change and roughly **1–4 mm** of ankle motion. They do not have possession-dependent lower-body correction. The historical hybrid also releases and reacquires plants on turns over 45°; its documented turn snaps are an additional possibility during the recorded pickup/turn, not the explanation for the two corrected gathers.

## Ownership, reset and remaining uncertainty

At the starting revision the order is explicit: procedural rest reset/pose, optional sampled hybrid rotations, hybrid leg IK, then post-ball right-arm contact IK. There is no concurrently running animation mixer. Post-ball contact only modifies the right arm, and it is gated to hybrid dribbling. Bone positions and quaternions reset every procedural update, so repeated local-transform accumulation is not supported as the cause of these reproduced snaps. Whether every reset matches Luke's exact rest contract is separately audited by Part 1 rig validation.

The recording cannot establish the actual runtime blend value, plant targets, or skin-weight correctness. It also cannot prove that every pickup frame has the same cause as the independent fixed-speed test. The deterministic reproductions establish two concrete code defects without inventing a single explanation for every visual change: **procedural gather overwrite**, amplified by **hybrid hard cutoff**, and **unblended hybrid leg-correction enable on moving pickup**.

[Raw historical before/after transforms and diagnostics](evidence/part1-legacy-gather-transforms.json) preserve the measured samples and original revision. All old sources and old player/animation files were archived from that revision into ignored `.tmp/part1-before/` before removal. The local before-game URL is `/.tmp/part1-before/index.html`; `?animation=hybrid`, `?player=luke`, and no query reproduce the independent paths. `window.part1Before.prepareWalk(42)` renders the pre-gather pose, `gatherFrame(1)` evaluates the first gather update, and `snapshot()` exposes gameplay, blend and bone state. `evidenceView()` renders from a fixed root-relative camera offset `[1.6, 1.9, 3.2]` looking at root + `[0, 1, 0]`, permitting consistent close comparison without camera settling differences. This archive is for historical comparison only and is not a production or Part 2 asset dependency.

The final Luke baseline must smooth the procedural moving-to-gather handoff, retain rest-derived transforms and clear joint ownership, and exclude the incompatible legacy hybrid/foot-correction path. Reweighting or rebuilding Luke would not correct these proven state-transition causes. Final before/after gameplay evidence and isolated Luke stress-pose acceptance are recorded by the Part 1 visual validation, separately from this historical diagnosis.
