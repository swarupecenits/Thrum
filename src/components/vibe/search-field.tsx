import { useIsFocused } from 'expo-router';
import { useEffect, useState, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeInDown, FadeOutUp, LayoutAnimationConfig } from 'react-native-reanimated';

import { IconButton } from '../buttons';
import { Icon } from '../icon';
import { T } from '../text';
import { withAlpha } from '@/lib/color';
import { VIBE_EXAMPLES } from '@/lib/vibe';
import { fonts, radius, space, useTheme } from '@/theme';

export const SEARCH_FIELD_H = 48;
/** The field with its padding, as it pins under the top bar. */
export const SEARCH_BAR_H = SEARCH_FIELD_H + space.sm * 2;
export const MAX_QUERY = 80;

const HINTS = ['Songs, artists or a vibe', ...VIBE_EXAMPLES.map((e) => `Try \u201c${e}\u201d`)];
const HINT_MS = 3200;

/** The placeholder, cycling through things you can say. Only ticks while the tab is on screen. */
function RotatingHint() {
  const focused = useIsFocused();
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!focused) return;
    const id = setInterval(() => setAt((n) => (n + 1) % HINTS.length), HINT_MS);
    return () => clearInterval(id);
  }, [focused]);
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.hint}>
      <LayoutAnimationConfig skipEntering skipExiting>
        <Animated.View key={at} entering={FadeInDown.duration(280)} exiting={FadeOutUp.duration(200)} style={styles.hintLine}>
          <T variant="body" color="ink4" numberOfLines={1}>
            {HINTS[at]}
          </T>
        </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}

type SearchFieldProps = {
  ref?: Ref<TextInputInstance>;
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onClear: () => void;
  testID?: string;
};

export function SearchField({ ref, value, onChangeText, onSubmit, onFocus, onBlur, onClear, testID }: SearchFieldProps) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, { backgroundColor: c.fill, borderColor: focused ? withAlpha(c.accent, 0.6) : c.line }]}>
      <Icon name="magnifying-glass" size={20} color={focused ? c.ink : c.ink3} weight={focused ? 'bold' : 'regular'} />
      <View style={styles.inputWrap}>
        {value ? null : <RotatingHint />}
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          onKeyPress={(e) => {
            // Hardware keyboards (DeX, the web demo): Escape clears.
            if (e.nativeEvent.key === 'Escape' && value) onClear();
          }}
          returnKeyType="search"
          enterKeyHint="search"
          keyboardAppearance="dark"
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_QUERY}
          selectionColor={c.accent}
          cursorColor={c.accent}
          underlineColorAndroid="transparent"
          accessibilityLabel="Search songs, artists or a vibe"
          testID={testID}
          style={[styles.input, { color: c.ink }]}
        />
      </View>
      {value ? (
        <IconButton
          icon="x"
          label="Clear search"
          size={32}
          iconSize={16}
          weight="bold"
          tone="fill"
          haptic={false}
          onPress={onClear}
          testID={testID ? `${testID}-clear` : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    height: SEARCH_FIELD_H,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: space.lg,
    paddingRight: space.sm,
  },
  inputWrap: { flex: 1, height: SEARCH_FIELD_H, justifyContent: 'center' },
  hint: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  hintLine: { ...StyleSheet.absoluteFill, justifyContent: 'center' },
  input: {
    height: SEARCH_FIELD_H,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontFamily: fonts.sansMedium,
    fontSize: 16,
  },
});
