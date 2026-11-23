/**
 * Building blocks every screen uses — the approved mockup's look: light page,
 * white cards with hairline borders, green primary actions, soft status chips.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, font, radius, spacing, type } from '../theme';

export type IconName = keyof typeof Ionicons.glyphMap;

export function T({
  kind = 'body',
  style,
  children,
  numberOfLines,
}: {
  kind?: keyof typeof type;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text style={[type[kind], style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

// ── brand ────────────────────────────────────────────────────────────────────

const badge = require('../../assets/badge.png');

/** Logo A + "AUTOBACS / TEAM" lockup (owner-approved). Never plain text. */
export function Logo({ size = 30, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel="Autobacs Team">
      <Image source={badge} style={{ width: size, height: size }} resizeMode="contain" />
      {wordmark ? (
        <View style={{ marginLeft: 8 }}>
          <Text style={[styles.wm, { fontSize: size * 0.5, lineHeight: size * 0.56 }]}>AUTOBACS</Text>
          <Text style={[styles.wmSub, { fontSize: size * 0.33, letterSpacing: size * 0.08 }]}>TEAM</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── layout ───────────────────────────────────────────────────────────────────

export function Screen({
  children,
  scroll = true,
  edges = [],
  contentStyle,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.green} /> : undefined
            }
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.between, style]}>{children}</View>;
}

/** A list row with a hairline under it (not under the last one). */
export function Li({ children, last }: { children: ReactNode; last?: boolean }) {
  return <View style={[styles.li, last && { borderBottomWidth: 0 }]}>{children}</View>;
}

// ── chips & buttons ──────────────────────────────────────────────────────────

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'grey';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: colors.greenSoft, fg: colors.green },
  warn: { bg: colors.warnSoft, fg: colors.warn },
  bad: { bg: colors.badSoft, fg: colors.bad },
  info: { bg: colors.infoSoft, fg: colors.info },
  grey: { bg: colors.bg, fg: colors.muted },
};

export function Chip({ label, tone = 'grey', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }, tone === 'grey' && styles.chipGrey]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} style={{ marginRight: 4 }} /> : null}
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'outline',
  loading,
  disabled,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const primary = variant === 'primary';
  const fg = primary ? colors.onPrimary : variant === 'danger' ? colors.bad : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        primary && styles.btnPrimary,
        variant === 'ghost' && styles.btnGhost,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Segmented choice (leave type, full/half day). */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string; disabled?: boolean }[];
  value: V | null;
  onChange: (v: V) => void;
}) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: o.disabled }}
            disabled={o.disabled}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, on && styles.segOn, o.disabled && { opacity: 0.4 }]}
          >
            <Text style={[styles.segText, on && { color: colors.green, fontFamily: font.bold }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, error, ...input }: { label: string; error?: string } & TextInputProps) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={type.small}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        {...input}
        style={[styles.input, error ? { borderColor: colors.bad } : null, input.multiline && { minHeight: 72, textAlignVertical: 'top' }]}
      />
      {error ? <Text style={[type.small, { color: colors.bad }]}>{error}</Text> : null}
    </View>
  );
}

// ── states ───────────────────────────────────────────────────────────────────

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.green} />
      {label ? <T kind="small" style={{ marginTop: 8 }}>{label}</T> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={{ alignItems: 'center', gap: spacing.md }}>
      <Ionicons name="cloud-offline-outline" size={28} color={colors.muted} />
      <T style={{ textAlign: 'center' }}>{message}</T>
      {onRetry ? <Button label="Try again" onPress={onRetry} /> : null}
    </Card>
  );
}

/** The endpoint is not deployed yet. Calm, not an error. */
export function ComingSoon({ what }: { what: string }) {
  return (
    <Card style={{ alignItems: 'center', gap: spacing.sm }}>
      <Ionicons name="time-outline" size={28} color={colors.green} />
      <T kind="h2">Coming soon</T>
      <T kind="small" style={{ textAlign: 'center' }}>
        {what} will show here once HR switches it on. Nothing is wrong with your phone.
      </T>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  wm: { fontFamily: font.extrabold, color: colors.ink, letterSpacing: 0.4 },
  wmSub: { fontFamily: font.bold, color: colors.green, marginTop: -1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14 },
  li: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  chipGrey: { borderWidth: 1, borderColor: colors.line },
  chipText: { fontFamily: font.bold, fontSize: 11.5 },
  btn: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  btnPrimary: { backgroundColor: colors.green, borderColor: colors.green },
  btnGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  btnText: { fontFamily: font.bold, fontSize: 15 },
  seg: { flexDirection: 'row', gap: 6 },
  segItem: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 9,
    backgroundColor: colors.card,
  },
  segOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  segText: { fontFamily: font.regular, fontSize: 13, color: colors.ink2 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.ink,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
