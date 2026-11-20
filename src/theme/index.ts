import { DarkTheme, type Theme } from 'expo-router';

import { ACCENTS, bases, LIME, makePalette, type Palette } from './palette';
import { useNow } from '@/stores/now';
import { useSettings } from '@/stores/settings';

export { ACCENTS, bases, LIME, type AccentId, type AccentSwatch, type Palette, type ThemeId } from './palette';
export { EASE_OUT, fonts, radius, space, springs, typo, type TypeVariant } from './type';

export type BasePalette = Omit<Palette, 'accent' | 'onAccent'>;

/**
 * The accent, but only subscribed when `wanted`: with an adaptive accent every track change would
 * otherwise re-render every piece of text on screen.
 */
export function useAccentWhen(wanted: boolean): { color: string; on: string } {
  const accent = useSettings((s) => (wanted ? s.accent : null));
  const adaptive = useNow((s) => (accent === 'adaptive' ? s.accent : null));
  if (accent === 'adaptive') return adaptive ?? LIME;
  return ACCENTS.find((a) => a.id === accent) ?? LIME;
}

/** The accent in use: a fixed swatch, or (adaptive) the playing artwork's colour, lime as fallback. */
export function useAccent(): { color: string; on: string } {
  return useAccentWhen(true);
}

/** Theme colours without the accent, for components that never use it (cheaper to subscribe to). */
export function useBase(): BasePalette {
  return bases[useSettings((s) => s.theme)];
}

const cache = new Map<string, Palette>();

export function useTheme(): Palette {
  const theme = useSettings((s) => s.theme);
  const { color, on } = useAccent();
  // Stable identity per combination so memoized children don't re-render on every parent render.
  const key = `${theme}|${color}|${on}`;
  let palette = cache.get(key);
  if (!palette) {
    palette = makePalette(theme, color, on);
    if (cache.size > 32) cache.clear();
    cache.set(key, palette);
  }
  return palette;
}

export function navigationTheme(c: Palette): Theme {
  return {
    ...DarkTheme,
    dark: true,
    colors: {
      ...DarkTheme.colors,
      primary: c.accent,
      background: c.bg,
      card: c.bg,
      text: c.ink,
      border: c.line,
      notification: c.accent,
    },
  };
}
