# Video-to-Luke motion pipeline

Luke's **gather**, **jump shot** and **layup** are captured from reference video
supplied by the project owner, cleaned, retargeted onto the canonical 17-bone
rig and stored in `art/animation/polished-samples.json`. Dunks still use the
legacy procedural pose; dribble/run/ready are unchanged.

Only rotations ship. Source footage is never committed (see
`public/assets/animation-credits.txt`).

## Steps (`scripts/video-mocap/`)

| Step | Script | What it does |
| --- | --- | --- |
| Clean clip | `extract_pose.py` | Trims the segment, resamples to 30 fps, denoises (`hqdn3d`), finds the player, then follows him with a fixed-size square crop (smoothed path) upscaled to 768², plus CLAHE contrast. Writes `<name>.clean.mp4` (import-ready reference), `<name>.overlay.mp4` (skeleton check) and `<name>.pose.json`. |
| Pose | `extract_pose.py` | MediaPipe Pose Landmarker **heavy**, VIDEO mode, on the cleaned crop; 3D world landmarks + visibility. |
| Clean + retarget | `retarget_luke.py` | Hampel outlier rejection, visibility-weighted gap fill, zero-phase Butterworth low-pass, overhead-arm depth-flip prior, camera pan/yaw removal (gameplay owns facing), camera tilt levelling. Each bone takes only its **direction** from the video, so Luke's proportions are untouched. Elbow/knee hinge planes fall back to body-relative axes when limbs straighten. Hands follow a planned palm direction per phase (video finger points are too noisy), and the forearm shares the pronation. Head motion is softened to 60% relative to the chest. |
| Timing | `build_clips.py` + `clips.json` | Piecewise time-warp onto game events, resampled at 30 fps. Writes an animated Luke GLB for Blender. |
| Blender | `blender_review.py` | Imports the animated GLB in Blender 4.5, removes redundant linear keys, measures the lowest skinned shoe vertex per frame, renders front/side/¾ review frames with a preview-only ground + jump lift, and exports import-ready `luke-video-clips.glb` / `.fbx` (in-place, one action per clip). |
| Runtime | `export_runtime.py` | Writes rotations, `visualGroundingY` (lowest shoe on the root), `ballLocal` (ball centre on Luke's physical right palm) and `handShapeState` into the sample pack. |

`run_all.sh UPLOAD_DIR WORK_DIR` runs everything (`BLENDER=/path/to/blender`).
Requirements: ffmpeg, Python 3 with `mediapipe opencv-python-headless scipy`,
the MediaPipe `pose_landmarker_heavy.task` model, Blender 4.5.

## Clips and event timing

| Clip | Source segment | Warp (source frame → game seconds) | Game contract |
| --- | --- | --- | --- |
| `gather` | jump-shot clip, 0.9–2.8 s | 2→0, 16→0.5 | charge hold; arms solved to the ball |
| `shoot` | same | 16→0 (dip), 30→0.20 (release), 37→0.40 (landing), 48→0.70 | detach at 0.20 s apex, landing 0.40 s |
| `layup` | drive-and-layup clip, 3.2–5.6 s | 19→0 (takeoff), 46→0.4956 (release), 57→0.84 (landing) | `releaseAt` 0.59 of 0.84 s |

Both source clips are slow motion; the warp restores game timing. Hand plans
(`clips.json` → `handPlan`) key the presets `relaxed`, `guide`, `set`, `flick`,
`reach` and `soft-release` to source frames.

## Runtime

`src/polished-pose.js` now samples `layup` at `finishElapsed`. While the ball
is held, it blends from the dribble position to the sampled palm over
0.20 s and the right arm is solved onto that path. `getHeldBallLocal` returns it,
so `releaseFinish` launches from the captured hand. The shot keeps its
existing contract: arms are solved to the ball until the 0.20 s detach, then
the captured follow-through owns them.

## Mixamo

Mixamo was not used. It needs an interactive Adobe sign-in, it auto-rigs
uploaded meshes rather than converting video, and its skeleton would
replace Luke's pinned 17-bone contract. The exported `luke-video-clips.fbx` uses
Luke's own rig and imports into Blender, Maya or Unity. Uploading Luke to
Mixamo would give a different, incompatible rig.

## Known limits

- Single-camera depth is ambiguous. The overhead-arm prior and smoothing
  correct the common flips, but subtle torso twist is approximate.
- The jump-shot release is about 0.5 m right of centre on Luke (captured
  arm angle on Luke's broad shoulders). The ball launch uses it as-is.
- Feet are not world-locked in the clips themselves. The runtime's existing
  foot-lock/sole solver handles planted frames.

Evidence: `docs/evidence/video-mocap/`.
