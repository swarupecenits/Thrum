import type { TextStyle } from 'react-native';

export const fonts = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemi: 'Geist_600SemiBold',
  sansBold: 'Geist_700Bold',
  mono: 'GeistMono_500Medium',
  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
} as const;

export const typo = {
  /** One UI style page headers: big, light and low on the screen for one-handed reach. */
  hero: { fontFamily: fonts.serif, fontSize: 54, lineHeight: 58, letterSpacing: -1.2 },
  display: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 44, letterSpacing: -0.8 },
  serif: { fontFamily: fonts.serif, fontSize: 28, lineHeight: 32, letterSpacing: -0.4 },
  quote: { fontFamily: fonts.serifItalic, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  title: { fontFamily: fonts.sansSemi, fontSize: 26, lineHeight: 32, letterSpacing: -0.7 },
  heading: { fontFamily: fonts.sansSemi, fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
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
