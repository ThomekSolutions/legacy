# Pixel Art Character Pipeline

This is the preferred character pipeline for Legacy.

## Goal

Legacy should stay pixel art. The target is not realism. The target is a beautiful, readable RPG style with modular visual equipment.

The character system should support:
- Base body.
- Skin tone.
- Hair.
- Visible armor.
- Visible helmet.
- Hats and cosmetics.
- Visible weapon.
- Visible shield.
- Visible cape.
- Mounts.
- Future cosmetics.

## Recommended Source Format

Use layered pixel art spritesheets.

Each layer is exported separately, but every layer shares the exact same frame size, frame count, animation timing, anchor point, and facing direction.

Good tools for authoring:
- Aseprite.
- LibreSprite.
- Pixelorama.
- Piskel for quick tests.

AI generation can help create a first draft, but the final assets should be cleaned in a pixel editor. The important part is alignment and readability, not raw generation quality.

## Frame Contract

For the current game renderer:
- Frame size: 100x100 px.
- Direction: facing right.
- Idle: 6 frames.
- Walk: 8 frames.
- Attack: 6 frames.
- Background: transparent.
- Export: horizontal PNG spritesheet.

Later, when the character art direction is locked, we can move to a cleaner production size such as 64x64 or 96x96. For now, 100x100 keeps compatibility with the existing soldier/orc asset pack and the current Phaser renderer.

## Layer Contract

Every layer must line up perfectly with the same invisible base character.

Layer examples:
- `body-human-idle.png`
- `skin-pale-idle.png`
- `hair-short-idle.png`
- `armor-iron-idle.png`
- `helmet-iron-cap-idle.png`
- `hat-witchHat-idle.png`
- `weapon-sword-idle.png`
- `shield-round-idle.png`
- `cape-red-idle.png`
- `mount-horse-brown-idle.png`

Equipment layers should contain only the equipment on transparent background. They should not redraw the full character.

## Visual Rules

Use:
- Crisp pixels.
- No antialiasing.
- Limited palette.
- Consistent outline thickness.
- High contrast between body, armor, weapon, and background.
- Bigger shapes than you think are necessary, because gameplay readability matters.

Avoid:
- Photorealistic details.
- Smooth brush shading.
- Tiny noisy pixels.
- Overly thin weapons.
- Low-contrast armor.
- Unaligned feet or hands between frames.

## Best Practical Workflow

1. Run `npm run generate:characters`.
2. The generator writes aligned PNG spritesheets into `assets/generated-characters`.
3. The generator writes `assets/generated-characters/catalog.json`, which is the source of truth for available slots, labels, rarities, and spritesheets.
4. Phaser loads the generated body, skin, hair, armor, helmet, hat, cape, weapon, shield, mount, and future cosmetic layers from the catalog.
5. Test in Phaser.
6. Improve the drawing functions in `tools/generate-pixel-characters.js`.
7. Regenerate the PNGs.
8. Keep alignment fixes in the generator so every equipment layer stays compatible.

## Adding Cosmetics

Add cosmetics by creating a new entry in the `layers` table in `tools/generate-pixel-characters.js`.

Each entry needs:
- `slot`, such as `hat`, `mount`, `cape`, `aura`, or `pet`.
- Stable `id`, such as `witchHat` or `blackHorse`.
- UI `label`.
- `rarity`: `common`, `rare`, `epic`, or `legacy`.
- A draw function or future imported handmade spritesheet path.

Then run:

```bash
npm run generate:characters
npm run verify:characters
```

Cosmetics are visual only for now. Unlocks, inventory, and shop behavior should use the existing catalog fields (`defaultUnlocked`, `rarity`) later instead of changing the rendering contract.

## Why This Is Better For Legacy

This keeps the game fully pixel art while still allowing deep customization. It is also much easier to scale than unique fixed sprites for every combination, because the game can combine layers at runtime.

The Phaser renderer already supports this direction: it can draw a base character plus separate visual layers for equipment and mounts. The next step is replacing the temporary procedural shapes with real pixel-art layer spritesheets.

That replacement is now started: `tools/generate-pixel-characters.js` creates the first local pixel-art paper-doll asset set, and `src/game.js` composes those generated layers at runtime.
