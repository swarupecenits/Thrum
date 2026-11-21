import type { TextStyle } from 'react-native';

export const fonts = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemi: 'Geist_600SemiBold',
  sansBold: 'Geist_700Bold',
  mono: 'GeistMono_500Medium',
  /**
   * Fraunces, as static cuts in assets/fonts (React Native can't drive variable axes): soft, non-wonky
   * romans at display optical sizes and the wonky italic. Its figures are proportional, so numbers that
   * tick while you watch stay in Geist (`figure`).
   */
  serif: 'Fraunces_Display',
  serifItalic: 'Fraunces_DisplayItalic',
  serifMedium: 'Fraunces_Medium',
  serifSemi: 'Fraunces_SemiBold',
} as const;

export const typo = {
  /** One UI style page headers: big, light and low on the screen for one-handed reach. */
  hero: { fontFamily: fonts.serif, fontSize: 54, lineHeight: 60, letterSpacing: -1.6 },
  display: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 46, letterSpacing: -1 },
  serif: { fontFamily: fonts.serifMedium, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  /** Lower-case phrases with a voice: the daylist's name, a vibe. Set tight to stack up to four lines. */
  serifItalic: { fontFamily: fonts.serifItalic, fontSize: 26, lineHeight: 30, letterSpacing: -0.5 },
  title: { fontFamily: fonts.serifSemi, fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.serifSemi, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  /** A big number that changes while you look at it: fixed-width Geist digits. */
  figure: { fontFamily: fonts.sansSemi, fontSize: 26, lineHeight: 32, letterSpacing: -0.7, fontVariant: ['tabular-nums'] },
  headline: { fontFamily: fonts.sansSemi, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 },
  bodyMedium: { fontFamily: fonts.sansMedium, fontSize: 16, lineHeight: 22 },
  callout: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 20 },
  calloutMedium: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 17 },
  small: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16 },
  /** Technical labels: section kickers, codecs, timestamps. */
  label: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16 },
  button: { fontFamily: fonts.sansSemi, fontSize: 15, lineHeight: 20 },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof typo;

/** The most `T` lets the system font size scale text, so a big setting can't break a layout. */
export const MAX_FONT_SCALE = 1.35;

/**
 * `variant` shrunk for a text column narrower than the one it was set for. Size, leading and tracking
 * scale together, so the text breaks into the lines it would at `designedFor` px wide; the system font
 * size (capped as `T` caps it) counts against the column too. Never grows, and stops at `minPx` on screen.
 */
export function fitType(variant: TypeVariant, column: number, designedFor: number, fontScale: number, minPx: number): TextStyle | null {
  const t: TextStyle = typo[variant];
  const size = t.fontSize ?? 16;
  const scale = Math.min(fontScale || 1, MAX_FONT_SCALE);
  const k = Math.min(1, Math.max(minPx / (size * scale), column / (designedFor * scale)));
  if (k >= 1) return null;
  return {
    fontSize: size * k,
    lineHeight: t.lineHeight === undefined ? undefined : t.lineHeight * k,
    letterSpacing: (t.letterSpacing ?? 0) * k,
  };
}

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  page: 20,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 22,
  xl: 30,
  pill: 999,
} as const;

export const springs = {
  snappy: { damping: 22, stiffness: 340, mass: 0.7 },
  gentle: { damping: 22, stiffness: 190, mass: 0.9 },
  sheet: { damping: 28, stiffness: 280, mass: 0.9 },
  /** Mini player <-> Now Playing. Critically damped-ish: fast, no wobble at the end. */
  player: { damping: 30, stiffness: 260, mass: 1 },
} as const;

/** The portfolio's signature ease, cubic-bezier(0.22, 1, 0.36, 1). */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
