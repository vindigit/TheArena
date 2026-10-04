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

The start screen offers two complete recovered NBA 2K9 player assemblies with selected recovered motion clips adapted to the live ball and gameplay timing. [Recovered player documentation](docs/RECOVERED_PLAYER.md) describes generation, rig normalization, motion mapping, tests and limitations. Loading failure shows an explicit error. Historical Luke source and rig tests remain available separately; the ordinary game no longer loads Luke.
