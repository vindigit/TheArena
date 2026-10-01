# Part 2 handoff prompt

Implement Part 2 of TheArena character-animation rebuild: a Luke-compatible animation pack and coherent runtime transitions, using the completed Part 1 foundation.

First read AGENTS.md, PROJECT.md, docs/PART1_HANDOFF.md, docs/PLAYER_ASSET.md, docs/PART1_RECORDING_DIAGNOSIS.md, docs/PART1_MOTION_REVIEW.md and docs/rig/luke-rig-contract.json. Inspect the actual current branch/worktree, asset manifest, player loader, pose adapter, possession and shooting states, retargeting configuration and tests. Preserve unrelated changes.

Luke must remain the sole playable character. Canonical asset: public/assets/models/player/luke-player-v1.glb. Preserve his supplied appearance, proportions, uniform and textures. Target the exact Luke hierarchy, rest transforms and inverse bind matrices; matching bone names alone is insufficient. Keep strict compatibility checks. Never revive the old character, mannequin fallback or old-rig hybrid clip. The old hybrid is superseded, not migrated.

Author or correctly retarget in-place idle/ready, locomotion and start/stop transitions, stationary/moving dribble, loose-ball pickup, shot gather, release/follow-through and finishes required by existing gameplay. Maintain gameplay-owned movement, facing, collision, possession, shot timing and ball physics. Give animation systems explicit joint ownership, reset from the canonical rest pose and support interruptions without accumulated transforms. Preserve hand anchors and foot-ground conventions. Keep the validated procedural baseline available where clips are incomplete; clearly identify incomplete states instead of claiming the pack finished.

Part 1 repaired abrupt lower-body handoffs and reversed procedural knee flexion. The strongest recorded snaps occurred during shot gathers around 8.1 and 18.7 seconds; loose-ball pickup around 13–15 seconds is a separate path. Dedicated pickup motion, polished upper-body gather blending and less stiff shooting poses still need work. Reproduce and inspect these paths first. Do not assume skinning is faulty without evidence.

Use /dev/rig.html to inspect every clip and blend on the lit floor with grid, bone overlays and front/side/three-quarter views. Then capture repeated pickup, dribble, movement, stop, gather, release and reset transitions in the actual game. Check knees, pelvis, feet, palm/ball contact and interrupted actions. Verify keyboard/mouse and touch layouts. Save comparable visual evidence; passing tests alone is not visual approval.

Maintain editable source and provenance under repository publication conventions. Update Luke retarget configuration, clip metadata, asset manifest, validators and focused regression tests. Run npm run rig:check, npm run assets:check, node --test tests/*.test.mjs and npm run build -- --base=/TheArena/. Verify ordinary-URL loading, no old-model network requests and intentional Luke-load failure without substitution.

Deliver the compatible clip inventory, state mapping, joint ownership/blend contract, source maintenance instructions, test/build results, visual evidence and remaining limitations. Do not add mechanics, opponents or environment work. Stop after Part 2; report unresolved blockers honestly. Commit/push/deploy only within explicit authorization in the active conversation.
