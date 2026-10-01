# TheArena working agreement

Read `PROJECT.md` before making changes. It contains the current scope, links, source map, and the next recommended milestone.

- Work only inside this repository; `main` is the deployment branch.
- Keep commits focused and do not overwrite unrelated user changes.
- Run `npm run build` for every code, asset, or configuration change.
- When controls change, verify both keyboard/mouse and touch layouts.
- Preserve the generic, original-art direction unless the user explicitly supplies rights-cleared assets.
- Keep gameplay orchestration in `src/main.js`; replaceable player, arena, and audio implementations belong in their respective modules.

## Versioned player-rig migration

- Production continues to use the pinned `legacy-luke-v1` 17-bone contract until both new player GLBs exist and pass the staged contract. Never silently treat the legacy rig as the new rig.
- The staged `game-humanoid-v2` contract is exactly 22 deform bones with plain names: Hips, Spine, Spine1, Spine2, Neck, Head, LeftShoulder, LeftArm, LeftForeArm, LeftHand, RightShoulder, RightArm, RightForeArm, RightHand, LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase, RightUpLeg, RightLeg, RightFoot, RightToeBase.
- A `mixamorig:` source prefix may be normalized at load; runtime names remain plain. The naming convention does not authorize or imply use of Mixamo assets.
- V2 limits are one skinned mesh, one skin, 1.9-2.2 m height, at most 8,000 triangles, and at most 1.5 MB per GLB. Shoulder, three-segment spine, and toe-base joints are mandatory.
- Rig and animation edits belong in Blender source and repeatable export scripts; never hand-edit a GLB.
- A future production fallback must display a visible `FALLBACK PLAYER` badge, and CI must fail if either required v2 GLB falls back. This is not enabled during the Step 1 staged-contract pass.
