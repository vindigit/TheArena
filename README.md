# TheArena

A solo basketball demo in the browser, styled after early 2000s console games. Play on desktop with a keyboard and mouse or on a phone with the on-screen controls.

## Play

The live build is published at https://vindigit.github.io/TheArena/.

Desktop controls:

- WASD moves; the mouse turns the camera; Shift sprints.
- Hold and release Space for a jump shot.
- F makes a layup near the basket, or a dunk when sprinting into it.
- R resets the run.

On a touch screen, use the left stick to move, drag the court to turn the camera, and use RUN, FINISH, and HOLD SHOOT on the right. RESET RUN starts a new two-minute run.

## Develop

Run npm ci, then npm run dev.

This first playable build uses original procedural geometry and synthesized sounds. The player and arena contain no NBA team marks or real-player likenesses. The source is structured so game-ready character, arena, ball, texture, and sound assets can replace the procedural parts in a later asset pass.
