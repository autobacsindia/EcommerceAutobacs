/**
 * Heritage Noir primitives — the pieces that make the dark look:
 * Crest, SerifTitle, HeroScrim, GoldRule / Hairline, LineDots, SearchBar.
 *
 * Look-only: nothing here touches prices, cart or the API. Colours come from
 * `noir` / `scrims` in theme.ts.
 *
 * This file must not import from './primitives' (primitives imports
 * SerifTitle from here).
 */
import { type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { font, noir, radius, scrims, spacing, type, type ScrimName } from '../theme';
import { PressScale } from './motion';

// ── Crest ───────────────────────────────────────────────────────────────────

/**
 * Round "AB" badge with a fine ring — top-left of Heritage Noir headers,
 * launch intro.
 *
 *   <Crest />                         // 30pt, white ring
 *   <Crest ring="gold" size={44} />
 *   <Crest onPress={goHome} />        // tappable (44pt target via hitSlop)
 */
export function Crest({
  size = 30,
  ring = 'white',
  onPress,
  style,
}: {
  size?: number;
  ring?: 'white' | 'gold';
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = ring === 'gold' ? noir.gold : noir.text;
  const box: StyleProp<ViewStyle> = [
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: size >= 60 ? 2 : 1.5,
      borderColor: c,
      alignItems: 'center',
      justifyContent: 'center',
    },
    style,
  ];
  const label = (
    <Text style={{ fontFamily: font.extrabold, fontSize: Math.round(size * 0.36), letterSpacing: size * 0.016, color: noir.text }} allowFontScaling={false}>
      AB
    </Text>
  );
  if (!onPress) {
    return (
      <View style={box} accessible accessibilityRole="image" accessibilityLabel="Autobacs">
        {label}
      </View>
    );
  }
  return (
    <PressScale onPress={onPress} haptic="selection" hitSlop={Math.max(0, (44 - size) / 2)} accessibilityLabel="Autobacs home" style={box}>
      {label}
    </PressScale>
  );
}

// ── SerifTitle ──────────────────────────────────────────────────────────────

export type SerifSize = 'hero' | 'title' | 'section' | 'product' | 'small';

const SERIF: Record<SerifSize, TextStyle> = {
  hero: type.serifHero,
  title: type.serifTitle,
  section: type.serifSection,
  product: type.serifProduct,
  small: type.serifSmall,
};

/**
 * Playfair Display 600 title. `italicLast` sets the last word in italic —
 * "Make it *yours.*", "Shop the *reel*".
 *
 *   <SerifTitle size="hero" italicLast>Make it yours.</SerifTitle>
 *   <SerifTitle size="product" numberOfLines={2}>{p.title}</SerifTitle>
 *   <SerifTitle size="title" color={noir.gold}>Reels</SerifTitle>
 *
 * Children must be a string when `italicLast` is set (otherwise rendered as-is).
 */
export function SerifTitle({
  children,
  size = 'section',
  italicLast,
  color,
  style,
  ...rest
}: {
  children: ReactNode;
  size?: SerifSize;
  italicLast?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
} & Omit<TextProps, 'style' | 'children'>) {
  const base = [SERIF[size], color ? { color } : null, style];
  if (italicLast && typeof children === 'string') {
    const t = children.trimEnd();
    const cut = t.lastIndexOf(' ');
    if (cut > 0) {
      return (
        <Text style={base} {...rest}>
          {t.slice(0, cut + 1)}
          <Text style={{ fontFamily: font.serifItalic }}>{t.slice(cut + 1)}</Text>
        </Text>
      );
    }
    return (
      <Text style={[base, { fontFamily: font.serifItalic }]} {...rest}>
        {t}
      </Text>
    );
  }
  return (
    <Text style={base} {...rest}>
      {children}
    </Text>
  );
}

// ── HeroScrim ───────────────────────────────────────────────────────────────

/**
 * The Heritage Noir fade, laid over a photo / video. Fills its parent
 * (absolute), never intercepts touches.
 *
 *   <View style={{ height: 372 }}>
 *     <Image source={…} style={StyleSheet.absoluteFill} />
 *     <HeroScrim />                     // black top → clear → racing green → carbon
 *     …header + hero copy…
 *   </View>
 *
 * variant: hero (Home banner) · reel (full-screen video) · gallery (PDP, no
 * green) · tile (reel/collection poster).
 */
export function HeroScrim({ variant = 'hero', style }: { variant?: ScrimName; style?: StyleProp<ViewStyle> }) {
  const g = scrims[variant];
  return (
    <LinearGradient
      pointerEvents="none"
      colors={g.colors as unknown as readonly [string, string, ...string[]]}
      locations={g.locations as unknown as readonly [number, number, ...number[]]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}

// ── rules ───────────────────────────────────────────────────────────────────

/**
 * Fine gold line. Default: full-width 1px at 40% (glass card / sticky bar
 * edge). `solid` for the 2px bottom edge of reel tiles.
 *
 *   <GoldRule />
 *   <GoldRule solid thickness={2} />
 *   <GoldRule label="Heritage" />       // ── HERITAGE ──  ornament
 */
export function GoldRule({
  solid,
  thickness = 1,
  label,
  style,
}: {
  solid?: boolean;
  thickness?: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = solid ? noir.gold : noir.goldLine;
  if (label) {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, style]} accessibilityRole="text">
        <View style={{ flex: 1, height: thickness, backgroundColor: c }} />
        <Text style={type.capsNoir}>{label}</Text>
        <View style={{ flex: 1, height: thickness, backgroundColor: c }} />
      </View>
    );
  }
  return <View style={[{ height: thickness, alignSelf: 'stretch', backgroundColor: c }, style]} />;
}

/**
 * Carbon hairline between rows / sections.
 *   <Hairline />  <Hairline strong />  <Hairline vertical style={{ height: 18 }} />
 */
export function Hairline({ strong, vertical, style }: { strong?: boolean; vertical?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = strong ? noir.hairlineStrong : noir.hairline;
  return <View style={[vertical ? { width: 1, alignSelf: 'stretch' } : { height: 1, alignSelf: 'stretch' }, { backgroundColor: c }, style]} />;
}

// ── LineDots ────────────────────────────────────────────────────────────────

/**
 * Line-style carousel / gallery position (active = 16×3 white, rest 6×3 at 40%).
 *   <LineDots count={slides.length} index={i} />
 */
export function LineDots({ count, index, style }: { count: number; index: number; style?: StyleProp<ViewStyle> }) {
  if (count < 2) return null;
  return (
    <View
      style={[{ flexDirection: 'row', gap: 4, alignItems: 'center' }, style]}
      accessible
      accessibilityLabel={`${Math.min(index, count - 1) + 1} of ${count}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: i === index ? 16 : 6, height: 3, backgroundColor: i === index ? noir.text : noir.glassChipBorder }} />
      ))}
    </View>
  );
}

// ── SearchBar ───────────────────────────────────────────────────────────────

type SearchBarProps = {
  placeholder?: string;
  /** Pass to render a tappable bar that opens the search screen (Home). */
  onPress?: () => void;
  /** Trailing element (filter button, clear). */
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<ComponentRef<typeof TextInput>>;
} & Omit<TextInputProps, 'style' | 'placeholder'>;

/**
 * Square carbon-2 search bar with a green search icon.
 *
 *   <SearchBar placeholder="Search parts, brands or your car" onPress={() => router.push('/search')} />
 *   <SearchBar ref={input} value={q} onChangeText={setQ} onSubmitEditing={go} autoFocus returnKeyType="search" />
 */
export function SearchBar({ placeholder = 'Search parts, brands or your car', onPress, right, style, ref, ...input }: SearchBarProps) {
  const icon = <Ionicons name="search" size={17} color={noir.greenText} />;
  if (onPress) {
    return (
      <PressScale onPress={onPress} haptic="selection" scaleTo={0.99} accessibilityRole="search" accessibilityLabel={placeholder} style={[sb.bar, style]}>
        {icon}
        <Text style={sb.placeholder} numberOfLines={1}>
          {placeholder}
        </Text>
        {right}
      </PressScale>
    );
  }
  return (
    <View style={[sb.bar, style]}>
      {icon}
      <TextInput
        ref={ref}
        placeholder={placeholder}
        placeholderTextColor={noir.textMuted}
        selectionColor={noir.gold}
        cursorColor={noir.gold}
        keyboardAppearance="dark"
        style={sb.input}
        accessibilityRole="search"
        {...input}
      />
      {right}
    </View>
  );
}

const sb = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    paddingHorizontal: spacing.md,
    backgroundColor: noir.surface,
    borderWidth: 1,
    borderColor: noir.hairline,
    borderRadius: radius.square,
  },
  placeholder: { flex: 1, fontFamily: font.regular, fontSize: 14, color: noir.textMuted },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 15,
    color: noir.text,
    paddingVertical: Platform.OS === 'android' ? 0 : 4,
  },
});
