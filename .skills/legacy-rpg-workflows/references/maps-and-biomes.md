# Maps And Biomes Reference

## Current Model

`server.js` owns world definitions and simulation.

- `worlds.haven`: hub, no enemies.
- `COMBAT_MAPS`: ordered combat depths.
- `worlds[map.id]`: generated from each `COMBAT_MAPS` entry.
- `world.depth`: increases enemy strength and loot rarity.
- `world.portals`: array of exact-tile warp definitions.
- `snapshotWorld()` sends both `portal` and `portals`; keep `portal` for compatibility.

## Adding A Combat Map

1. Add a new object to `COMBAT_MAPS`.
2. Link previous map `next` to the new id.
3. Set the new map `previous` to the prior id.
4. Choose `floor`, `accent`, and `hazard` from existing tile types:
   - `grass`, `path`, `village`, `ruin`, `grave`, `marsh`, `water`, `bridge`, `forest`, `rubble`, `tomb`, `portal`
5. Ensure `createWorld(kind)` paints:
   - an entrance/back portal tile
   - a deeper portal tile if `map.next` exists
   - passable corridors from spawn to portal
6. Ensure portal definitions match painted portal tiles.
7. Verify with `npm run check` and a WebSocket snapshot.

## Portal Conventions

Portal object fields:

```js
{
  x: 40 * TILE,
  y: 10 * TILE,
  target: "combat2",
  label: "Deeper",
  spawnX: 40 * TILE,
  spawnY: 70 * TILE
}
```

Conventions:

- Back portal: `(40,72)`.
- Deeper portal: `(40,10)`.
- Enter a combat map near bottom: spawn `(40,70)`.
- Return to previous combat map near top: spawn `(40,10)`.
- Return to hub: spawn `(40,43)`.

If changing these conventions, update the overview artifacts and explain the new flow.

## Enemy Scaling

Use `makeEnemy(worldId, levelBoost)` and `world.depth`.

Do not add new monster art until assets are provided. For now, keep Orc visuals and scale:

- level
- HP/max HP
- damage
- speed slightly
- enemy count per depth

## Suggested Verification Script Shape

Use a short WebSocket script to connect, send `hello`, walk into a portal, then inspect:

- `snapshot.id`
- `snapshot.name`
- `snapshot.portals`
- sample `snapshot.enemies` levels and HP

Restart the server before testing if `server.js` changed.
