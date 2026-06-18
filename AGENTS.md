# Legacy Agent Guide

## Project Shape

Legacy is a playable browser RPG prototype.

- Client: Phaser in `src/game.js`
- Server: authoritative Node.js + WebSocket in `server.js`
- Static entry: `index.html`
- Styling/UI: `styles.css`
- Runtime assets: `assets/`
- Generated helpers: `tools/`
- Local persistence: `data/legacy-state.json` ignored by Git

## Core Rules

- Keep the game playable quickly. Prefer small, verified changes over large rewrites.
- Do not add page scroll. The game must fit the viewport.
- Preserve keyboard controls: `ZQSD`/`WASD`/arrows to move, mouse direction to attack.
- Preserve mobile controls: left joystick, right attack button, no browser gesture interference on the canvas.
- Keep the server authoritative for movement, attacks, warps, loot, deaths, and enemy behavior.
- Keep original source packs out of Git. Commit only optimized runtime assets under `assets/`.
- Do not commit `data/`, `artifacts/`, `node_modules/`, logs, or extracted source packs.
- Avoid absolute local paths in docs.

## Map And Biome Model

- `haven` is the monster-free hub.
- Combat maps are defined in `COMBAT_MAPS` in `server.js`.
- The first combat map keeps id `combat` for compatibility.
- Additional combat maps use ids like `combat2`, `combat3`, etc.
- Combat maps use `world.depth` to scale enemies.
- Portals are exact tiles. A player warps only when their current tile is `portal`.
- A combat map may have more than one portal via `world.portals`.
- Only depth 1 returns to `haven`; deeper maps return to their previous combat map.

## UI And Assets

- Default typography is `Fondamento` with `"Trebuchet MS", Georgia, serif` fallback; use it for site UI and Phaser text unless a specific asset requires otherwise.
- Buttons use `assets/ui/buttons/*`.
- Window frames use `assets/ui/windows/*`.
- Character layers and cosmetics are generated into `assets/generated-characters/`.
- `assets/generated-characters/catalog.json` is the source of truth for character slots, labels, rarities, defaults, and spritesheets.
- Add hats, mounts, capes, pets, auras, and future cosmetics through `tools/generate-pixel-characters.js`, then run `npm run generate:characters` and `npm run verify:characters`.
- For UI asset changes, prefer real cropped/generated assets over CSS approximations.
- Keep mobile HUD compact and check that text fits its frame.

## Required Verification

Run this before committing:

```bash
npm run check
```

For gameplay, also verify the relevant flow with one of:

- a local browser screenshot
- a small WebSocket test script
- a manual run on `http://localhost:3000`

If the server is already running after code changes, restart it before visual testing. Node does not hot reload `server.js`.

## Git

- Commit focused changes.
- Push to `origin/master` unless instructed otherwise.
- Keep generated verification images in `artifacts/`; they are ignored and should not be committed.
