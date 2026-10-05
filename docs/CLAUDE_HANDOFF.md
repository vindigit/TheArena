# Claude Code handoff — selected player, revision 4

Snapshot: 2026-10-05. This records the current local state and the owner's intended
rebuild. It does not authorize a new implementation task or publication.

## Start here

### Current cloud implementation branch

Fetch and check out `origin/codex/claude-player-development`, then read
`docs/CLAUDE_DEVELOPMENT.md`. The selected model, editable Blender files,
rebuild scripts/tests, status JSON and all 976 compatible motion copies are now
included there. The earlier `codex/claude-player-handoff` branch still contains
only documentation. The rest of this handoff records the original Windows
workspace: its dirty runtime and ignored-file statements are historical, not
the file availability of the new cloud branch. Rejected motion remains disabled
and publishing the replacement still requires owner visual approval.

### Owner's local workspace snapshot

- Working repository:
  `C:\Users\valexander\Documents\Codex\2026-09-27\codex-mcp-add-scenario-url-https\TheArena`
- Remote: https://github.com/vindigit/TheArena
- Current local branch: `codex/current-luke-1791040453713`
- Current HEAD: `40c1606b1233b5c9743d6a4785442335dc863cfa`.
- Deployment branch: `main`. Playable game: https://vindigit.github.io/TheArena/
- Static phone review: https://arena-player-skin-review.vindona.chatgpt.site
  (private; use the owner's same ChatGPT account if prompted).

Read `AGENTS.md` and `PROJECT.md` first. Inspect `git status --short` and the
actual runtime imports. The working tree contains substantial uncommitted
rebuild and earlier locomotion work alongside unrelated Luke changes. A remote
clone does not contain this complete local state. No rebuild work has been
promoted to the playable replacement path or published to TheArena `main`.
The phone review is a separate static Sites deployment, not the game deployment.

This dirty checkout still runs the rejected authored gait in the recovered
Classic 01/02 path: `src/nba2k9-motion.js` imports the local locomotion module and
the roster enables its walk/run entries. That local implementation is unapproved
and excluded from the replacement controller plan. Do not assume the current
local runtime matches deployed `main`; inspect and compare before future release
work. This context handoff does not remove or roll back the existing local code.

The owner's immediate priority is the selected player, its structure and its
appearance. CPU 1v1, variants and team/online modes are later work. The last
request was to bring Claude up to date; report your understanding and await the
next task rather than treating this document as a request to begin all stages.

## What the owner chose and rejected

The owner rejected Classic 01/02 presentation and the authored walk/run candidate
for crab-like movement, exaggerated lunges and poor posture. An original player
and a fresh motion-based controller were requested, developed separately while
the current game remains playable. The owner then selected the supplied Tripo
athlete instead of the procedural blockout: white headband, short locs, white
uniform with red/blue trim, tattoos and high-top shoes. Keep that character;
no replacement generation or paid conversion is requested.

The immutable input is `art/player-rebuild/selected-player-source.glb`, copied
from `basketball player 3d model (1).glb`. SHA-256:
`26d97a1a31ac65445f06ac0595f08ae3f02174d9aea2ee6225cfffaa6041ada9`.
It has 4,824 triangles, 4,211 vertices, one 2048×2048 JPEG atlas and no existing
rig or animation. Do not overwrite it or change external recovery inputs.

The owner rejected selected-player revision 2 for knee/shin collapse, forearms
tucked against the torso, rigid clothing and hunched posture, and explicitly
ordered the renderer and clips disconnected until the skeleton was fixed.
That candidate had no IK or pole vectors: verified issues included misplaced
joint centers, excessive thigh influence on shins, rest-fit distortion and
unsuitable raw arm/head motion. Do not assume weighting can fix a bad source clip.

Revision 3 created an anatomical neutral rig and volume-preserving deformation.
At the owner's later request, static structural poses were restored for review.
Revision 4 then implemented the latest appearance requests:

- Clavicle/shoulder width increased 15%; outer arms translated without lengthening
  the arm chains.
- New baggy shorts replace 485 old shorts faces. At the approximately 2 m wrapper,
  their hems are 0.1016 m (four inches) below each knee; openings are about 26.8 cm
  wide. Original waist/crotch bridge and bare legs remain.
- Deeper-looking armholes expose skin and trim on the continuous upper-body mesh.
  This is baked surface styling, not independent cloth simulation.
- One 512×512 PNG diffuse includes muscle shadows, collarbone highlights, fabric
  creases and restrained occlusion. There are no runtime normal/occlusion maps.

Revision 4 has **5,139 triangles, 7,476 exported vertices, one mesh/primitive/
material and 26 joints**. UV seams explain the exported vertex count; the Blender
authoring mesh has 4,400 vertices. All of this remains unapproved by the owner.

## Current files and their roles

| File | Role |
| --- | --- |
| `art/player-rebuild/selected-player-status.json` | Current revision and approval/motion flags |
| `art/player-rebuild/selected-player-neutral-rig.glb` | Current revision 4 candidate, despite the generic filename |
| `art/source/player-rebuild/selected-ps2-style-r4.blend` | Latest editable Blender source, locally present and Git-ignored |
| `art/player-rebuild/selected-player-ps2-diffuse.png` | Current 512×512 color atlas |
| `art/player-rebuild/selected-player-source-diffuse.jpg` | Original atlas retained for rebaking |
| `art/player-rebuild/selected-player-style-authoring.glb` | Pre-bake authoring input |
| `art/player-rebuild/selected-player-style.json`, `selected-player-style-uv.json` | Geometry provenance and packed per-corner UV recipe, tied to geometry hash |
| `art/player-rebuild/selected-neutral-landmarks.json` | Own authoring joint centers and wrapper height scale |
| `scripts/build-selected-neutral-rig.mjs`, `selected-player-style.mjs` | Current rig/weights, shoulders, shorts and final GLB generation |
| `scripts/bake-selected-player-style.py` | Blender authoring, diffuse bake and static captures |
| `scripts/skin-selected-player.mjs` | Compatibility launcher for the neutral generator, not the rejected fitter |
| `src/selected-player-skin.js` | Tested CPU dual-quaternion deformation utility; outside gameplay |
| `tests/selected-neutral-rig.test.mjs` | Twelve current structural/deformation checks |
| `art/player-rebuild/motion-audit.json` | Source clip hashes, compatibility audit and numerical shortlist |
| `dev/player-skin-review.html`, `art/player-rebuild/review/*.png` | Current six-pose static review and texture link |
| `dev/player-rebuild.js` | Suspended page; no renderer or clip-loading branch remains |
| `src/nba2k9-player.js`, `src/nba2k9-motion.js`, `src/nba2k9-roster.json` | Existing recovered player path; replacement not integrated |

`previewEnabled:false` means moving preview is disabled, not that the static
gallery is disabled. `motionConnected:false` and `approved:false` are current.
The pose gallery shows relaxed arms, neutral front/side and isolated knee bends
at 60/90/110 degrees. There is no revision 4 walking/running video or playable
replacement. Flipping a flag cannot restore the deleted renderer.

The rejected `selected-player-fit.glb`, its revision 2 Blender source and
`athlete-blockout.glb` are historical fixtures, not candidates to activate.
Archives exist in `.tmp/selected-player-rejected-r2`,
`.tmp/selected-player-revision3-archive` and `.tmp/player-rebuild-archive`.
Historical raw footage is in `.tmp/player-rebuild-review`,
`.tmp/selected-player-review` and `.tmp/selected-player-cleanup`.
The measured R3 rest fixture remains in
`art/player-rebuild/history/neutral-rig-r3-rest.json`.

`.tmp/` and `art/source/**/*.blend` are ignored. The current Blender source,
archives and 976 review clip copies exist in this workspace but will not follow
an ordinary Git clone. Confirm availability before reproducing work elsewhere;
preserve needed ignored files rather than cleaning the workspace.

## Rig, skinning and reproduction constraints

The new rig retains the canonical 26 joint names and hierarchy, but its own rest
translations fit the selected source athlete. This intentionally supersedes the
original exact-canonical-rest plan after revision 2 failed. Current flags are
`canonicalRestCompatible:false`, `retargetRequired:true` and
`skinningRequired:"dual-quaternion"`. Shared names alone do not make raw canonical
tracks compatible. Validate retargeting to the new basis; do not distort the
source mesh back into the rejected canonical fit.

Blender's armature uses preserve-volume deformation. GLB extras only document
that requirement: ordinary Three.js linear skinning can collapse the blended
knee ring. A future renderer must explicitly use the tested volume-preserving
path or a validated equivalent. `createVolumePreservingMesh(source)` returns
`{mesh, update}` with an ordinary Mesh. Attach it to the source's same parent,
hide/remove the original SkinnedMesh, and call `update()` after posing. Apply the
shared height/facing wrapper once; the skin palette cancels its common transform.
The current utility rejects per-bone scaling. CPU performance under actual
animated phone gameplay has not been established.

The current generator preserves source UVs in a secondary channel and uses a
packed primary UV recipe tied to the geometry hash. Do not reuse a stale recipe
after geometry edits. The temporary welded UV helper is not the weighted mesh;
its coincident-face cleanup must not remove the source character's surfaces.

Regeneration, only when implementing an authorized asset change:

1. Run `node scripts/build-selected-neutral-rig.mjs --authoring`.
2. Execute `scripts/bake-selected-player-style.py` **inside Blender through the
   bridge**, with `MODE='bake'`.
3. Run `node scripts/build-selected-neutral-rig.mjs` for the final baked GLB.
4. For stills, execute the Blender script with `MODE='render'` and the six named
   `REVIEW_POSES`.

This is not a standalone Python pipeline. The bake script currently has a
workspace-specific `BASE` and requires the existing
`TheArena-Neutral-Structural-Rig` scene before creating its dedicated
`TheArena-Selected-PS2-Style-R4` scene. Preserve other Blender scenes and use the
local editable sources; inspect these prerequisites before running it in a
fresh Blender process. Do not run the historical original-blockout generator
as if it regenerated the owner's selected player.

## Motion work that remains

The audit covers 976 canonical-reference clips and excludes 572 unresolved
bindings. The compatible source copies are local in `.tmp/player-rebuild-source`.
Compatibility was checked against the old canonical reference, not the new
character's rest basis. All action assignments remain unreviewed/null.
Thirteen clips were shortlisted and recorded, but numerical triage and native
names do not certify idle, walk, run, dribble, gather, shot, layup or dunk.
Full-clip endpoints are mismatched; usable ranges and contacts are unassigned.
Root-trajectory metadata and uninterpreted event words are retained; historical
raw pose playback did not recreate gameplay translation, ball paths or releases.

The intended remaining sequence is:

1. Review the current model's silhouette and compound-pose deformation with the
   owner. Reject pinching, knee collapse, bent shafts and poor arm clearance.
2. Restore a separate reference/source review deliberately, classify suitable
   clips at normal speed, and validate retargeting onto the current neutral rig.
   Record source/hash, reviewed range, loop boundaries, cadence, foot contacts
   and action/ball events. Exclude unresolved bindings and report missing actions.
3. Build a fresh clip-based controller retaining reviewed pelvis, knee and arm
   motion. Drive locomotion phase from actual travelled distance, blend compatible
   walk/run phases, preserve phase through possession changes and keep leg cadence
   independent of bounce timing. Use dedicated on-ball clips where suitable.
4. Add restrained contact corrections only after raw playback passes review;
   preserve its silhouette. Integrate reviewed dribble/gather/shot/finish timing
   with motion-event and ball-presentation outputs consumed by `src/main.js`.
   Gameplay still owns movement, facing, speed, possession, grading, scoring,
   release and free-ball physics. Preserve existing player interfaces.
5. Validate starts/stops, speed changes, turns, possession changes, action contact,
   release and landing. Provide matching normal-speed side/front/gameplay footage
   and desktop/touch evidence. Await owner visual approval before publishing the
   replacement to `main`.

Do not revive the rejected analytic gait/corrective posture system or disguise an
unrelated segment as a missing action. Keep one approximately 2 m player within
the existing 20,000-triangle ceiling; variants come after acceptance.

## Validation evidence and its limits

Freshly rerun for this handoff on 2026-10-05:

```powershell
node --test tests/selected-neutral-rig.test.mjs tests/player-rebuild.test.mjs
npm run assets:check
```

The combined tests pass **18/18**: 12 current structural tests and 6 retained
historical tests. Current checks cover provenance, dimensions, diffuse-only
material, hierarchy/binds, source surfaces/UVs, normals, isolated knee/elbow
hinges, dual-quaternion rings, wrapper transforms and rejection of per-bone scale.
The historical 30/60/120 Hz playback tests exercise the rejected old fit and
blockout; they do **not** certify revision 4 motion or gameplay.
The asset check passes for 18 accepted assets and 28 runtime files; the staged
replacement is outside that runtime manifest.

Both builds were also rerun successfully for this handoff:

```powershell
npm run build
npm run build -- --base=/TheArena/
```

An existing bundle-size warning remains. These builds validate the current
playable bundle; they do not render or integrate the staged revision 4 player.

Previous static gallery/suspension checks used desktop and emulated portrait
390×844 / landscape 844×390 layouts, including mouse, keyboard and touch pose
buttons. They used offline local-asset browser routing after localhost serving
failed. They do not prove live localhost, physical-phone performance or new
gameplay controls. The separate phone snapshot was successfully deployed at the
owner's request, but remains a static review awaiting their feedback.

There is no claim that the entire regression suite is green. It was not rerun
for this documentation handoff. Historical inactive-v2 logs contain missing-export
failures; unrelated local Luke changes remain outside the focused checks above.
Do not discard failures, silently tune around them or present focused success as
whole-project certification. For eventual integration, run recovered asset,
loading, motion and gameplay checks plus applicable retained regressions, both
builds and new candidate tests for loop continuity, moving-foot drift, event
ordering, possession transitions and 30/60/120 Hz independence.

Visual acceptance remains outstanding. Isolated hinge success cannot establish
full-pose volume, locomotion quality, foot planting or action contact.

## Preserve unrelated work and keep context current

Existing local Luke work includes `src/player.js`, `src/polished-pose.js`,
`src/hand-absolute-clearance.js`, `src/arm-twist.js`, its tests/deformation scripts,
`docs/PLAYER_ASSET.md` and `package.json`. Review diffs before touching shared
files. Do not reset, clean, overwrite or broadly stage the dirty tree.
Gameplay orchestration remains in `src/main.js`; this handoff changes no runtime
code, assets, controls or deployment.

`docs/PART1_HANDOFF.md` and Luke-era sections of older pipeline documents describe
historical work. They do not override the current selected-player status or the
owner's later directions. `docs/LOCOMOTION_REVIEW.md` documents the rejected
authored gait still present in the local recovered-player path; it is not the
foundation for the fresh replacement controller.
Update this snapshot when the owner accepts a stage or actual implementation
changes it, and distinguish implemented, tested and visually accepted each time.
