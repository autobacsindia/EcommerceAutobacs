/**
 * Reels on Home, WhatsApp "Status"-style (owner, 2026-11-22):
 *
 *   - `ReelStories`: round creator avatars inside a green ring split into one
 *     segment per reel (like WhatsApp's status ring), name below. Led by
 *     "Post a reel" (the Autobacs badge with a green +, like "Add status").
 *     Tap a creator → Reels opens at their latest reel. Team uploads (no
 *     named creator) show the round Autobacs badge as "Autobacs India".
 *   - `ShopTheReel` (default): tall 9:16 reel cards; each opens Reels there.
 *
 * With no reels (the live server has none approved yet) or a feed error, the
 * stories row still shows "Post" + Autobacs India, and the cards become one
 * tasteful "Reels coming soon · Post a reel" card — never a blank hole.
 *
 * Data is the live reels feed (or the mock when EXPO_PUBLIC_REELS_MOCK=1).
 * The price chip shows what the server sent — never computed here.
 */
import { memo, useCallback, useMemo, type ReactNode } from 'react';
import { FlatList, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Reel } from '../api/reels';
import { useReelFeed } from '../reels/useReels';
import { alpha, colors, elevation, font, inr, radius, spacing, type } from '../theme';
import { PressScale, SectionHeader, Shimmer } from '../ui';

const BADGE = require('../../assets/icon.png');
const TEAM_NAME = 'Autobacs India';

export const REEL_W = 138;
export const REEL_H = Math.round((REEL_W * 16) / 9);
const GAP = spacing.md;
const STORY = 66;

// ── stories row ─────────────────────────────────────────────────────────────

interface Story {
  key: string;
  name: string;
  avatarUrl: string | null;
  team: boolean;
  firstReelId: string | null;
  /** Reels by this creator in the feed — one ring segment each. */
  count: number;
}

function storiesFrom(reels: Reel[]): Story[] {
  const seen = new Map<string, Story>();
  for (const r of reels) {
    const team = !r.creator.id;
    const key = team ? 'team' : (r.creator.id as string);
    const prev = seen.get(key);
    if (prev) {
      prev.count += 1;
      continue;
    }
    seen.set(key, {
      key,
      name: team ? TEAM_NAME : r.creator.name,
      avatarUrl: team ? null : r.creator.avatarUrl,
      team,
      firstReelId: r.id,
      count: 1,
    });
  }
  // Autobacs India always has a place in the row, even before it has a reel.
  if (!seen.has('team')) seen.set('team', { key: 'team', name: TEAM_NAME, avatarUrl: null, team: true, firstReelId: null, count: 0 });
  const list = [...seen.values()];
  // Team first, then creators in feed order.
  return [...list.filter((x) => x.team), ...list.filter((x) => !x.team)].slice(0, 12);
}

function Avatar({ story }: { story: Story }) {
  if (story.team) return <Image source={BADGE} style={s.storyImg} contentFit="cover" />;
  if (story.avatarUrl) return <Image source={{ uri: story.avatarUrl }} style={s.storyImg} contentFit="cover" cachePolicy="memory-disk" />;
  return (
    <View style={[s.storyImg, s.storyInitial]}>
      <Text style={s.storyInitialText}>{story.name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

const RING = STORY + 8;
const RING_W = 2.5;

/**
 * WhatsApp's status ring: a green circle cut into `segments` arcs by small
 * gaps. No SVG in the app, so the gaps are page-coloured notches rotated
 * around the centre. 0 segments = a grey ring (nothing posted yet).
 */
function SegmentedRing({ segments, children }: { segments: number; children: ReactNode }) {
  const n = Math.min(segments, 12);
  return (
    <View style={[s.ring, { borderColor: n ? colors.storyRing : colors.line }]}>
      {n > 1 &&
        Array.from({ length: n }, (_, i) => (
          <View key={i} pointerEvents="none" style={[s.notchTrack, { transform: [{ rotate: `${(360 / n) * i}deg` }] }]}>
            <View style={s.notch} />
          </View>
        ))}
      {children}
    </View>
  );
}

function ReelStories({ reels, onOpen }: { reels: Reel[]; onOpen: (id: string | null) => void }) {
  const router = useRouter();
  const stories = useMemo(() => storiesFrom(reels), [reels]);
  return (
    <FlatList
      horizontal
      data={stories}
      keyExtractor={(x) => x.key}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.stories}
      ListHeaderComponent={
        <PressScale onPress={() => router.push('/reels/new')} haptic="light" style={s.story} accessibilityLabel="Post a reel">
          <View style={s.postWrap}>
            <Image source={BADGE} style={s.storyImg} contentFit="cover" />
            <View style={s.postPlus}>
              <Ionicons name="add" size={16} color={colors.white} />
            </View>
          </View>
          <Text style={s.storyName} numberOfLines={1}>Post a reel</Text>
        </PressScale>
      }
      renderItem={({ item }) => (
        <PressScale
          onPress={() => onOpen(item.firstReelId)}
          haptic="selection"
          style={s.story}
          accessibilityLabel={item.firstReelId ? `Reels by ${item.name}` : `${item.name} reels, coming soon`}
        >
          <SegmentedRing segments={item.count}>
            <Avatar story={item} />
          </SegmentedRing>
          <Text style={s.storyName} numberOfLines={1}>{item.team ? 'Autobacs' : item.name}</Text>
        </PressScale>
      )}
    />
  );
}

// ── tall reel cards ─────────────────────────────────────────────────────────

const ReelCard = memo(function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: (id: string) => void }) {
  const p = reel.product;
  const price = p ? (p.festivalPrice ?? p.price) : null;
  const poster = reel.posterUrl || p?.image || undefined;
  const team = !reel.creator.id;
  const name = team ? TEAM_NAME : reel.creator.name;
  return (
    <PressScale
      onPress={() => onOpen(reel.id)}
      haptic="light"
      style={s.card}
      accessibilityLabel={`Reel by ${name}${p ? `, ${p.title}` : ''}`}
    >
      {poster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} recyclingKey={reel.id} />
      ) : null}
      <LinearGradient
        colors={[alpha(colors.void, 0.35), alpha(colors.void, 0), alpha(colors.void, 0.85)]}
        locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={s.top}>
        <View style={s.avatar}>
          {team ? (
            <Image source={BADGE} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : reel.creator.avatarUrl ? (
            <Image source={{ uri: reel.creator.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <Text style={s.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <Text style={s.handle} numberOfLines={1}>{name}</Text>
      </View>
      <View style={s.play}>
        <Ionicons name="play" size={14} color={colors.white} style={{ marginLeft: 2 }} />
      </View>
      {p && (
        <View style={s.bottom}>
          <Text style={s.title} numberOfLines={2}>{p.title}</Text>
          {price != null && (
            <View style={s.pricePill}>
              <Ionicons name="bag-handle" size={11} color={colors.white} />
              <Text style={s.priceText}>{inr(price)}</Text>
            </View>
          )}
        </View>
      )}
    </PressScale>
  );
});

/** Shown in place of the cards when there are no reels yet. */
function ComingSoon() {
  const router = useRouter();
  return (
    <View style={s.soon}>
      <Image source={BADGE} style={s.soonBadge} contentFit="cover" />
      <View style={{ flex: 1 }}>
        <Text style={s.soonOver}>Reels coming soon</Text>
        <Text style={s.soonTitle}>Watch it fitted. Shop it in a tap.</Text>
        <Text style={s.soonBody}>Real cars, real installs from drivers and creators — with the part one tap away.</Text>
        <PressScale onPress={() => router.push('/reels/new')} haptic="light" style={s.soonBtn} accessibilityRole="button" accessibilityLabel="Post a reel">
          <Ionicons name="videocam" size={15} color={colors.white} />
          <Text style={s.soonBtnText}>Post a reel</Text>
        </PressScale>
      </View>
    </View>
  );
}

export default function ShopTheReel() {
  const router = useRouter();
  const feed = useReelFeed();
  const reels = useMemo(() => (feed.isError ? [] : feed.reels.slice(0, 10)), [feed.isError, feed.reels]);
  const empty = !feed.isPending && !reels.length;

  const open = useCallback(
    (id: string | null) => router.push(id ? { pathname: '/(tabs)/reels', params: { start: id } } : '/(tabs)/reels'),
    [router],
  );
  const renderItem = useCallback(({ item }: ListRenderItemInfo<Reel>) => <ReelCard reel={item} onOpen={open} />, [open]);

  return (
    <View style={s.section}>
      <SectionHeader
        overline="Watch & shop"
        title="Reels"
        actionLabel={empty ? undefined : 'See all'}
        onAction={empty ? undefined : () => router.push('/(tabs)/reels')}
      />
      {feed.isPending ? (
        <>
          <View style={s.stories}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Shimmer key={i} width={STORY} height={STORY} radius={STORY / 2} />
            ))}
          </View>
          <View style={s.row}>
            {[0, 1, 2].map((i) => (
              <Shimmer key={i} width={REEL_W} height={REEL_H} radius={radius.lg} />
            ))}
          </View>
        </>
      ) : (
        <>
          <ReelStories reels={reels} onOpen={open} />
          {empty ? (
            <ComingSoon />
          ) : (
            <FlatList
              horizontal
              data={reels}
              keyExtractor={(r) => r.id}
              renderItem={renderItem}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.row}
              initialNumToRender={3}
              windowSize={3}
              decelerationRate="fast"
              snapToInterval={REEL_W + GAP}
              getItemLayout={(_, i) => ({ length: REEL_W + GAP, offset: (REEL_W + GAP) * i, index: i })}
            />
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: spacing.xxl },

  stories: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  story: { width: RING + 4, alignItems: 'center', gap: 6 },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: RING_W,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A full-size layer rotated about the centre; its notch sits on the ring at 12 o'clock.
  notchTrack: { position: 'absolute', top: -RING_W, left: -RING_W, width: RING, height: RING, alignItems: 'center' },
  notch: { width: 4, height: RING_W + 2, marginTop: -1, backgroundColor: colors.screen },
  storyImg: { width: STORY - 2, height: STORY - 2, borderRadius: (STORY - 2) / 2, overflow: 'hidden' },
  postWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  postPlus: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.green,
    borderWidth: 2,
    borderColor: colors.screen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyInitial: { backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  storyInitialText: { fontFamily: font.heading, fontSize: 22, color: colors.green },
  storyName: { fontFamily: font.medium, fontSize: 11.5, color: colors.ink2, maxWidth: RING + 4 },

  row: { flexDirection: 'row', gap: GAP, paddingHorizontal: spacing.lg },
  card: { width: REEL_W, height: REEL_H, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.carbon },
  top: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.green,
    borderWidth: 1.5,
    borderColor: colors.greenOnDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.bold, fontSize: 10, color: colors.white },
  handle: { flex: 1, fontFamily: font.medium, fontSize: 11, color: colors.white },
  play: {
    position: 'absolute',
    top: '42%',
    alignSelf: 'center',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.glassDark,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.onDarkFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.sm, gap: 6 },
  title: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, color: colors.white },
  pricePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
  },
  priceText: { fontFamily: font.bold, fontSize: 12, color: colors.white },

  soon: {
    flexDirection: 'row',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...elevation.e1,
  },
  soonBadge: { width: 52, height: 52, borderRadius: 26 },
  soonOver: { ...type.overline },
  soonTitle: { ...type.h3, fontFamily: font.heading, marginTop: 2 },
  soonBody: { ...type.small, marginTop: 4 },
  soonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 38,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
  },
  soonBtnText: { fontFamily: font.bold, fontSize: 13.5, color: colors.white },
});
