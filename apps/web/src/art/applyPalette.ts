import type { Art } from './index';
import type { Palette } from './palette';

/** Mirror the active palette into CSS variables (`--c0`, `--c1`, ...) and `data-palette`. */
export function bindPaletteCss(art: Art): void {
  const apply = (p: Palette): void => {
    const root = document.documentElement;
    root.dataset.palette = p.mode;
    root.style.setProperty('--c0', p.css.c0);
    root.style.setProperty('--c1', p.css.c1);
    root.style.setProperty('--player', p.css.player);
    root.style.setProperty('--accent', p.css.accent);
    root.style.setProperty('--food-arrow', `#${p.food.crumb[2].toString(16).padStart(6, '0')}`);
  };
  apply(art.palette);
  art.onPalette(apply);
}
