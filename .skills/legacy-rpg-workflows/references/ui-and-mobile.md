# UI And Mobile Reference

## UI Asset Rules

Use actual assets under `assets/ui/`:

- Buttons: `assets/ui/buttons/button-long-*.png`
- Window frames: `assets/ui/windows/window-*.png`
- Shared stone/slot/divider assets: `assets/ui/ui-*.png`

Prefer `border-image` and generated/cropped UI files over plain CSS approximations.

## Text Fit

Always check narrow/mobile text in:

- stat cards, especially HP values like `100/100`
- area names
- buttons
- dropdown options
- portal labels

For mobile HUD, reduce only the specific overflowing text when possible instead of shrinking the whole UI.

## Mobile Rules

- `html` and `body` must remain `overflow: hidden`.
- Use `100dvh` and safe-area env values for mobile viewport.
- Canvas/game area must use `touch-action: none`.
- Gameplay cannot depend on hover.
- Controls:
  - left joystick for movement
  - right attack button / right-side touch for attack
  - movement touch must not trigger attack

## Frontend Verification

For UI or mobile changes:

1. Run `npm run check`.
2. Open or emulate desktop and mobile.
3. Check no page scroll:
   - `document.body.scrollHeight <= innerHeight`
   - `document.body.scrollWidth <= innerWidth`
4. Capture a screenshot when visual quality matters.

If the in-app browser fails, use Chrome headless/CDP as fallback.
