# TheArena — project handoff

## Canonical locations

- **Repository:** `https://github.com/vindigit/TheArena`
- **Live demo:** `https://vindigit.github.io/TheArena/`
- **Local checkout:** `C:\\Users\\valexander\\Documents\\Codex\\2026-09-27\\codex-mcp-add-scenario-url-https\\TheArena`
- **Primary branch:** `main`

The Git repository is the source of truth. Work in this checkout, commit focused changes, and push to `main`; GitHub Pages publishes the production build.

## Current playable slice

The initial release is a browser-based, third-person solo basketball demo with:

- One indoor arena, player, basketball, hoop, backboard, and net
- Keyboard/mouse and touch controls
- Dribbling, jump shots, layups, dunks, a two-minute run, and reset
- Procedural PS2-era visual treatment and synthesized gameplay audio

All current art and audio are original procedural placeholders—no NBA marks or real-person likenesses are included.

## Project rules

- Keep the PS2/early-2000s console look: chunky silhouettes, readable textures, bold contrast, and focused post-processing.
- Preserve both desktop and touch playability whenever movement or controls change.
- Keep third-party/generated assets clearly licensed for a public browser demo before committing them.
- Prefer replacing a procedural asset behind its existing module boundary instead of mixing asset-loading logic into gameplay code.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Game loop, input, camera, ball interactions, shooting state, HUD |
| `src/player.js` | Player model, animation state, dribble attachment points |
| `src/arena.js` | Court, arena, basket, net, lighting, collision references |
| `src/audio.js` | Synthesized bounce, swish, rim, and crowd/game feedback |
| `src/styles.css` | HUD, start screen, and responsive touch controls |
| `.github/workflows/pages.yml` | GitHub Pages build and deployment |

## Resume workflow

```powershell
cd C:\Users\valexander\Documents\Codex\2026-09-27\codex-mcp-add-scenario-url-https\TheArena
npm ci
npm run dev
```

Before committing gameplay or visual changes, run:

```powershell
npm run build
```

Then test desktop controls and a narrow touch viewport. A push to `main` triggers the Pages deployment; verify the live URL after the workflow finishes.

## Recommended next milestone: asset pipeline

Replace the procedural placeholders in a deliberately small order:

1. Create a style guide from the approved PS2 reference look.
2. Generate and validate a generic rigged player, basketball, court/arena materials, and gameplay sound set.
3. Optimize and export web-ready files (GLB/textures/audio) into a documented `public/assets/` structure.
4. Swap one asset category at a time, preserving the current gameplay interfaces.
5. Rebuild, test desktop and touch, then deploy.

This keeps the present game stable while visual quality improves in controlled passes.
