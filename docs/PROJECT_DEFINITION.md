# Legacy - Project Definition

Legacy is a persistent 2D web roguelike where each character has only one life, but the world, families, graves, relics, and rankings survive after death.

## Playable MVP Goal

The first goal is not the full MMORPG yet. The first goal is a playable browser vertical slice that proves the game identity in under 5 minutes:

1. Create a character and a house.
2. Explore a top-down map.
3. Fight enemies in real time.
4. Pick up loot.
5. Grow stronger quickly.
6. Die permanently.
7. See the grave, records, family renown, and relics persist in the Hall of Legends.

## Already Prototyped

- Top-down 2D canvas.
- Procedural map with forests, marshes, ruins, water, and graves.
- Monster-free starting haven.
- Combat world accessible through a portal, with a return portal back to the haven.
- Real-time combat: keyboard movement, mouse-aimed attacks.
- Soldier sprites for the player and Orc sprites for enemies.
- 16x16 terrain textures, tinted together to keep a dark and coherent mood.
- Loot and fast progression.
- Local permanent death.
- Persistent dynasty through `localStorage`.
- Graves, records, and relics in a local Hall of Legends.
- Simple world event: ash portal.

## Production Direction

The current prototype should stay simple until the core is fun. Recommended next steps:

1. Integrate the pixel art asset pack.
2. Replace canvas shapes with sprites.
3. Add an inventory and equipment screen.
4. Add a Node.js + WebSocket backend for multiple players on a small map.
5. Move persistence to PostgreSQL.
6. Add accounts, server-side dynasties, public graves, and a shareable Hall of Legends page.

## Target Stack

- Frontend: Vite + TypeScript + Phaser, or native canvas while the prototype stays small.
- Real time: Node.js with Colyseus or Socket.IO.
- Database: PostgreSQL.
- Cache/session: Redis when multiplayer grows.
- Deployment: Docker, separate EU/US servers, CDN for assets.
- Solana wallet: Phantom connection only for gating/cosmetics, with no NFT or competitive advantage.

## Asset Pack

Send the pack as a `.zip` in chat if the interface allows it, or place it in the project folder, for example:

`C:\Users\thoma\Documents\Legacy\assets-pack.zip`

Most useful for integration:

- player sprites in 4 directions;
- enemies;
- ground/forest/water/ruins/cemetery tileset;
- objects/loot;
- pixel fantasy UI;
- attack/death/portal effects.

If the pack contains a license or `README` file, keep it in the zip: I will use it to respect names, tile sizes, and restrictions.
