# Original player rebuild — stage report

The owner rejected both recovered assemblies and the authored gait candidates.
The replacement is being developed separately. Nothing has been promoted into
the playable player path or published to `main`. Revision 4 is a static
structural/appearance candidate awaiting owner visual approval. The local and
phone pose galleries show the current stills and texture; motion remains
disconnected and `/dev/player-rebuild.html` remains suspended.
See `CLAUDE_HANDOFF.md` for the original workspace snapshot and validation limits,
and `CLAUDE_DEVELOPMENT.md` for this cloud branch's available files and portable paths.

## Source audit and historical prototypes

- Audited all 976 canonical-rig clips against the reference rest translations;
  explicitly excluded the 572 unresolved bindings. Source and GLB hashes,
  metadata hashes, durations, endpoint errors and uninterpreted event words are
  recorded in `art/player-rebuild/motion-audit.json`.
- Previously built a source-motion viewer at `/dev/player-rebuild.html`: compatible
  clips, side/front views, scrubbing, replay, loop inspection and skeleton display.
  It played source motion without the rejected adapter or gait corrections.
  That renderer is now archived and removed from the active page; no source
  motion currently plays there.
- Recorded 13 shortlisted full clips from side and front at normal speed in
  `.tmp/player-rebuild-review/raw-motion.webm`. Stills and browser-error records
  are alongside it. The shortlist is numerical triage, not certified actions.
- Created an original 9,190-triangle deformation blockout with its own geometry,
  UV coordinates, modeled face/fingers/shoes and uniform on the exact 26-joint
  rig. Editable Blender source: `art/source/player-rebuild/athlete-blockout.blend`.
  This is a construction prototype, NOT the finished player or an accepted look.
- Archived the rejected candidate source under `.tmp/player-rebuild-archive`.

## Findings and unresolved work

### PS2 proportions and diffuse pass — revision 4 (2026-10-05)

At the owner's request, clavicle/shoulder width increased 15%, with outer arm
chains translated instead of lengthened. A new baggy shorts shell replaces 485
old shorts faces; its hem measures 0.1016 m below each knee on the 2 m wrapper.
Openings are approximately 26.8 cm wide. The waist/crotch bridge and bare legs
remain from the supplied source. The neutral skeleton, shaft weights and
dual-quaternion deformation are retained; no motion clips are attached.

The deeper armholes use exposed skin and new trim baked onto the continuous
upper-body surface, as appropriate for this low-poly character. They do not
require cloth simulation. Muscle shadows, collarbone highlights, fabric folds
and restrained occlusion are baked into one 512×512 PNG color atlas. The runtime
material uses that atlas without normal/occlusion textures. Source UVs survive
in the second UV channel for rebaking; the primary UVs are packed using a
temporary welded helper. The helper's coincident faces do not change the
weighted model. UV seams duplicate vertices but preserve the surface normals.

Current candidate: 5,139 triangles, one mesh/primitive/material, 26 joints.
Editable source: `art/source/player-rebuild/selected-ps2-style-r4.blend`.
Texture: `art/player-rebuild/selected-player-ps2-diffuse.png`.
The immutable source GLB is unchanged. Revision 3 is recoverable under
`.tmp/selected-player-revision3-archive`; its measured bone-rest fixture with
asset hash is retained in `art/player-rebuild/history/neutral-rig-r3-rest.json`.

Eighteen structural/retained tests pass, including actual shoulder/arm lengths,
hem placement, cuff widths, PNG dimensions, unit normals, binds and skin hinges.
These checks do not establish visual acceptance. The same private phone link
now offers revision 4 stills and the color texture; motion retargeting and
gameplay review remain pending.

### Structural rejection and neutral rebuild — revision 3 history (2026-10-05)

The owner rejected revision 2 for knee/shin collapse, tucked forearms, rigid
clothing and hunched posture. The local renderer/motion player and private phone
video page are now suspended. `previewEnabled` and `motionConnected` are false.
No candidate is connected to gameplay. Rejected source/GLB are archived in
`.tmp/selected-player-rejected-r2`, along with the former review renderer.
The preview contains no renderer or clip-loading branch. Restoring it requires
an explicit implementation using the neutral rig, its volume-preserving skin
and reviewed retargeted motion.

Diagnosis: upper-shin vertices averaged 58.8% thigh influence, and a source knee
pivot at Z=0 missed the limb center around Z=-.030. The averaging of independent
mesh transforms compressed/stretch geometry even at rest. The fit also treated
the canonical forearm support point named `wrist` as the anatomical wrist. The
raw clips themselves contain strongly bent elbows and neck/head posture; fixing
weights cannot turn an unsuitable clip into a sprint. This review player had no
IK or pole vectors.

`scripts/build-selected-neutral-rig.mjs` replaces that mesh warp with an athlete
authoring rig centered inside the supplied source T-pose. The 26 joint names and
hierarchy remain; rest translations now fit this character. Recovery inputs stay
unchanged. This intentionally changes the earlier exact-rest binding approach:
the character is explicitly `canonicalRestCompatible:false`,
`retargetRequired:true`. Direct raw canonical playback is blocked.

Revision 3 preserved source limbs, head, posture, topology, UVs and atlas. Its lower
jersey gained up to 16% width and 10% depth, tapered at waistband/armholes. Shin
shafts were rigidly weighted to their own tibias, with narrow knee transitions.
Revision 4 retains that structural approach but replaces the shorts and primary
atlas/UVs as described above. Revision 3 editable source:
`art/source/player-rebuild/selected-neutral-rig.blend`.
Measured authoring landmarks: `art/player-rebuild/selected-neutral-landmarks.json`.
The Blender armature uses volume-preserving dual-quaternion deformation;
`src/selected-player-skin.js` provides the corresponding tested mesh deformer
for future adapter integration. Ordinary linear skinning is insufficient for the
deep blended knee ring and must not silently replace it. Motion is disconnected.

Revision 3 offline diagnostic stills (not a court preview) included neutral front/side and
isolated knee hinges at 60/90/110 degrees and relaxed arms in
`.tmp/selected-neutral-structure`. Ten neutral-rig tests passed at that revision, including bind
identity, opposite-limb isolation, hinge geometry, wrapper transforms and the
volume-preserving mesh path. In the tested blended knee rings, ordinary linear
skinning shrank the radius by 37–41% at 110 degrees; dual-quaternion deformation
preserved the radius within 0.0001%.
These remain structural checks, not owner visual acceptance, motion retarget
approval, cloth simulation or a finished player/controller.

Validation at revision 3: 16/16 neutral-rig and retained rebuild
tests passed, `npm run assets:check` passed, and both default and `/TheArena/`
builds passed. Browser checks of the actual suspended HTML/module passed at
desktop, emulated portrait and emulated landscape sizes, with no canvas, videos,
enabled playback controls or model/clip requests. Those layout checks used
offline browser rendering after localhost serving failed; they are not live
server or physical-phone evidence. The private Sites suspension deployment
reported success. Compound poses, clip retargeting, live gameplay and motion
quality remain unverified.

Native role names are not action labels. The inspected `shooter` candidate
`4205_6e5320a8_000n_002` includes locomotion; arm-raised `benchwt3` candidates
include bench gestures. Full-clip endpoints in the shortlist are mismatched and
cannot simply be looped. No walk, run, dribble, jump-shot, layup or dunk mapping
has been certified. Foot contacts and ball/release events remain unassigned.

The generated character blockout exposes disconnected deformation surfaces and
lacks finished textures; it does not pass the model-quality gate. It must be
replaced/refined before any gameplay integration. No claims of visual acceptance,
finished topology, action coverage or a completed rebuild are made.

The owner selected the existing Tripo character shown in
`tripo-showcase-73d1ba25-094d-47c5-9b34-40203d7a2f82.mp4`: white headband,
short locs, white uniform with red/blue trim and matching high-top shoes.
This replaces the procedural blockout as the intended player. No new generation
is requested or necessary. The exact Studio asset is
https://studio.tripo3d.ai/3d-model/basketball-player-in-white-blue-red-jersey-standing-on-a-court-with-ar-73d1ba25-094d-47c5-9b34-40203d7a2f82.
The owner supplied `basketball player 3d model (1).glb`. It is copied unchanged to
`art/player-rebuild/selected-player-source.glb`, SHA-256
`26d97a1a31ac65445f06ac0595f08ae3f02174d9aea2ee6225cfffaa6041ada9`.
Inspection confirms the character matches the video, 4,824 triangles, 4,211
vertices, one embedded textured material and no existing rig/animations.
Editable import: `art/source/player-rebuild/selected-player.blend`.

### Archived fit revisions 1 and 2

The former `scripts/skin-selected-player.mjs` generated a review-only skin fit
using unchanged canonical 26-joint hierarchy/rest transforms. It preserved
the supplied UVs and embedded texture bytes. The review-only output is
`selected-player-fit.glb`; editable weights are in
`art/source/player-rebuild/selected-player-fit-r2.blend` (revision 2).
That playback is disabled. The launcher now calls the neutral-rig generator.
Two historical raw clips were recorded from side/front at normal speed in
`.tmp/selected-player-review/raw-motion.webm`. The first fit has visible shoulder
distortion and does not pass visual acceptance. Revision 2 corrects the source
arm/knee landmarks and prevents upper-shoulder vertices from following the head:
12 formerly misclassified shoulder vertices now have zero head binding. It keeps
the canonical rest transforms, 4,824 triangles and original texture/UV data.
Matched before/after normal-speed side/front recordings are in
`.tmp/selected-player-cleanup/{before,after}/raw-motion.webm`; the synchronized
viewer was `/dev/player-skin-review.html`; its moving comparison is archived and
the page now shows revision 4 static poses. Thirteen raw source clips were sampled
at three times from both side/front, with saved stills under
`.tmp/selected-player-cleanup/stress-r2`. Inspected poses include walking,
running, forward bends and arm gestures. These samples are deformation checks,
not certified action assignments or gameplay evidence. Owner visual approval,
motion classification, controller and gameplay integration remain incomplete.
No new generation or paid conversion was submitted; the playable path is unchanged.

Phone review (private Sites snapshot, published at the owner's request on
2026-10-05): https://arena-player-skin-review.vindona.chatgpt.site.
At the owner's subsequent request to preview the rebuilt structure, the page now
shows six selectable static poses: relaxed arms, neutral front/side and isolated
60/90/110-degree knee bends. The moving candidate remains disconnected. The pose
buttons and image loading passed offline browser checks with keyboard/mouse and
emulated portrait/landscape touch. Rejected footage is archived, not presented as
an accepted candidate. Source and hosting identity are retained in `.tmp/phone-player-review`.
Use the same ChatGPT account if prompted to sign in.

Root-trajectory data stays in the read-only source metadata. Historical raw playback
showed exported skeletal tracks in place; it did not recreate original 2K gameplay
translation, possession, ball paths or action-event semantics.

Remaining stages: review the selected revision 4 silhouette and compound-pose
deformation, establish reviewed action coverage and usable loop ranges, validate
retargeting onto its own neutral rig, build the gameplay controller and motion-led
ball/event interface, validate all transitions/actions, record actual gameplay
and touch evidence, then obtain owner approval before publication.

## Historical audit/prototype commands

These commands document the earlier source audit and rejected blockout. They are
not a recipe for rebuilding the current selected-player appearance. Recovery
inputs remain read-only; do not rerun generators merely to load project context.

```powershell
node scripts/build-nba2k9-assets.mjs <study-directory> --analyze > .tmp/player-rebuild-analysis.json
node scripts/prepare-player-rebuild.mjs <study-directory>
node scripts/build-original-player.mjs
node scripts/skin-selected-player.mjs
node --test tests/selected-neutral-rig.test.mjs
node --test tests/player-rebuild.test.mjs
```

## Current appearance reproduction

To regenerate the current appearance for an authorized asset change: run
`node scripts/build-selected-neutral-rig.mjs --authoring`, execute
`scripts/bake-selected-player-style.py` in Blender through the bridge with
`MODE='bake'`, then run `node scripts/build-selected-neutral-rig.mjs`.
For static review captures execute the same Blender script with `MODE='render'`
and `REVIEW_POSES` listing the six named review poses. The script runs inside
Blender (optionally through the bridge), uses `PROJECT_ROOT` or the repository
working directory for `BASE`, and requires
the existing `TheArena-Neutral-Structural-Rig` scene before creating its dedicated
R4 scene. It is not a standalone Python script. Baking preserves the
source image separately and packs only the new 512 atlas into the final GLB.

The preparation script copies review clips only into ignored repository-local
`art/player-rebuild/source-motion` on this cloud branch; it never edits recovery inputs. Browser recording
uses the existing PLAYWRIGHT_MODULE, PLAYWRIGHT_EXECUTABLE and FFMPEG_EXECUTABLE
environment overrides. The full rebuild remains incomplete.
