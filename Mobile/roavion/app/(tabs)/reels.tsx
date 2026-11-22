/**
 * Reels — full-screen, vertically swiped, shoppable videos.
 *
 * Playback: three recycled players (see usePlayerPool). The visible reel plays,
 * the next one is preloaded, everything pauses when the tab loses focus or the
 * app goes to the background.
 *
 * Shopping: Add to cart / Buy now first tell the server which reel the buyer
 * came from (`attributeReel` — no price, no amount), then use the SAME cart
 * flow as the rest of the app. The cart API is the authority on price and
 * stock; checkout recomputes everything server-side.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { attributeReel, recordView, reportReel, REELS_MOCK, type Reel } from '../../src/api/reels';
import { ReelSlide } from '../../src/reels/ReelSlide';
import { POOL_SIZE, usePlayerPool } from '../../src/reels/usePlayerPool';
import { useLikeReel, useReelFeed } from '../../src/reels/useReels';
import { toggleFollow, toggleSave } from '../../src/reels/localPrefs';
import { ReelFeedSkeleton } from '../../src/reels/ReelFeedSkeleton';
import { ApiError } from '../../src/api/client';
import { useApp } from '../../src/store';
import { alpha, colors, font, palette, radius, spacing } from '../../src/theme';
import { EmptyState, ErrorState, IconButton, PressScale, StateLayout, StripeLoader, Stripes, haptic, useToast } from '../../src/ui';

type Row = { kind: 'reel'; reel: Reel } | { kind: 'end' };

const SITE = (Constants.expoConfig?.extra as { siteUrl?: string } | undefined)?.siteUrl ?? 'https://www.autobacsindia.com';
const VIEW_AFTER_MS = 2000;
const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

const REPORT_REASONS = ['Spam or misleading', 'Wrong product tagged', 'Inappropriate content', 'Something else'];

export default function ReelsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customer, addItem } = useApp();
  const feed = useReelFeed();
  const like = useLikeReel();
  const pool = usePlayerPool();

  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(true);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState<{ id: string; kind: 'add' | 'buy' } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();
  const listRef = useRef<FlatList<Row>>(null);
  // Opened from a reel circle on Home: start at that reel.
  const { start } = useLocalSearchParams<{ start?: string }>();

  const reels = feed.reels;
  const rows = useMemo<Row[]>(() => {
    const r: Row[] = reels.map((reel) => ({ kind: 'reel', reel }));
    if (reels.length > 0 && !feed.hasNextPage && !feed.isFetchingNextPage) r.push({ kind: 'end' });
    return r;
  }, [reels, feed.hasNextPage, feed.isFetchingNextPage]);

  // ── lifecycle: pause on blur / background ─────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // ── playback: load active ± 1, play only the active one ───────────────────
  const { load, players, setMuted: applyMute, pauseAll } = pool;
  useEffect(() => {
    if (!reels.length) return;
    const order = [active, active + 1, active - 1];
    for (const i of order) if (i >= 0 && i < reels.length) load(i, reels[i]);

    const live = focused && appActive && !paused && active < reels.length;
    players.forEach((p, slot) => {
      if (live && slot === active % POOL_SIZE) p.play();
      else p.pause();
    });

    // Warm the posters a little further ahead so a fast swipe never shows black.
    const ahead = reels.slice(active + 1, active + 4).map((r) => r.posterUrl).filter(Boolean) as string[];
    if (ahead.length) Image.prefetch(ahead).catch(() => {});
  }, [active, reels, focused, appActive, paused, load, players]);

  useEffect(() => applyMute(muted), [muted, applyMute]);
  useEffect(() => () => pauseAll(), [pauseAll]);

  // A new reel starts from the top, unpaused.
  const { restart } = pool;
  const [shownActive, setShownActive] = useState(-1);
  if (shownActive !== active) {
    setShownActive(active);
    setPaused(false);
  }
  useEffect(() => {
    if (active < reels.length) restart(active);
  }, [active, reels.length, restart]);

  // Count a view after the reel has been on screen for a moment.
  const viewed = useRef(new Set<string>());
  useEffect(() => {
    const reel = reels[active];
    if (!reel || !focused || viewed.current.has(reel.id)) return;
    const t = setTimeout(() => {
      viewed.current.add(reel.id);
      recordView(reel.id);
    }, VIEW_AFTER_MS);
    return () => clearTimeout(t);
  }, [active, reels, focused]);

  // Fetch the next page a few reels before the end.
  useEffect(() => {
    if (feed.hasNextPage && !feed.isFetchingNextPage && active >= reels.length - 3) feed.fetchNextPage();
  }, [active, reels.length, feed]);

  // Jump to the requested reel once the list can be measured, then clear the
  // param so returning to the tab later doesn't jump again.
  useEffect(() => {
    if (!start || !height || !reels.length) return;
    const idx = reels.findIndex((r) => r.id === start);
    if (idx >= 0) {
      // The viewability callback then makes it the active (playing) reel.
      listRef.current?.scrollToOffset({ offset: idx * height, animated: false });
    }
    router.setParams({ start: undefined });
  }, [start, height, reels, router]);

  // ── paging ─────────────────────────────────────────────────────────────────
  const onViewable = useCallback(({ viewableItems }: { viewableItems: { index?: number | null; isViewable: boolean }[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index != null);
    if (first?.index != null) setActive(first.index);
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== height) setHeight(h);
  };

  // ── toast ─────────────────────────────────────────────────────────────────
  const showToast = useCallback(
    (message: string, tone: 'success' | 'error' | 'info' = 'success', icon?: 'checkmark-circle' | 'bookmark' | 'person-add' | 'alert-circle') =>
      toast.show({ message, tone: tone === 'info' ? undefined : tone, icon }),
    [toast],
  );

  // ── actions ───────────────────────────────────────────────────────────────
  const requireSignIn = useCallback(
    (why: string) => {
      Alert.alert('Sign in', why, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign in', onPress: () => router.push('/login') },
      ]);
    },
    [router],
  );

  const onLike = useCallback(
    (reel: Reel, forceOn?: boolean) => {
      if (!customer) return requireSignIn('Sign in to like reels.');
      const next = forceOn ? true : !reel.viewerLiked;
      // Double tap already fired its own (stronger) haptic with the heart burst.
      if (!forceOn && next !== reel.viewerLiked) haptic.light();
      like(reel, next).catch(() => showToast("Couldn't save your like", 'error', 'alert-circle'));
    },
    [customer, like, requireSignIn, showToast],
  );

  // Follow + Save are on-device only for now (no API yet) — see src/reels/localPrefs.ts.
  const onSave = useCallback(
    (reel: Reel) => {
      const on = toggleSave(reel.id);
      if (on) showToast('Saved', 'info', 'bookmark');
    },
    [showToast],
  );
  const onFollow = useCallback(
    (reel: Reel) => {
      if (!reel.creator.id) return;
      const on = toggleFollow(reel.creator.id);
      if (on) showToast(`Following ${reel.creator.name}`, 'info', 'person-add');
    },
    [showToast],
  );

  const onShare = useCallback((reel: Reel) => {
    const title = reel.product?.title ?? 'Autobacs';
    const url = reel.shareUrl ?? (reel.product ? `${SITE}/products/${reel.product.slug}` : SITE);
    Share.share(
      Platform.OS === 'ios'
        ? { url, message: `${title} on Autobacs` }
        : { message: `${title} on Autobacs\n${url}`, title },
    ).catch(() => {});
  }, []);

  const onReport = useCallback(
    (reel: Reel) => {
      if (!customer) return requireSignIn('Sign in to report a reel.');
      Alert.alert('Report this reel', 'Tell us what is wrong. Our team will review it.', [
        ...REPORT_REASONS.map((reason) => ({
          text: reason,
          onPress: () =>
            reportReel(reel.id, reason)
              .then(() => showToast('Thanks — our team will review it'))
              .catch(() => showToast("Couldn't send the report. Try again.", 'error', 'alert-circle')),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [customer, requireSignIn, showToast],
  );

  const openProduct = useCallback(
    (reel: Reel) => {
      if (reel.product) router.push(`/product/${reel.product.slug}`);
    },
    [router],
  );

  /**
   * Attribution first (best-effort, no money), then the normal cart add. The
   * server's cart response is what the badge shows.
   */
  const shop = useCallback(
    async (reel: Reel, kind: 'add' | 'buy') => {
      const product = reel.product;
      if (!product || product.availability === 'out' || busy) return;
      haptic.medium();
      setBusy({ id: reel.id, kind });
      try {
        await attributeReel(reel.id);
        if (product.hasVariants) {
          // Several models/sizes: the customer picks one on the product page.
          router.push(`/product/${product.slug}`);
          return;
        }
        await addItem(product.id, 1);
        // Success haptic only now — after the server's cart confirmed the add.
        haptic.success();
        if (kind === 'buy') router.push(customer ? '/checkout' : '/login?next=/checkout');
        else toast.show({ message: 'Added to cart', icon: 'bag-check', action: { label: 'View cart', onPress: () => router.push('/cart') } });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Could not add to cart. Please try again.';
        if (/variant|option/i.test(msg)) {
          // A product with options (size, colour, vehicle) needs a choice first.
          router.push(`/product/${product.slug}`);
        } else {
          haptic.error();
          Alert.alert('Not added', msg);
        }
      } finally {
        setBusy(null);
      }
    },
    [addItem, busy, customer, router, toast],
  );
  const onAdd = useCallback((r: Reel) => shop(r, 'add'), [shop]);
  const onBuy = useCallback((r: Reel) => shop(r, 'buy'), [shop]);

  const onTogglePause = useCallback(() => {
    haptic.selection();
    setPaused((p) => !p);
  }, []);
  const onToggleMute = useCallback(() => setMuted((m) => !m), []);

  const onPost = () => {
    haptic.light();
    router.push(customer ? '/reels/new' : '/login?next=/reels/new');
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await feed.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  const renderItem = ({ item, index }: { item: Row; index: number }) => {
    if (item.kind === 'end') {
      return (
        <View style={[s.endPage, { height }]}>
          <StateLayout
            icon="checkmark-done"
            title="You're all caught up"
            body="New reels from the Autobacs community land here every day."
            action={{ label: 'Watch from the start', onPress: () => listRef.current?.scrollToOffset({ offset: 0, animated: true }) }}
            secondary={{ label: 'Post your own reel', onPress: onPost }}
            onDark
          />
        </View>
      );
    }
    const slot = index % POOL_SIZE;
    const slotState = pool.slots[slot];
    const mine = slotState.reelId === item.reel.id;
    return (
      <ReelSlide
        reel={item.reel}
        height={height}
        active={index === active}
        player={mine ? players[slot] : null}
        slot={mine ? slotState : null}
        paused={paused}
        muted={muted}
        topInset={insets.top}
        bottomInset={0}
        busy={busy?.id === item.reel.id ? busy.kind : null}
        onTogglePause={onTogglePause}
        onToggleMute={onToggleMute}
        onLike={onLike}
        onSave={onSave}
        onFollow={onFollow}
        onShare={onShare}
        onReport={onReport}
        onOpenProduct={openProduct}
        onAdd={onAdd}
        onBuy={onBuy}
        onRetry={() => pool.reload(index, item.reel)}
      />
    );
  };

  let body: React.ReactNode;
  if (feed.isPending) {
    body = <ReelFeedSkeleton topInset={insets.top} />;
  } else if (feed.isError && !reels.length) {
    body = (
      <ErrorState
        error={feed.error}
        message={feed.error instanceof ApiError ? feed.error.message : "We couldn't load reels right now."}
        onRetry={() => feed.refetch()}
        onDark
      />
    );
  } else if (!reels.length) {
    body = (
      <EmptyState
        icon="film-outline"
        title="No reels yet"
        body="Be the first — film the gear on your car and tag the product."
        action={{ label: 'Post a reel', onPress: onPost }}
        onDark
      />
    );
  } else if (height > 0) {
    body = (
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(r) => (r.kind === 'reel' ? r.reel.id : 'end')}
        renderItem={renderItem}
        extraData={[active, pool.slots, paused, muted, busy, height]}
        pagingEnabled
        snapToInterval={height}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={VIEWABILITY}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.white} colors={[colors.green]} progressViewOffset={insets.top + 40} />}
        ListFooterComponent={
          feed.isFetchingNextPage ? undefined : feed.isError && feed.hasNextPage ? (
            <Pressable style={[s.footerRetry, { height }]} onPress={() => feed.fetchNextPage()} accessibilityRole="button">
              <ErrorState message="Couldn't load more reels." onRetry={() => feed.fetchNextPage()} onDark />
            </Pressable>
          ) : undefined
        }
      />
    );
  }

  return (
    <View style={s.screen} onLayout={onLayout}>
      <StatusBar style={focused ? "light" : "dark"} />
      {body}

      {/* Floating header over the video */}
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]} pointerEvents="box-none">
        <View style={s.titleRow}>
          <Text style={s.headerTitle} accessibilityRole="header">Reels</Text>
          <Stripes width={12} height={5} gap={3} onDark />
          {REELS_MOCK && (
            <View style={s.demo}>
              <Text style={s.demoText}>DEMO</Text>
            </View>
          )}
        </View>
        <View style={s.headerActions}>
          {customer && (
            <IconButton icon="albums-outline" label="My reels" tone="glass" size={38} onPress={() => router.push('/reels/mine')} />
          )}
          <PressScale onPress={onPost} style={s.post} accessibilityLabel="Post a reel" scaleTo={0.94}>
            <Text style={s.postText}>Post</Text>
            <Text style={s.postPlus}>+</Text>
          </PressScale>
        </View>
      </View>

      {feed.isFetchingNextPage && active >= reels.length - 1 && (
        <View style={s.moreSpinner} pointerEvents="none">
          <StripeLoader onDark label="Loading more reels" />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerTitle: {
    fontFamily: font.extrabold, fontSize: 24, color: colors.white, letterSpacing: -0.4,
    textShadowColor: alpha(palette.black, 0.4), textShadowRadius: 6,
  },
  demo: { backgroundColor: colors.gold, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  demoText: { fontFamily: font.bold, fontSize: 10, color: colors.ink, letterSpacing: 0.8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  post: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 38, paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill, backgroundColor: colors.green,
  },
  postText: { fontFamily: font.bold, fontSize: 13.5, color: colors.white },
  postPlus: { fontFamily: font.bold, fontSize: 18, lineHeight: 20, color: colors.white },

  endPage: { backgroundColor: colors.carbon },
  footerRetry: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.carbon },
  moreSpinner: { position: 'absolute', bottom: 24, alignSelf: 'center' },
});
