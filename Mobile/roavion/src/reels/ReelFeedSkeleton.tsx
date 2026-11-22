/**
 * First-load placeholder for the Reels feed, shaped like a reel (creator row,
 * caption, rail, product card) so nothing jumps when the first reel arrives.
 */
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { Shimmer, StripeLoader } from '../ui';

export function ReelFeedSkeleton({ topInset }: { topInset: number }) {
  return (
    <View style={s.page} accessibilityLabel="Loading reels">
      <View style={[s.progress, { top: topInset + 2 }]} />
      <View style={s.center}>
        <StripeLoader size="lg" onDark label="Loading reels" />
      </View>
      <View style={s.bottom}>
        <View style={s.row}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <View style={s.creator}>
              <Shimmer width={38} height={38} radius={19} dark />
              <Shimmer width={120} height={14} dark />
              <Shimmer width={64} height={26} radius={radius.pill} dark />
            </View>
            <Shimmer width="92%" height={12} dark />
            <Shimmer width="64%" height={12} dark />
          </View>
          <View style={s.rail}>
            {[0, 1, 2, 3].map((i) => (
              <Shimmer key={i} width={30} height={30} radius={15} dark />
            ))}
          </View>
        </View>
        <View style={s.card}>
          <View style={s.creator}>
            <Shimmer width={64} height={64} radius={radius.md} dark />
            <View style={{ flex: 1, gap: 8 }}>
              <Shimmer width="90%" height={12} dark />
              <Shimmer width="50%" height={14} dark />
              <Shimmer width="40%" height={10} dark />
            </View>
          </View>
          <View style={s.creator}>
            <Shimmer width="48%" height={38} radius={radius.pill} dark />
            <Shimmer width="48%" height={38} radius={radius.pill} dark />
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.carbon },
  progress: { position: 'absolute', left: spacing.lg, right: spacing.lg, height: 2.5, borderRadius: 2, backgroundColor: colors.onDarkFaint },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  creator: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'space-between' },
  rail: { gap: spacing.lg, alignItems: 'center', width: 48 },
  card: { borderRadius: radius.xl, padding: spacing.md, gap: spacing.md, backgroundColor: colors.carbon2 },
});
