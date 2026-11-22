/**
 * First-load placeholder for the Reels feed, shaped like a reel (creator row,
 * caption, rail, product card) so nothing jumps when the first reel arrives.
 */
import { StyleSheet, View } from 'react-native';
import { alpha, noir, palette, radius, spacing } from '../theme';
import { Shimmer, StripeLoader } from '../ui';

export function ReelFeedSkeleton({ topInset }: { topInset: number }) {
  return (
    <View style={s.page} accessibilityLabel="Loading reels">
      <View style={[s.progress, { top: topInset + 4 }]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.segment} />
        ))}
      </View>
      <View style={s.center}>
        <StripeLoader size="lg" onDark label="Loading reels" />
      </View>
      <View style={s.bottom}>
        <View style={s.row}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <View style={s.creator}>
              <Shimmer width={38} height={38} radius={19} dark />
              <Shimmer width={120} height={14} dark />
              <Shimmer width={64} height={26} radius={radius.square} dark />
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
            <Shimmer width={60} height={60} radius={radius.none} dark />
            <View style={{ flex: 1, gap: 8 }}>
              <Shimmer width="90%" height={12} dark />
              <Shimmer width="50%" height={14} dark />
              <Shimmer width="40%" height={10} dark />
            </View>
          </View>
          <View style={s.creator}>
            <Shimmer width="48%" height={38} radius={radius.square} dark />
            <Shimmer width="48%" height={38} radius={radius.square} dark />
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: noir.void },
  progress: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 2, backgroundColor: alpha(palette.white, 0.3) },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  creator: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'space-between' },
  rail: { gap: spacing.lg, alignItems: 'center', width: 48 },
  card: { borderRadius: radius.square, padding: spacing.md, gap: spacing.md, backgroundColor: noir.surface, borderWidth: 1, borderColor: noir.goldLine },
});
