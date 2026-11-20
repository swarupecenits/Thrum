import { memo } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { glyphs, type IconName } from './icon-glyphs';

export type { IconName };
export type IconWeight = 'regular' | 'bold' | 'fill' | 'duotone';

type Glyph = { r: string; b?: string; f?: string; t?: string; d?: string };

type IconProps = {
  name: IconName;
  color: string;
  size?: number;
  weight?: IconWeight;
  style?: StyleProp<ViewStyle>;
};

function pathFor(g: Glyph, weight: IconWeight): string {
  if (weight === 'fill') return g.f ?? g.r;
  if (weight === 'bold') return g.b ?? g.r;
  if (weight === 'duotone') return g.d ?? g.r;
  return g.r;
}

// RN-web makes every View `position: relative`, so an absolutely positioned sibling (a gradient fill) paints
// over a static <svg> whatever the order. Native always paints later siblings on top; match that on web.
const styles = StyleSheet.create({ web: { position: 'relative' } });
const webOrder = Platform.OS === 'web' ? styles.web : null;

function IconBase({ name, color, size = 22, weight = 'regular', style }: IconProps) {
  const glyph: Glyph = glyphs[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" style={webOrder ? [webOrder, style] : style} pointerEvents="none">
      {weight === 'duotone' && glyph.t ? <Path d={glyph.t} fill={color} opacity={0.22} /> : null}
      <Path d={pathFor(glyph, weight)} fill={color} />
    </Svg>
  );
}

export const Icon = memo(IconBase);
