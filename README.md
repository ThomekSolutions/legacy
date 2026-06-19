# Legacy

Playable V1 multiplayer prototype based on the design prompt.

## Run The Prototype

Install dependencies once:

`npm install`

Start the server:

`npm start`

Then open:

`http://localhost:3000`

## Deploy On Render

This repo includes a `render.yaml` Blueprint for a free Render Web Service.

1. Push the repository to GitHub.
2. In Render, create a new Blueprint from the repo.
3. Set `PUBLIC_ORIGIN` to the deployed URL, for example `https://legacy.onrender.com`.
4. Optionally set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` if bot verification is enabled.
5. Deploy.

The free Blueprint does not use a persistent disk, so `legacy-state.json` can be reset by Render restarts or redeploys. Add a Render disk and set `DATA_DIR=/var/data` later if you upgrade to a paid instance.

## Current Gameplay

- Create a character and a House.
- Connect to an authoritative Node/WebSocket server.
- Start in a monster-free haven.
- Step onto the portal tile to enter the first combat biome.
- Progress through five combat depths, each with a distinct biome.
- Use the portal at the far end of a combat map to go deeper.
- Use the return portal to go back to the previous map; only depth 1 returns to the haven.
- See other players connected to the same server.
- Explore a top-down 2D map without page scrolling.
- Attack with `Left click` or `Space`, aimed toward the mouse.
- Move with `ZQSD`, `WASD`, or the arrow keys.
- Pick up loot.
- Fight stronger Orcs as the maps get deeper.
- Survive, grow stronger, then die permanently.
- The dynasty, graves, records, and some relics persist in the server Hall of Legends.
- The player uses Soldier sprites and enemies use Orc sprites from the provided pack.
- The maps use 16x16 textures from the seamless patterns pack, harmonized by tint in the renderer.

## V1 Tech

- Static server + WebSocket: `server.js`
- Local V1 persistence: `data/legacy-state.json`
- Client: `src/game.js`
- Assets: `assets/characters` and `assets/tiles`

The server validates movement, attacks, loot, deaths, levels, graves, and relics.

## Integrated Assets

Runtime character sprites are stored in:

`assets/characters`

Generated customizable character layers are stored in:

`assets/generated-characters`

Map tiles and generated RPG textures are stored in:

`assets/tiles`

UI buttons and window frames are stored in:

`assets/ui`

The original extracted source packs are intentionally ignored by Git. Keep only optimized runtime assets in the repository.

## Add New Assets

Place new source packs outside the repository or in an ignored local folder, then extract only the runtime sprites, tiles, or UI pieces needed by the game into `assets/`.

Regenerate procedural assets with:

`npm run generate:characters`
