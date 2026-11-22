/**
 * Home — design "Premium showroom" (owner picked 2026-11-18).
 *
 * Top to bottom: logo row, hero card (promo banner + top deals, car pill,
 * "Make it yours", Shop now, dots), white search, tinted category tiles,
 * "Watch and shop" reel cards, parts that fit the saved car (or Popular), then
 * calmer sections — deals, best sellers, new arrivals.
 *
 * Every row is live catalogue data. A row with nothing in it is not rendered,
 * and while data loads each row shows skeletons in the shape of what is coming.
 * Nothing here computes a price: cards show what the server sent.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { fetchActiveBanner, fetchCategories, fetchOffers, fetchProducts, type Category, type Product } from '../../src/api/catalogue';
import AppHeader, { SearchField } from '../../src/components/AppHeader';
import ScrollTopButton from '../../src/components/ScrollTopButton';
import { useHeaderScroll, useScrollToTop } from '../../src/components/useHeaderScroll';
import ProductCard from '../../src/components/ProductCard';
import { MiniTile, Panel, ProductCardSkeleton, Skeleton, TextLink } from '../../src/components/ui';
import { useReelFeed } from '../../src/reels/useReels';
import { colors, font, inr, radius, spacing, tints } from '../../src/theme';
import { useApp } from '../../src/store';

const { width: SCREEN } = Dimensions.get('window');

const PAGE_INNER = SCREEN - spacing.lg * 2;
const GRID_GAP = 10;
const MINI_W = Math.floor((PAGE_INNER - GRID_GAP * 3) / 4);

const light = () => Haptics.selectionAsync().catch(() => {});

// ── rails ────────────────────────────────────────────────────────────────────

function ProductRail({
  title,
  subtitle,
  products,
  loading,
  onSeeAll,
  ranked,
}: {
  title: string;
  subtitle?: string;
  products: Product[];
  loading: boolean;
  onSeeAll?: () => void;
  ranked?: boolean;
}) {
  if (!loading && !products.length) return null;
  return (
    <Panel title={title} subtitle={subtitle} actionLabel={onSeeAll ? 'See all' : undefined} onAction={onSeeAll} flush>
      {loading ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.railContent}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ marginRight: GRID_GAP }}>
              <ProductCardSkeleton />
            </View>
          ))}
        </ScrollView>
      ) : (
        <FlatList
          horizontal
          data={products}
          keyExtractor={(p) => p.id}
          renderItem={({ item, index }) => <ProductCard product={item} rank={ranked ? index + 1 : undefined} />}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.railContent}
          ItemSeparatorComponent={() => <View style={{ width: GRID_GAP }} />}
        />
      )}
    </Panel>
  );
}

const HERO_W = PAGE_INNER;
const HERO_H = Math.round(HERO_W * 0.62);
const REEL_W = 118;
const REEL_H = Math.round((REEL_W * 16) / 9);

/** Map a web banner link to an app route; anything unknown opens the offers list. */
function bannerRoute(linkPath?: string | null): string {
  const path = (linkPath || '/offers').split('?')[0].replace(/\/+$/, '');
  const product = path.match(/^\/products?\/([^/]+)$/);
  if (product) return `/product/${product[1]}`;
  const category = path.match(/^\/(?:category|categories)\/([^/]+)$/);
  if (category) return `/category/${category[1]}`;
  return '/category/offers';
}

interface HeroSlide {
  key: string;
  /** Full-bleed photo (the promo banner) … */
  cover?: string;
  /** … or a product shot on the dark showroom backdrop (a deal). */
  product?: string;
  subtitle: string;
  route: string;
}

/**
 * The hero card: the active promo banner (if admins switched one on) and the
 * top deals with photos, swiped sideways with dots. The car pill, title and
 * "Shop now" sit on every slide. Display only.
 */
function Hero({ slides, loading }: { slides: HeroSlide[]; loading: boolean }) {
  const router = useRouter();
  const { garage } = useApp();
  const [index, setIndex] = useState(0);

  if (loading && !slides.length) {
    return <Skeleton width={HERO_W} height={HERO_H} radius={18} style={{ marginHorizontal: spacing.lg, marginTop: spacing.sm }} />;
  }
  const list: HeroSlide[] = slides.length
    ? slides
    : [{ key: 'default', subtitle: 'Genuine parts and accessories, delivered', route: '/(tabs)/shop' }];
  const current = list[Math.min(index, list.length - 1)];
  const car = garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : null;

  return (
    <View style={s.hero}>
      <FlatList
        horizontal
        pagingEnabled
        data={list}
        keyExtractor={(sl) => sl.key}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / HERO_W))}
        renderItem={({ item }) => (
          <View style={{ width: HERO_W, height: HERO_H }}>
            {item.cover ? (
              <Image source={{ uri: item.cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <LinearGradient colors={['#1c2422', '#0d3b27']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
                {item.product && (
                  <View style={s.heroShotWell}>
                    <Image source={{ uri: item.product }} style={s.heroShot} contentFit="contain" cachePolicy="memory-disk" />
                  </View>
                )}
              </LinearGradient>
            )}
          </View>
        )}
      />
      {/* scrim + the words on top of every slide */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.72)']}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.heroBody} pointerEvents="box-none">
        <Pressable
          onPress={() => {
            light();
            router.push('/garage');
          }}
          style={({ pressed }) => [s.glass, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={car ? `Your car: ${car}. Change` : 'Add your car'}
        >
          <Text style={s.glassText} numberOfLines={1}>{car ? `🚗  Your ${car}` : '🚗  Add your car'}</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.white} />
        </Pressable>
        <View style={{ flex: 1 }} pointerEvents="none" />
        <Text style={s.heroTitle} pointerEvents="none">Make it yours</Text>
        <Text style={s.heroSub} numberOfLines={1} pointerEvents="none">{current.subtitle}</Text>
        <View style={s.heroFoot} pointerEvents="box-none">
          <Pressable
            onPress={() => {
              light();
              router.push(current.route as never);
            }}
            style={({ pressed }) => [s.heroBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Shop now"
          >
            <Text style={s.heroBtnText}>Shop now</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.ink} />
          </Pressable>
          {list.length > 1 && (
            <View style={s.dots} pointerEvents="none">
              {list.map((sl, i) => (
                <View key={sl.key} style={[s.dot, i === index && s.dotOn]} />
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/** "Watch and shop": tall 9:16 reel cards; each opens Reels at that reel. */
function WatchAndShop() {
  const router = useRouter();
  const feed = useReelFeed();
  const reels = feed.reels.slice(0, 10);

  if (feed.isError || (!feed.isPending && !reels.length)) return null;

  return (
    <View style={{ marginTop: spacing.xl }}>
      <View style={s.rowHead}>
        <Text style={s.rowTitle}>Watch and shop</Text>
        <TextLink label="See all" onPress={() => router.push('/(tabs)/reels')} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.reelRow}>
        {feed.isPending
          ? [0, 1, 2].map((i) => <Skeleton key={i} width={REEL_W} height={REEL_H} radius={radius.md} />)
          : reels.map((r) => {
              const handle = `@${r.creator.name.replace(/\s+/g, '').toLowerCase()}`;
              const price = r.product ? (r.product.festivalPrice ?? r.product.price) : null;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    light();
                    router.push({ pathname: '/(tabs)/reels', params: { start: r.id } });
                  }}
                  style={({ pressed }) => [s.reelCard, pressed && { transform: [{ scale: 0.97 }] }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Reel by ${r.creator.name}`}
                >
                  <Image
                    source={{ uri: (r.posterUrl || r.product?.image) ?? undefined }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={s.reelScrim} />
                  <View style={s.play}>
                    <Ionicons name="play" size={12} color={colors.white} />
                  </View>
                  <View style={s.reelMeta}>
                    <Text style={s.reelHandle} numberOfLines={1}>{handle}</Text>
                    {price != null && <Text style={s.reelPrice}>{inr(price)}</Text>}
                  </View>
                </Pressable>
              );
            })}
      </ScrollView>
    </View>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { garage } = useApp();
  const scroller = useRef<ScrollViewInstance>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { onScroll, showTop } = useHeaderScroll(0);
  const scrollToTop = useScrollToTop(scroller);

  const [categories, deals, newest, popular, forMyCar, banner] = useQueries({
    queries: [
      { queryKey: ['categories'], queryFn: () => fetchCategories() },
      { queryKey: ['home', 'deals'], queryFn: () => fetchOffers(14) },
      { queryKey: ['home', 'new'], queryFn: () => fetchProducts({ sort: '-createdAt', limit: 12 }) },
      { queryKey: ['home', 'popular'], queryFn: () => fetchProducts({ sort: '-salesScore', limit: 12 }) },
      {
        queryKey: ['home', 'garage', garage?.make, garage?.model],
        queryFn: () => fetchProducts({ vehicleMake: garage?.make, vehicleModel: garage?.model, limit: 12 }),
        enabled: !!garage?.make,
      },
      { queryKey: ['home', 'banner'], queryFn: () => fetchActiveBanner(), staleTime: 5 * 60_000 },
    ],
  });

  const topCategories: Category[] = useMemo(
    () => (categories.data ?? []).filter((c) => !c.parentId),
    [categories.data],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([categories.refetch(), deals.refetch(), newest.refetch(), popular.refetch(), banner.refetch()]);
    setRefreshing(false);
  }, [categories, deals, newest, popular, banner]);

  const dealList = deals.data ?? [];

  const heroSlides: HeroSlide[] = useMemo(() => {
    const out: HeroSlide[] = [];
    const b = banner.data;
    if (b) {
      out.push({
        key: 'banner',
        cover: b.mobileImageUrl || b.imageUrl,
        subtitle: b.title || "Today's offers",
        route: bannerRoute(b.linkPath),
      });
    }
    for (const d of (deals.data ?? []).filter((x) => !!x.image).slice(0, 3)) {
      out.push({
        key: d.id,
        product: d.image,
        // Display only: the discount the server reported.
        subtitle: d.discountPercent > 0 ? `${d.name} · ${d.discountPercent}% off` : d.name,
        route: `/product/${d.slug}`,
      });
    }
    return out;
  }, [banner.data, deals.data]);
  const carName = garage ? garage.model || garage.make : null;
  const carQuery = garage
    ? `/search?vehicleMake=${encodeURIComponent(garage.make)}${garage.model ? `&vehicleModel=${encodeURIComponent(garage.model)}` : ''}`
    : null;

  return (
    <View style={s.screen}>
      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} colors={[colors.green]} />}
      >
        <AppHeader />

        <Hero slides={heroSlides} loading={deals.isLoading || banner.isLoading} />

        <SearchField style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }} />

        {/* Categories — tinted tiles, four across */}
        {(categories.isLoading || topCategories.length > 0) && (
          <Panel title="Shop by category" actionLabel="See all" onAction={() => router.push('/(tabs)/shop')}>
            <View style={s.grid}>
              {categories.isLoading
                ? [0, 1, 2, 3].map((i) => (
                    <View key={i} style={{ width: MINI_W, gap: 6 }}>
                      <Skeleton width={MINI_W} height={MINI_W} radius={radius.md} />
                      <Skeleton width={MINI_W - 16} height={9} />
                    </View>
                  ))
                : topCategories.slice(0, 8).map((c, i) => (
                    <MiniTile key={c.id} label={c.name} image={c.image} tint={tints[i % tints.length]} onPress={() => router.push(`/category/${c.slug}`)} width={MINI_W} />
                  ))}
            </View>
          </Panel>
        )}

        <WatchAndShop />

        {carName && carQuery ? (
          <ProductRail
            title={`Fits your ${carName}`}
            subtitle="Parts matched to the car in your garage"
            products={forMyCar.data?.products ?? []}
            loading={forMyCar.isLoading}
            onSeeAll={() => router.push(carQuery as never)}
          />
        ) : (
          <ProductRail title="Popular" subtitle="Most bought by our customers" products={popular.data?.products ?? []} loading={popular.isLoading} />
        )}

        <ProductRail
          title="Today's Deals"
          products={dealList}
          loading={deals.isLoading}
          onSeeAll={() => router.push('/category/offers')}
        />

        {/* With a car saved, Popular wasn't shown above — show it here as best sellers. */}
        {carName && (
          <ProductRail title="Best sellers" products={popular.data?.products ?? []} loading={popular.isLoading} ranked />
        )}

        <ProductRail
          title="New arrivals"
          products={newest.data?.products ?? []}
          loading={newest.isLoading}
          onSeeAll={() => router.push('/(tabs)/shop')}
        />
      </Animated.ScrollView>

      <ScrollTopButton visible={showTop} onPress={scrollToTop} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  railContent: { paddingHorizontal: spacing.lg, paddingVertical: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },

  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  rowTitle: { fontFamily: font.heading, fontSize: 18, letterSpacing: -0.2, color: colors.ink },

  hero: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    width: HERO_W,
    height: HERO_H,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#1c2422',
  },
  heroShotWell: { position: 'absolute', right: 12, top: 12, height: HERO_H * 0.56, width: HERO_W * 0.42, alignItems: 'center', justifyContent: 'center' },
  heroShot: { width: '100%', height: '100%' },
  heroBody: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: spacing.lg },
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    maxWidth: '80%',
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  glassText: { flexShrink: 1, fontFamily: font.semibold, fontSize: 12.5, color: colors.white },
  heroTitle: { fontFamily: font.extrabold, fontSize: 26, lineHeight: 31, letterSpacing: -0.4, color: colors.white },
  heroSub: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.86)', marginTop: 2, maxWidth: '92%' },
  heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  heroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
  },
  heroBtnText: { fontFamily: font.bold, fontSize: 13.5, color: colors.ink },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotOn: { width: 16, backgroundColor: colors.white },

  reelRow: { paddingHorizontal: spacing.lg, gap: GRID_GAP },
  reelCard: { width: REEL_W, height: REEL_H, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.ink },
  reelScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  play: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reelMeta: { position: 'absolute', left: 8, right: 8, bottom: 9 },
  reelHandle: { fontFamily: font.medium, fontSize: 11, color: 'rgba(255,255,255,0.9)' },
  reelPrice: { fontFamily: font.bold, fontSize: 13.5, color: colors.white, marginTop: 1 },
});
