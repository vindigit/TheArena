# TheArena working agreement

Read `PROJECT.md` before making changes. It contains the current scope, links, source map, and the next recommended milestone.

- Work only inside this repository; `main` is the deployment branch.
- Keep commits focused and do not overwrite unrelated user changes.
- Run `npm run build` for every code, asset, or configuration change.
- When controls change, verify both keyboard/mouse and touch layouts.
- Preserve the generic, original-art direction unless the user explicitly supplies rights-cleared assets.
- Keep gameplay orchestration in `src/main.js`; replaceable player, arena, and audio implementations belong in their respective modules.
