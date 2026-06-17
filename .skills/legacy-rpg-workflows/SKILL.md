---
name: legacy-rpg-workflows
description: "Use when working on the Legacy browser RPG project for recurring workflows: adding or changing biomes, chained combat maps, portal/warp behavior, enemy depth scaling, Phaser map rendering, UI windows/buttons/assets, mobile controls, README/docs updates, validation, or Git push preparation."
---

# Legacy RPG Workflows

## Quick Start

Read `AGENTS.md` first. Then inspect the relevant local files before editing:

- Map, portals, enemy scaling, persistence: `server.js`
- Phaser rendering, player controls, portal labels, mobile input: `src/game.js`
- DOM/HUD/menu structure: `index.html`
- Responsive UI, buttons, windows, mobile HUD: `styles.css`
- Generated asset pipelines: `tools/`

Always run `npm run check` before commit/push.

## Map Or Biome Changes

Use `references/maps-and-biomes.md` when adding maps, changing biomes, portal flow, or enemy scaling.

Core rules:

- Keep `haven` as a monster-free hub.
- Keep first combat map id as `combat`.
- Add deeper combat maps through `COMBAT_MAPS`.
- Use `world.depth` for enemy scaling.
- Use `world.portals` for multiple exact-tile warps.
- Paint every portal tile in `createWorld()` and define the matching portal object in `world.portals`.
- Verify both portal coordinates and spawn coordinates.

After editing, test at least one WebSocket or browser traversal through the changed portal path.

## UI, Assets, And Mobile

Use `references/ui-and-mobile.md` when changing:

- buttons, windows, borders, dropdowns, HUD cards
- generated UI assets
- mobile layout or touch controls
- text that may overflow inside framed UI

Core rules:

- Use existing UI assets in `assets/ui/` instead of approximating with plain CSS.
- Keep no-scroll behavior on desktop and mobile.
- Make tap targets large enough and avoid depending on hover for gameplay.
- Check text fit in narrow/mobile viewports.

## Repeated User Requests

Treat these as established project preferences:

- "The game must be playable quickly" means implement a complete vertical slice, not a design-only answer.
- "Use the assets" means integrate the actual provided/cropped/generated assets, not a visual approximation.
- "Precise portal/attack" means exact tile or exact hitbox, no decorative trigger circle.
- "Mobile friendly" means canvas fills the viewport, no page scroll, touch controls work.
- "Show me why/where" means provide concrete screenshots, generated artifacts, or coordinates.

## Validation Checklist

Before final response:

- Run `npm run check`.
- Restart local Node server if testing server changes.
- Verify changed maps/portals via WebSocket snapshot or browser.
- For frontend/UI changes, capture or inspect at desktop and relevant mobile sizes.
- Ensure tracked docs/code contain no absolute local paths or user-specific machine paths.
- Keep `git status --short --branch` clean after commit if pushing.

## Final Response Style

Answer in French unless the user asks otherwise. Mention:

- files changed
- tests run
- commit hash and push status when applicable
- any remaining limitation or manual reload needed
