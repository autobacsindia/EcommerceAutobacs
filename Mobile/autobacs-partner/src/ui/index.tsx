/**
 * The building blocks every screen uses. Light, website-matched look:
 * white surfaces on a #f6f7f6 page, hairline borders, green pill buttons.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, elevation, font, radius, spacing, type } from '../theme';

export type IconName = keyof typeof Ionicons.glyphMap;

// ── text ─────────────────────────────────────────────────────────────────────

export function T({
  kind = 'body',
  style,
  children,
  numberOfLines,
  selectable,
}: {
  kind?: keyof typeof type;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  selectable?: boolean;
}) {
  return (
    <Text style={[type[kind], style]} numberOfLines={numberOfLines} selectable={selectable}>
      {children}
    </Text>
  );
}

// ── brand ────────────────────────────────────────────────────────────────────

const badge = require('../../assets/badge.png');

/** The AB badge + "AUTOBACS / PARTNER" lockup. Never replaced with plain text. */
export function Logo({ size = 40, wordmark = true, style }: { size?: number; wordmark?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.logoRow, style]} accessible accessibilityRole="image" accessibilityLabel="Autobacs Partner">
      <Image source={badge} style={{ width: size, height: size }} contentFit="contain" />
      {wordmark ? (
        <View style={{ marginLeft: size * 0.28 }}>
          <Text style={[styles.wordmark, { fontSize: size * 0.42, lineHeight: size * 0.5 }]}>AUTOBACS</Text>
          <Text style={[styles.wordmarkSub, { fontSize: size * 0.26, lineHeight: size * 0.34, letterSpacing: size * 0.09 }]}>PARTNER</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── layout ───────────────────────────────────────────────────────────────────

/** Scrollable page with keyboard avoidance and safe-area padding. */
export function Screen({
  children,
  scroll = true,
  edges = ['bottom'],
  contentStyle,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  /** Pinned bottom bar (primary actions). */
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView contentContainerStyle={[styles.content, contentStyle]} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <T kind="overline" style={{ marginBottom: 4 }}>
        {title.toUpperCase()}
      </T>
      {hint ? (
        <T kind="small" style={{ marginBottom: spacing.md }}>
          {hint}
        </T>
      ) : (
        <View style={{ height: spacing.sm }} />
      )}
      <Card>{children}</Card>
    </View>
  );
}

export const Divider = () => <View style={styles.divider} />;

// ── buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  small,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const off = disabled || loading;
  const fg = variant === 'primary' ? colors.white : variant === 'danger' ? colors.red : colors.green;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        variant === 'primary' && styles.btnPrimary,
        variant === 'outline' && styles.btnOutline,
        variant === 'danger' && styles.btnDanger,
        pressed && { opacity: 0.85 },
        off && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[styles.btnText, small && { fontSize: 14 }, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function LinkButton({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="link" style={style}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

// ── inputs ───────────────────────────────────────────────────────────────────

export function Field({
  label,
  error,
  hint,
  prefix,
  containerStyle,
  style,
  ...input
}: TextInputProps & { label: string; error?: string; hint?: string; prefix?: string; containerStyle?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginBottom: spacing.lg, minWidth: 0 }, containerStyle]}>
      <T kind="label" style={{ marginBottom: 6 }}>
        {label}
      </T>
      <View style={[styles.inputWrap, !!error && { borderColor: colors.red }, input.editable === false && { backgroundColor: colors.page }]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={colors.chrome}
          style={[styles.input, input.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 }, style]}
          accessibilityLabel={label}
          {...input}
        />
      </View>
      {error ? (
        <T kind="caption" style={{ color: colors.red, marginTop: 5 }}>
          {error}
        </T>
      ) : hint ? (
        <T kind="caption" style={{ marginTop: 5 }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** Row of pill choices (GST rate, stock, filters). */
export function Chips<V extends string | number>({
  options,
  value,
  onChange,
  disabled,
  scroll,
}: {
  options: { value: V; label: string; count?: number }[];
  value: V;
  onChange: (v: V) => void;
  disabled?: boolean;
  scroll?: boolean;
}) {
  const row = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable
        key={String(o.value)}
        onPress={() => onChange(o.value)}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{ selected: on, disabled }}
        style={[styles.chip, on && styles.chipOn, disabled && { opacity: 0.5 }]}
      >
        <Text style={[styles.chipText, on && { color: colors.green, fontFamily: font.bold }]}>{o.label}</Text>
      </Pressable>
    );
  });
  return scroll ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
      {row}
    </ScrollView>
  ) : (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{row}</View>
  );
}

// ── feedback ─────────────────────────────────────────────────────────────────

type Tone = 'info' | 'warn' | 'error' | 'success';
const toneColors: Record<Tone, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: colors.blueSoft, fg: colors.blue, icon: 'information-circle' },
  warn: { bg: colors.goldSoft, fg: colors.gold, icon: 'alert-circle' },
  error: { bg: colors.redSoft, fg: colors.red, icon: 'close-circle' },
  success: { bg: colors.greenSoft, fg: colors.green, icon: 'checkmark-circle' },
};

export function Banner({ tone = 'info', title, children, style }: { tone?: Tone; title?: string; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.banner, { backgroundColor: c.bg }, style]} accessibilityRole="alert">
      <Ionicons name={c.icon} size={20} color={c.fg} style={{ marginRight: 10, marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {title ? <Text style={[type.bodyBold, { color: c.fg, marginBottom: children ? 2 : 0 }]}>{title}</Text> : null}
        {typeof children === 'string' ? <T style={{ color: colors.ink2 }}>{children}</T> : children}
      </View>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.green} size="large" />
      {label ? <T kind="small" style={{ marginTop: 12 }}>{label}</T> : null}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.center}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={colors.green} />
      </View>
      <T kind="h2" style={{ textAlign: 'center', marginTop: 16 }}>
        {title}
      </T>
      {body ? <T kind="small" style={{ textAlign: 'center', marginTop: 6, maxWidth: 300 }}>{body}</T> : null}
      {action ? <View style={{ marginTop: 20 }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Could not load"
      body={message}
      action={onRetry ? <Button label="Try again" icon="refresh" variant="outline" onPress={onRetry} /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: spacing.sm,
  },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, ...elevation.e1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: spacing.md },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  wordmark: { fontFamily: font.extrabold, color: colors.ink, letterSpacing: 1 },
  wordmarkSub: { fontFamily: font.bold, color: colors.green },
  btn: { minHeight: 50, borderRadius: radius.pill, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 40, paddingHorizontal: 16 },
  btnPrimary: { backgroundColor: colors.green },
  btnOutline: { borderWidth: 1.5, borderColor: colors.green, backgroundColor: colors.card },
  btnDanger: { borderWidth: 1.5, borderColor: colors.red, backgroundColor: colors.card },
  btnText: { fontFamily: font.bold, fontSize: 16 },
  link: { fontFamily: font.bold, fontSize: 15, color: colors.green },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.chrome, borderRadius: radius.md, backgroundColor: colors.card },
  prefix: { fontFamily: font.bold, fontSize: 16, color: colors.ink2, paddingLeft: 14 },
  input: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 16, color: colors.ink, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.greenSoft, borderColor: colors.green },
  chipText: { fontFamily: font.medium, fontSize: 14, color: colors.ink2 },
  banner: { flexDirection: 'row', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
});
