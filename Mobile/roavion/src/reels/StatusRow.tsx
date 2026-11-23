/**
 * WhatsApp "Updates"-style status row for the Reels tab: a "Post a reel"
 * circle first, then one round avatar per creator with a green ring split
 * into one segment per reel (like status updates), name underneath.
 *
 * Pure presentation — grouping is by the creator block the feed already
 * returns; nothing here calls the API.
 */
import { memo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Reel } from '../api/reels';
import { colors, font, spacing } from '../theme';
import { PressScale, Shimmer } from '../ui';

const TEAM_BADGE = require('../../assets/icon.png');
const SIZE = 64;
const THICK = 2.5;
const STEP = 6; // degrees per ring piece

export interface CreatorGroup {
  key: string;
  name: string;
  avatarUrl: string | null;
  team: boolean;
  reels: Reel[];
}

/** Group the loaded feed by creator, in feed order (first appearance wins). */
export function groupByCreator(reels: Reel[]): CreatorGroup[] {
  const map = new Map<string, CreatorGroup>();
  for (const r of reels) {
    const key = r.creator.id ?? 'team';
    let g = map.get(key);
    if (!g) {
      g = { key, name: r.creator.name || 'Autobacs India', avatarUrl: r.creator.avatarUrl, team: r.creator.id == null, reels: [] };
      map.set(key, g);
    }
    g.reels.push(r);
  }
  return [...map.values()];
}

/**
 * Ring split into `count` arcs with small gaps (no SVG in this app: each arc
 * is drawn from short rotated pieces).
 */
const SegmentRing = memo(function SegmentRing({ count, size = SIZE }: { count: number; size?: number }) {
  const n = Math.max(1, Math.min(count, 12));
  if (n === 1) {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: THICK, borderColor: colors.green }]} />;
  }
  const r = size / 2;
  const seg = 360 / n;
  const gap = Math.min(10, seg * 0.3);
  const pieceH = (2 * Math.PI * r * STEP) / 360 + 1;
  const pieces: number[] = [];
  for (let a = 0; a < 360; a += STEP / 2) {
    const within = a % seg;
    if (within >= gap / 2 && within <= seg - gap / 2) pieces.push(a);
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((a) => (
        <View
          key={a}
          style={{
            position: 'absolute',
            left: r - THICK / 2,
            top: r - pieceH / 2,
            width: THICK,
            height: pieceH,
            borderRadius: THICK / 2,
            backgroundColor: colors.green,
            transform: [{ rotate: `${a}deg` }, { translateY: -r + THICK / 2 }],
          }}
        />
      ))}
    </View>
  );
});

function Face({ group }: { group: CreatorGroup }) {
  if (group.avatarUrl) return <Image source={{ uri: group.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />;
  if (group.team) return <Image source={TEAM_BADGE} style={StyleSheet.absoluteFill} contentFit="cover" />;
  return <Text style={s.initial}>{group.name.slice(0, 1).toUpperCase() || 'A'}</Text>;
}

export function StatusRow({
  groups,
  loading,
  onOpen,
  onPost,
  myInitial,
}: {
  groups: CreatorGroup[];
  loading?: boolean;
  onOpen: (group: CreatorGroup) => void;
  onPost: () => void;
  /** Signed-in customer's initial for the "Post a reel" circle. */
  myInitial?: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
      <PressScale onPress={onPost} haptic="light" style={s.item} accessibilityLabel="Post a reel">
        <View style={s.circle}>
          <View style={[s.face, s.mine]}>
            {myInitial ? <Text style={[s.initial, { color: colors.ink2 }]}>{myInitial}</Text> : <Ionicons name="person" size={26} color={colors.chrome} />}
          </View>
          <View style={s.plus}>
            <Ionicons name="add" size={16} color={colors.white} />
          </View>
        </View>
        <Text style={s.name} numberOfLines={1}>Post a reel</Text>
      </PressScale>

      {loading
        ? Array.from({ length: 4 }, (_, i) => (
            <View key={i} style={s.item}>
              <Shimmer width={SIZE} height={SIZE} radius={SIZE / 2} />
              <Shimmer width={48} height={10} style={{ marginTop: 8 }} />
            </View>
          ))
        : groups.map((g) => (
            <PressScale
              key={g.key}
              onPress={() => onOpen(g)}
              haptic="selection"
              style={s.item}
              accessibilityLabel={`${g.name}, ${g.reels.length} ${g.reels.length === 1 ? 'reel' : 'reels'}`}
            >
              <View style={s.circle}>
                <SegmentRing count={g.reels.length} />
                <View style={s.face}>
                  <Face group={g} />
                </View>
              </View>
              <Text style={s.name} numberOfLines={1}>{g.name}</Text>
            </PressScale>
          ))}
    </ScrollView>
  );
}

const INNER = SIZE - 8;

const s = StyleSheet.create({
  row: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingVertical: spacing.xs },
  item: { width: SIZE + 8, alignItems: 'center' },
  circle: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  face: {
    width: INNER, height: INNER, borderRadius: INNER / 2, overflow: 'hidden', backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center',
  },
  mine: { width: SIZE - 4, height: SIZE - 4, borderRadius: (SIZE - 4) / 2, backgroundColor: colors.page },
  plus: {
    position: 'absolute', right: 0, bottom: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white,
  },
  initial: { fontFamily: font.heading, fontSize: 22, color: colors.white },
  name: { fontFamily: font.medium, fontSize: 12, color: colors.ink, marginTop: 6, textAlign: 'center' },
});
