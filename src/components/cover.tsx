import { Image } from 'expo-image';
import { memo, useId } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useArtwork } from '@/audio/artwork';
import type { ArtworkSize } from '@/audio/native';
import { coverSpec } from '@/lib/covers';
import type { CoverSpec } from '@/lib/types';
import { fonts, useBase } from '@/theme';

type CoverProps = {
  albumId: string | null | undefined;
  trackId: string | null | undefined;
  /** Album or track title: seeds the generated cover and its initials. */
  label: string;
  size: number;
  rounded?: number;
  /** Defaults to 'lg' above 160pt. */
  art?: ArtworkSize;
  /** Generated covers use this instead of the album id (playlists, mixes). */
  seed?: string;
  style?: StyleProp<ViewStyle>;
};

function CoverBase({ albumId, trackId, label, size, rounded, art, seed, style }: CoverProps) {
  const c = useBase();
  const result = useArtwork(albumId, trackId, art ?? (size > 160 ? 'lg' : 'sm'));
  const r = rounded ?? Math.max(4, Math.round(size * 0.07));
  return (
    <View
      style={[styles.frame, { width: size, height: size, borderRadius: r, backgroundColor: c.surface2 }, style]}
      accessibilityIgnoresInvertColors>
      {result?.uri ? (
        <Image
          source={{ uri: result.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={140}
          recyclingKey={result.uri}
          cachePolicy="memory"
        />
      ) : result ? (
        <GeneratedCover seed={seed ?? albumId ?? trackId ?? label} label={label} size={size} round={r * 2 >= size} />
      ) : null}
    </View>
  );
}

export const Cover = memo(CoverBase);

type GeneratedProps = {
  seed: string;
  label: string;
  size: number;
  initials?: boolean;
  /** Drawn in a circle (artists): the initials move in from the corner, which the circle would clip. */
  round?: boolean;
};

function Shape({ spec, glow }: { spec: CoverSpec; glow: string }) {
  const accent = spec.colors[2];
  switch (spec.shape) {
    case 'orb':
      return (
        <>
          <Circle cx="64" cy="38" r="44" fill={`url(#${glow})`} />
          <Circle cx="64" cy="38" r="11" fill={accent} opacity={0.85} />
        </>
      );
    case 'rings':
      return (
        <G fill="none" stroke={accent}>
          {[10, 20, 30, 40, 50].map((r, i) => (
            <Circle key={r} cx="58" cy="44" r={r} strokeWidth={1.4} opacity={0.5 - i * 0.08} />
          ))}
        </G>
      );
    case 'grid':
      return (
        <G fill={accent}>
          {Array.from({ length: 36 }, (_, i) => (
            <Circle
              key={i}
              cx={18 + (i % 6) * 13}
              cy={18 + Math.floor(i / 6) * 13}
              r={i % 7 === 0 ? 2.6 : 1.3}
              opacity={i % 7 === 0 ? 0.9 : 0.42}
            />
          ))}
        </G>
      );
    case 'wave':
      return (
        <G fill="none" stroke={accent} strokeLinecap="round">
          {[0, 1, 2].map((i) => (
            <Path
              key={i}
              d={`M-10 ${44 + i * 12} C 15 ${24 + i * 12}, 35 ${64 + i * 12}, 60 ${44 + i * 12} S 95 ${24 + i * 12}, 120 ${44 + i * 12}`}
              strokeWidth={2.4 - i * 0.5}
              opacity={0.75 - i * 0.22}
            />
          ))}
        </G>
      );
    default:
      return (
        <G stroke={accent} strokeWidth={7}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Line key={i} x1={-20 + i * 26} y1="-20" x2={-20 + i * 26 + 60} y2="120" opacity={0.08 + (i % 3) * 0.06} />
          ))}
        </G>
      );
  }
}

/** Deterministic generated artwork for music without a cover: same album, same cover, everywhere. */
function GeneratedCoverBase({ seed, label, size, initials = true, round = false }: GeneratedProps) {
  const spec = coverSpec(seed, label);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const bgId = `bg${uid}`;
  const glowId = `gl${uid}`;
  const rad = (spec.angle * Math.PI) / 180;
  const dx = Math.cos(rad) * 0.5;
  const dy = Math.sin(rad) * 0.5;
  const [a, b, accent] = spec.colors;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id={bgId} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>
            <Stop offset="0" stopColor={a} />
            <Stop offset="1" stopColor={b} />
          </LinearGradient>
          <RadialGradient id={glowId} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={accent} stopOpacity={0.55} />
            <Stop offset="1" stopColor={accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100" height="100" fill={`url(#${bgId})`} />
        <G transform={`rotate(${spec.rotation} 50 50)`}>
          <Shape spec={spec} glow={glowId} />
        </G>
      </Svg>
      {initials && size >= 64 && spec.initials ? (
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[
            styles.initials,
            {
              color: accent,
              fontSize: Math.round(size * 0.26),
              lineHeight: Math.round(size * 0.3),
              left: size * (round ? 0.2 : 0.09),
              bottom: size * (round ? 0.16 : 0.06),
            },
          ]}>
          {spec.initials}
        </Text>
      ) : null}
    </View>
  );
}

export const GeneratedCover = memo(GeneratedCoverBase);

type MosaicProps = {
  /** Up to four [albumId, trackId, label] tuples from distinct albums. */
  tiles: { albumId: string; trackId: string; label: string }[];
  seed: string;
  label: string;
  size: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
};

/** Playlist artwork: a 2x2 of its first albums, one cover when there aren't four, generated when empty. */
function MosaicCoverBase({ tiles, seed, label, size, rounded, style }: MosaicProps) {
  const c = useBase();
  const r = rounded ?? Math.max(4, Math.round(size * 0.07));
  if (tiles.length < 4) {
    const t = tiles[0];
    if (!t) {
      return (
        <View style={[styles.frame, { width: size, height: size, borderRadius: r, backgroundColor: c.surface2 }, style]}>
          <GeneratedCover seed={seed} label={label} size={size} />
        </View>
      );
    }
    return <Cover albumId={t.albumId} trackId={t.trackId} label={t.label} size={size} rounded={r} style={style} />;
  }
  const half = size / 2;
  return (
    <View style={[styles.frame, styles.mosaic, { width: size, height: size, borderRadius: r, backgroundColor: c.surface2 }, style]}>
      {tiles.slice(0, 4).map((t) => (
        <Cover
          key={t.albumId + t.trackId}
          albumId={t.albumId}
          trackId={t.trackId}
          label={t.label}
          size={half}
          rounded={0}
          art={size > 260 ? 'lg' : 'sm'}
        />
      ))}
    </View>
  );
}

export const MosaicCover = memo(MosaicCoverBase);

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  mosaic: { flexDirection: 'row', flexWrap: 'wrap' },
  initials: { position: 'absolute', fontFamily: fonts.serif, opacity: 0.92, letterSpacing: -0.5 },
});
