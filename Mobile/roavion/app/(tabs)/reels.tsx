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
  ActivityIndicator,
  Alert,
  Animated,
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
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../../src/api/client';
import { attributeReel, recordView, reportReel, REELS_MOCK, type Reel } from '../../src/api/reels';
import { ReelSlide } from '../../src/reels/ReelSlide';
import { POOL_SIZE, usePlayerPool } from '../../src/reels/usePlayerPool';
import { useLikeReel, useReelFeed } from '../../src/reels/useReels';
import { useApp } from '../../src/store';
import { colors, font, radius, spacing } from '../../src/theme';

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
  const [toast] = useState(() => new Animated.Value(0));
  const [toastText, setToastText] = useState('');
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
    (text: string) => {
      setToastText(text);
      toast.setValue(0);
      Animated.sequence([
        Animated.spring(toast, { toValue: 1, useNativeDriver: true, friction: 7 }),
        Animated.delay(1600),
        Animated.timing(toast, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
    },
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
      if (next !== reel.viewerLiked) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      like(reel, next).catch(() => showToast("Couldn't save your like"));
    },
    [customer, like, requireSignIn, showToast],
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
              .catch(() => showToast("Couldn't send the report. Try again.")),
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setBusy({ id: reel.id, kind });
      try {
        await attributeReel(reel.id);
        if (product.hasVariants) {
          // Several models/sizes: the customer picks one on the product page.
          router.push(`/product/${product.slug}`);
          return;
        }
        await addItem(product.id, 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (kind === 'buy') router.push(customer ? '/checkout' : '/login?next=/checkout');
        else showToast('Added to cart');
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Could not add to cart. Please try again.';
        if (/variant|option/i.test(msg)) {
          // A product with options (size, colour, vehicle) needs a choice first.
          router.push(`/product/${product.slug}`);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          Alert.alert('Not added', msg);
        }
      } finally {
        setBusy(null);
      }
    },
    [addItem, busy, customer, router, showToast],
  );
  const onAdd = useCallback((r: Reel) => shop(r, 'add'), [shop]);
  const onBuy = useCallback((r: Reel) => shop(r, 'buy'), [shop]);

  const onTogglePause = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setPaused((p) => !p);
  }, []);
  const onToggleMute = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setMuted((m) => !m);
  }, []);

  const onPost = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
          <View style={s.endBadge}>
            <Ionicons name="checkmark-done" size={30} color={colors.white} />
          </View>
          <Text style={s.endTitle}>You&apos;re all caught up</Text>
          <Text style={s.endBody}>New reels from the Autobacs community land here every day.</Text>
          <Pressable
            style={s.endBtn}
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-up" size={16} color={colors.ink} />
            <Text style={s.endBtnText}>Watch from the start</Text>
          </Pressable>
          <Pressable style={[s.endBtn, s.endBtnGhost]} onPress={onPost} accessibilityRole="button">
            <Ionicons name="add" size={18} color={colors.white} />
            <Text style={[s.endBtnText, { color: colors.white }]}>Post your own reel</Text>
          </Pressable>
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
        bottomInset={0}
        busy={busy?.id === item.reel.id ? busy.kind : null}
        onTogglePause={onTogglePause}
        onToggleMute={onToggleMute}
        onLike={onLike}
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
    body = (
      <View style={s.state}>
        <ActivityIndicator color={colors.white} size="large" />
      </View>
    );
  } else if (feed.isError && !reels.length) {
    body = (
      <View style={s.state}>
        <Ionicons name="cloud-offline-outline" size={44} color="rgba(255,255,255,0.8)" />
        <Text style={s.stateTitle}>Couldn&apos;t load reels</Text>
        <Text style={s.stateBody}>
          {feed.error instanceof ApiError ? feed.error.message : 'Check your internet connection and try again.'}
        </Text>
        <Pressable style={s.endBtn} onPress={() => feed.refetch()} accessibilityRole="button">
          <Ionicons name="refresh" size={16} color={colors.ink} />
          <Text style={s.endBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (!reels.length) {
    body = (
      <View style={s.state}>
        <Ionicons name="film-outline" size={44} color="rgba(255,255,255,0.8)" />
        <Text style={s.stateTitle}>No reels yet</Text>
        <Text style={s.stateBody}>Be the first — show off the gear on your car.</Text>
        <Pressable style={s.endBtn} onPress={onPost} accessibilityRole="button">
          <Ionicons name="add" size={18} color={colors.ink} />
          <Text style={s.endBtnText}>Post a reel</Text>
        </Pressable>
      </View>
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
            <Pressable style={[s.footerRetry, { height: 80 }]} onPress={() => feed.fetchNextPage()}>
              <Text style={s.stateBody}>Couldn&apos;t load more. Tap to retry.</Text>
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
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.headerTitle}>Reels</Text>
          {REELS_MOCK && (
            <View style={s.demo}>
              <Text style={s.demoText}>DEMO</Text>
            </View>
          )}
        </View>
        <Pressable onPress={onPost} style={({ pressed }) => [s.plus, pressed && { transform: [{ scale: 0.92 }] }]} accessibilityRole="button" accessibilityLabel="Post a reel" hitSlop={8}>
          <Ionicons name="add" size={24} color={colors.white} />
        </Pressable>
      </View>

      {feed.isFetchingNextPage && active >= reels.length - 1 && (
        <View style={s.moreSpinner} pointerEvents="none">
          <ActivityIndicator color={colors.white} />
        </View>
      )}

      <Animated.View
        pointerEvents="none"
        style={[s.toast, { top: insets.top + 56, opacity: toast, transform: [{ translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}
      >
        <Ionicons name="checkmark-circle" size={18} color="#4ade80" />
        <Text style={s.toastText}>{toastText}</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  headerTitle: {
    fontFamily: font.extrabold, fontSize: 24, color: colors.white, letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 6,
  },
  demo: { backgroundColor: 'rgba(242,165,22,0.9)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  demoText: { fontFamily: font.bold, fontSize: 10, color: colors.ink, letterSpacing: 0.8 },
  plus: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },

  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  stateTitle: { fontFamily: font.heading, fontSize: 20, color: colors.white, marginTop: spacing.sm },
  stateBody: { fontFamily: font.regular, fontSize: 14, color: 'rgba(255,255,255,0.75)', textAlign: 'center', lineHeight: 20 },

  endPage: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm, backgroundColor: colors.header },
  endBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  endTitle: { fontFamily: font.heading, fontSize: 21, color: colors.white },
  endBody: { fontFamily: font.regular, fontSize: 14, color: 'rgba(255,255,255,0.72)', textAlign: 'center', marginBottom: spacing.md },
  endBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.white,
    paddingHorizontal: spacing.xl, height: 44, borderRadius: radius.pill, marginTop: spacing.sm, minWidth: 220, justifyContent: 'center',
  },
  endBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  endBtnText: { fontFamily: font.bold, fontSize: 14, color: colors.ink },
  footerRetry: { alignItems: 'center', justifyContent: 'center' },
  moreSpinner: { position: 'absolute', bottom: 24, alignSelf: 'center' },

  toast: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(18,20,20,0.92)', paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.pill,
  },
  toastText: { fontFamily: font.bold, fontSize: 13.5, color: colors.white },
});
