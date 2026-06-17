# Legacy

Playable V1 multiplayer prototype based on the design prompt.

## Run The Prototype

Install dependencies once:

`npm install`

Start the server:

`npm start`

Then open:

`http://localhost:3000`

## Current Gameplay

- Create a character and a House.
- Connect to an authoritative Node/WebSocket server.
- Start in a monster-free haven.
- Step onto the portal tile to enter the combat ruins.
- Return to the haven through the ruins portal.
- See other players connected to the same server.
- Explore a top-down 2D map without page scrolling.
- Attack with `Left click` or `Space`, aimed toward the mouse.
- Move with `ZQSD`, `WASD`, or the arrow keys.
- Pick up loot.
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

Sprites used by the game are copied here:

`C:\Users\thoma\Documents\Legacy\assets\characters`

The full extracted zip remains available here:

`C:\Users\thoma\Documents\Legacy\assets\characters-pack`

The 16x16 textures used by the maps are here:

`C:\Users\thoma\Documents\Legacy\assets\tiles`

The full extracted pack remains available here:

`C:\Users\thoma\Documents\Legacy\assets\tiles-pack`

## Send An Asset Pack

The simplest way: drop the `.zip` into this folder:

`C:\Users\thoma\Documents\Legacy\assets-pack.zip`

Then simply say that the file is in place. I will extract it into a dedicated folder and replace prototype shapes with sprites/tiles from the pack.
