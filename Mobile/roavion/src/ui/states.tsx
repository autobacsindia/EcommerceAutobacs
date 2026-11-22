/**
 * Branded empty / error / offline / loading states. Illustration-free: the
 * logo's stripes, an icon in a soft disc, a title, a line, one action.
 *
 *   <EmptyState icon="cart-outline" title="Your cart is empty"
 *               body="Find something for your car." action={{ label: 'Start shopping', onPress: goShop }} />
 *   <ErrorState error={q.error} onRetry={q.refetch} />      // shows OfflineState for network failures
 *   <OfflineState onRetry={q.refetch} />
 *   <LoadingState />                                        // centred StripeLoader (prefer a skeleton)
 *
 * All accept `onDark` for carbon/black screens (Reels).
 */
import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, type } from '../theme';
import { PremiumButton } from './primitives';
import { StripeLoader, Stripes } from './loaders';

type IconName = keyof typeof Ionicons.glyphMap;
type Action = { label: string; onPress: () => void };

/**
 * True when an error means "no connection" rather than "server said no".
 * React Native's fetch throws `TypeError: Network request failed`; browsers
 * say "Failed to fetch"; our client times out with an AbortError.
 */
export function isOfflineError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string; status?: number };
  if (typeof e.status === 'number' && e.status > 0) return false;
  const m = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase();
  return /network request failed|failed to fetch|network ?error|aborterror|timed? ?out|internet|offline/.test(m);
}

export function StateLayout({
  icon,
  title,
  body,
  action,
  secondary,
  onDark,
  children,
  style,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: Action;
  secondary?: Action;
  onDark?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.full, style]} accessibilityRole="summary">
      <Stripes width={18} height={5} gap={4} onDark={onDark} style={{ marginBottom: spacing.xl }} />
      {icon && (
        <View style={[s.disc, onDark && { backgroundColor: colors.carbon2 }]}>
          <Ionicons name={icon} size={30} color={onDark ? colors.greenOnDark : colors.green} />
        </View>
      )}
      <Text style={[type.h2, s.center, onDark && { color: colors.white }]} accessibilityRole="header">
        {title}
      </Text>
      {!!body && <Text style={[type.small, s.center, s.body, onDark && { color: colors.onDarkMuted }]}>{body}</Text>}
      {children}
      {action && (
        <PremiumButton label={action.label} onPress={action.onPress} variant={onDark ? 'light' : 'primary'} style={{ marginTop: spacing.xl, minWidth: 200 }} />
      )}
      {secondary && (
        <PremiumButton label={secondary.label} onPress={secondary.onPress} variant="ghost" size="sm" style={{ marginTop: spacing.sm }} />
      )}
    </View>
  );
}

export function EmptyState(props: { icon?: IconName; title: string; body?: string; action?: Action; secondary?: Action; onDark?: boolean; style?: StyleProp<ViewStyle> }) {
  return <StateLayout icon={props.icon ?? 'cube-outline'} {...props} />;
}

export function OfflineState({ onRetry, onDark, style }: { onRetry?: () => void; onDark?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <StateLayout
      icon="cloud-offline-outline"
      title="You're offline"
      body="Check your mobile data or Wi-Fi, then try again."
      action={onRetry ? { label: 'Try again', onPress: onRetry } : undefined}
      onDark={onDark}
      style={style}
    />
  );
}

/**
 * Error with retry. Pass the raw error: network failures render the offline
 * layout; anything else shows `message` (or the error's own text).
 */
export function ErrorState({
  error,
  message,
  onRetry,
  onDark,
  style,
}: {
  error?: unknown;
  message?: string | null;
  onRetry?: () => void;
  onDark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (isOfflineError(error)) return <OfflineState onRetry={onRetry} onDark={onDark} style={style} />;
  const text = message ?? (error instanceof Error ? error.message : undefined) ?? 'Please try again in a moment.';
  return (
    <StateLayout
      icon="alert-circle-outline"
      title="Something went wrong"
      body={text}
      action={onRetry ? { label: 'Try again', onPress: onRetry } : undefined}
      onDark={onDark}
      style={style}
    />
  );
}

/** Centred stripe loader. Prefer a skeleton shaped like the content. */
export function LoadingState({ onDark, label, style }: { onDark?: boolean; label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.full, style]}>
      <StripeLoader size="lg" onDark={onDark} label={label} />
    </View>
  );
}

const s = StyleSheet.create({
  full: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  disc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  center: { textAlign: 'center' },
  body: { marginTop: 6, maxWidth: 300 },
});
