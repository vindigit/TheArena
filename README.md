# TheArena

A solo basketball demo in the browser, styled after early 2000s console games. Play on desktop with a keyboard and mouse or on a phone with the on-screen controls.

## Play

The live build is published at https://vindigit.github.io/TheArena/.

For the repository layout, current implementation status, and deployment path, see [PROJECT.md](PROJECT.md).

Desktop controls:

- WASD moves; the mouse turns the camera; Shift sprints.
- Hold and release Space for a jump shot.
- F makes a layup near the basket, or a dunk when sprinting into it.
- R resets the run.

On a touch screen, use the left stick to move, drag the court to turn the camera, and use RUN, FINISH, and HOLD SHOOT on the right. RESET RUN starts a new two-minute run.

## Develop

Run npm ci, then npm run dev.

The [asset pipeline](docs/ASSET_PIPELINE.md) records the PS2-era art direction, replacement interfaces, runtime budgets, generation recipes, and acceptance checks. Run `npm run assets:check` and `npm run build` when changing an asset.

The ordinary URL always loads supplied Luke. His uniform and appearance are preserved; model-load failure shows an error. The former player selector and old character fallback are removed. [Luke's rig contract](docs/PLAYER_ASSET.md) describes the canonical asset, editable source, baseline posing and animation target. [Animation v3](docs/ANIMATION_V3.md) documents the current runtime behavior and remaining browser-review requirements; [animation source credits and terms](public/assets/animation-credits.txt) cover the integrated motion data. `npm run rig:check` validates Luke's exact rest transforms, inverse bind matrices and skinning. The previous hybrid dribble clip is superseded and is no longer shipped.
