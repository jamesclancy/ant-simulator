# Art pipeline

All game art is pixel art authored as code, so there are no binary sprite assets to keep in sync.

```
apps/web/src/art/
  palette.ts        single source of colour: terrain (T) + per-mode colony/player/scent palettes
  pixels.ts         Px buffer (ellipse, line, outline, ASCII grids) and hash helpers
  atlas.ts          one nearest-neighbour canvas texture; sprites are draw functions
  index.ts          Art: registers every sprite, hands out textures, switches palettes
  ground.ts         repeating lawn tile + seeded decor + rain puddles
  sprites/          ants (4 walk / 4 food / 4 dirt / 2 fight frames per caste), world, creatures, nest
  applyPalette.ts   mirrors the palette into CSS variables
apps/web/scripts/brand.mjs   the pixel ant mark shared by the PWA and native icon generators
```

## Rules of thumb

- **Atlas rectangles never move.** A palette change redraws the pixels in place, so every `Texture`
  already handed to a layer shows the new colours with no re-fetch.
- **Animation is a texture swap.** The ant `ParticleContainer` uses dynamic `uvs`; walk/carry/fight
  frames are picked per ant per frame. Reduce motion shows the standing pose.
- **Pixels stay square.** Headings are snapped to 16 directions, positions to whole world units, the
  camera to whole device pixels (`Camera.snapToPixels`) and zoom to `ZOOM_STEPS` (wheel steps, pinch
  settles on release). Surface art is 2 world units per art pixel, nest art 1.
- **Colour is never the only cue.** Colony 0 has a round abdomen and a pale spot, colony 1 a pointed
  abdomen with two pale bands, the player a bright stripe. HUD pips are a circle and a diamond.

## Accessibility palettes

Settings → Display → Colour palette: default, deuteranopia, protanopia, tritanopia, high contrast.
`apps/web/test/palette.test.ts` simulates each deficiency (Machado 2009) and asserts the colonies, the
player and every scent layer stay apart and contrast with the lawn.

## Icons and splash

```bash
node apps/web/scripts/generate-icons.mjs
node apps/mobile/scripts/make-placeholder-art.mjs && pnpm --filter @ant/mobile assets
```

## Font

Pixelify Sans (SIL OFL 1.1), bundled in `apps/web/src/assets/fonts/` with its licence.
