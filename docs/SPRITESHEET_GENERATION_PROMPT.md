# Spritesheet Generation Prompt

This document defines the prompt format for generating character, equipment, cape, weapon, shield, and mount spritesheets that can be layered in Legacy's Phaser paper-doll renderer.

## Art Direction

Legacy uses pixel art. "Beautiful" means clean silhouettes, readable poses, coherent palette, strong contrast, and consistent animation. It does not mean realistic rendering.

Do not generate:
- Photorealistic art.
- Painted fantasy illustration.
- 3D render style.
- Smooth gradients.
- Blurry edges.
- Anti-aliased outlines.
- Semi-realistic faces or anatomy.

Generate:
- Crisp pixel art.
- Limited palette.
- Readable medieval fantasy shapes.
- Clear top-down / 3-quarter proportions.
- Consistent pixel scale across body, equipment, weapons, capes, and mounts.

## Core Prompt

```text
Create a clean pixel art RPG character spritesheet for a top-down / 3-quarter 2D browser game.

STRICT TECHNICAL FORMAT:
- Transparent PNG background.
- Horizontal spritesheet only.
- Each frame is exactly 100x100 pixels.
- Character faces RIGHT.
- Keep the character centered on the same feet position in every frame.
- No camera movement, no zoom, no cropping.
- Pixel art, crisp edges, no blur, no antialiasing.
- No text, no labels, no grid lines, no watermark.
- Same scale and proportions across all frames.
- Leave enough empty transparent space around the character for weapons, shields, capes, and mounts.

ANIMATION:
Generate exactly [FRAME_COUNT] frames for the animation: [ANIMATION_NAME].
The motion should loop smoothly.
The pose must match a small fantasy RPG character.

STYLE:
Dark fantasy medieval RPG pixel art, readable at small size, similar to classic 16-bit / 32-bit RPG sprites.
Use strong silhouette design, clean clusters of pixels, limited palette, and consistent outline weight.
Do not use realistic rendering, painted shading, 3D lighting, blur, or anti-aliased edges.
The asset should be usable in Phaser as a spritesheet.

LAYER TYPE:
Generate only this visual layer: [LAYER_DESCRIPTION].
If this is equipment, draw ONLY the equipment layer on transparent background, perfectly aligned to where it would sit on the base character.
Do not draw the full character unless the layer type is "base body".

ASSET DETAILS:
[ASSET_DESCRIPTION]
```

## Animation Replacements

Use these exact frame counts:

```text
[ANIMATION_NAME] = idle
[FRAME_COUNT] = 6
```

```text
[ANIMATION_NAME] = walk
[FRAME_COUNT] = 8
```

```text
[ANIMATION_NAME] = attack
[FRAME_COUNT] = 6
```

## Layer Descriptions

Use one of these layer descriptions, or a very close variant:

```text
base body, human adventurer without helmet, armor, weapon, shield or cape
```

```text
iron helmet layer only
```

```text
leather armor chest layer only
```

```text
one-handed sword weapon layer only
```

```text
one-handed axe weapon layer only
```

```text
wooden staff weapon layer only
```

```text
round shield layer only
```

```text
tower shield layer only
```

```text
red cape layer only
```

```text
brown horse mount layer only, no rider
```

## Example: Sword Attack

```text
Create a clean pixel art RPG character spritesheet for a top-down / 3-quarter 2D browser game.

STRICT TECHNICAL FORMAT:
- Transparent PNG background.
- Horizontal spritesheet only.
- Each frame is exactly 100x100 pixels.
- Character faces RIGHT.
- Keep the character centered on the same feet position in every frame.
- No camera movement, no zoom, no cropping.
- Pixel art, crisp edges, no blur, no antialiasing.
- No text, no labels, no grid lines, no watermark.
- Same scale and proportions across all frames.
- Leave enough empty transparent space around the character for weapons, shields, capes, and mounts.

ANIMATION:
Generate exactly 6 frames for the animation: attack.
The motion should loop smoothly.
The pose must match a small fantasy RPG character.

STYLE:
Dark fantasy medieval RPG, readable at small size, similar to classic 2D pixel art RPG sprites.
The asset should be usable in Phaser as a spritesheet.

LAYER TYPE:
Generate only this visual layer: one-handed sword weapon layer only.
Draw ONLY the sword on transparent background, perfectly aligned to where it would sit in the character's right hand.
Do not draw the full character.

ASSET DETAILS:
Iron short sword, simple medieval blade, visible slash motion across the 6 attack frames, aligned for a right-facing character.
```

## Example: Brown Horse Walk

```text
Create a clean pixel art RPG character spritesheet for a top-down / 3-quarter 2D browser game.

STRICT TECHNICAL FORMAT:
- Transparent PNG background.
- Horizontal spritesheet only.
- Each frame is exactly 100x100 pixels.
- Character faces RIGHT.
- Keep the character centered on the same feet position in every frame.
- No camera movement, no zoom, no cropping.
- Pixel art, crisp edges, no blur, no antialiasing.
- No text, no labels, no grid lines, no watermark.
- Same scale and proportions across all frames.
- Leave enough empty transparent space around the character for weapons, shields, capes, and mounts.

ANIMATION:
Generate exactly 8 frames for the animation: walk.
The motion should loop smoothly.
The pose must match a small fantasy RPG character.

STYLE:
Dark fantasy medieval RPG, readable at small size, similar to classic 2D pixel art RPG sprites.
The asset should be usable in Phaser as a spritesheet.

LAYER TYPE:
Generate only this visual layer: brown horse mount layer only, no rider.
Draw ONLY the horse mount on transparent background, perfectly aligned under where the rider would sit.
Do not draw the rider.

ASSET DETAILS:
Brown medieval riding horse, side-facing to the right, compact readable silhouette, saddle included, no rider.
```

## Required File Naming

Use this naming pattern:

```text
[layer]-[variant]-[animation].png
```

Examples:

```text
body-human-idle.png        600x100
body-human-walk.png        800x100
body-human-attack.png      600x100

weapon-sword-idle.png      600x100
weapon-sword-walk.png      800x100
weapon-sword-attack.png    600x100

armor-iron-idle.png        600x100
armor-iron-walk.png        800x100
armor-iron-attack.png      600x100

mount-horse-brown-idle.png     600x100
mount-horse-brown-walk.png     800x100
mount-horse-brown-attack.png   600x100
```

## Integration Checklist

- Transparent PNG background.
- Horizontal spritesheet.
- 100x100 pixels per frame.
- Right-facing only for now.
- Idle has 6 frames.
- Walk has 8 frames.
- Attack has 6 frames.
- Equipment layers contain only the equipment, not the full character.
- All layers use the exact same anchor position and scale.
- No grid, labels, text, watermark, or background.
