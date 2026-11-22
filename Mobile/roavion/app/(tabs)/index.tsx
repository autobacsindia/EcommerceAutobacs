/**
 * Home — Heritage Noir (owner approved 2026-11-22).
 *
 * Top to bottom: full-bleed hero carousel (promo banner + brand slide + top
 * deals, with the glass car chip) with the crest header laid over it, square
 * carbon search, "Shop the reel", collections, "Fits your car" (or Popular,
 * with an add-your-car prompt), today's deals, brands marquee, best sellers,
 * new arrivals.
 *
 * Every row is live catalogue data. A row with nothing in it is not rendered,
 * and while data loads each row shows a skeleton in the shape of what is
 * coming. Nothing here computes a price: cards show what the server sent.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, RefreshControl, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchActiveBanner, fetchCategories, fetchOffers, fetchProducts, type Category } from '../../src/api/catalogue';
import AppHeader, { SearchField } from '../../src/components/AppHeader';
import ScrollTopButton from '../../src/components/ScrollTopButton';
import { useHeaderScroll, useScrollToTop } from '../../src/components/useHeaderScroll';
import HeroCarousel, { HeroSkeleton, type HeroSlide } from '../../src/home/HeroCarousel';
import ShopTheReel from '../../src/home/ShopTheReel';
import ProductRail from '../../src/home/ProductRail';
import BrandStrip from '../../src/home/BrandStrip';
import { CuratedCollections } from '../../src/home/Collections';
import { font, noir, spacing, type } from '../../src/theme';
import { GoldRule, PressScale, SerifTitle } from '../../src/ui';
import { useApp } from '../../src/store';

/** Map a web banner link to an app route; anything unknown opens the offers list. */
function bannerRoute(linkPath?: string | null): string {
  const path = (linkPath || '/offers').split('?')[0].replace(/\/+$/, '');
  const product = path.match(/^\/products?\/([^/]+)$/);
  if (product) return `/product/${product[1]}`;
  const category = path.match(/^\/(?:category|categories)\/([^/]+)$/);
  if (category) return `/category/${category[1]}`;
  return '/category/offers';
}

const BRAND_SLIDE: HeroSlide = {
  key: 'brand',
  overline: 'Autobacs India',
  title: 'Make it yours.',
  subtitle: 'Genuine parts and accessories, matched to your car.',
  cta: 'Shop now',
  route: '/(tabs)/shop',
  italicLast: true,
};

/** Shown instead of "Fits your car" until a car is saved. */
function AddCarPrompt() {
  const router = useRouter();
  return (
    <PressScale onPress={() => router.push('/garage')} haptic="light" style={s.addCar} accessibilityLabel="Add your car to see parts that fit">
      <View style={s.addCarIcon}>
        <Ionicons name="car-sport-outline" size={20} color={noir.text} />
      </View>
      <View style={{ flex: 1 }}>
        <SerifTitle size="small" style={s.addCarTitle}>Add your car</SerifTitle>
        <Text style={s.addCarBody}>See only the parts that fit it.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={noir.gold} />
    </PressScale>
  );
}

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

  const heroSlides: HeroSlide[] = useMemo(() => {
    const out: HeroSlide[] = [];
    // The admin's promo banner leads: it is the real photo the hero is built for.
    const b = banner.data;
    if (b && (b.mobileImageUrl || b.imageUrl)) {
      out.push({
        key: 'banner',
        overline: "Today's offer",
        title: b.title || "Today's offers",
        cover: b.mobileImageUrl || b.imageUrl,
        cta: 'Shop the offer',
        route: bannerRoute(b.linkPath),
        italicLast: true,
      });
    }
    out.push(BRAND_SLIDE);
    for (const d of (deals.data ?? []).filter((x) => !!x.image).slice(0, 3)) {
      out.push({
        key: d.id,
        // Display only: the discount the server reported.
        overline: d.discountPercent > 0 ? `Deal · ${d.discountPercent}% off` : 'Featured deal',
        title: d.name,
        subtitle: d.brand ? `by ${d.brand}` : undefined,
        product: d.image,
        cta: 'View deal',
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
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={noir.gold} colors={[noir.green]} progressBackgroundColor={noir.surface} />}
      >
        {/* Full-bleed hero with the crest header laid over its top. */}
        <View>
          {deals.isLoading || banner.isLoading ? <HeroSkeleton /> : <HeroCarousel slides={heroSlides} />}
          <AppHeader style={s.header} />
        </View>

        <SearchField style={{ marginHorizontal: spacing.lg, marginTop: spacing.xs }} />

        <ShopTheReel />

        <CuratedCollections categories={topCategories} loading={categories.isLoading} />

        {carName && carQuery ? (
          <ProductRail
            overline="Fits your car"
            title={`Made for your ${carName}`}
            products={forMyCar.data?.products ?? []}
            loading={forMyCar.isLoading}
            onSeeAll={() => router.push(carQuery as never)}
          />
        ) : (
          <>
            <AddCarPrompt />
            <ProductRail overline="Loved by drivers" title="Popular right now" products={popular.data?.products ?? []} loading={popular.isLoading} />
          </>
        )}

        <ProductRail
          overline="Limited time"
          title="Today's deals"
          products={deals.data ?? []}
          loading={deals.isLoading}
          onSeeAll={() => router.push('/category/offers')}
        />

        <BrandStrip />

        {/* With a car saved, Popular wasn't shown above — show it here as best sellers. */}
        {carName && (
          <ProductRail overline="Most bought" title="Best sellers" products={popular.data?.products ?? []} loading={popular.isLoading} ranked />
        )}

        <ProductRail
          overline="Just in"
          title="New arrivals"
          products={newest.data?.products ?? []}
          loading={newest.isLoading}
          onSeeAll={() => router.push('/(tabs)/shop')}
        />

        <View style={s.signoff}>
          <GoldRule label="Autobacs" style={{ alignSelf: 'stretch' }} />
          <Text style={s.signoffText}>Genuine parts · Delivered across India</Text>
        </View>
      </Animated.ScrollView>

      <ScrollTopButton visible={showTop} onPress={scrollToTop} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: noir.page },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },

  addCar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xxl,
    padding: spacing.lg,
    backgroundColor: noir.greenWash,
    borderWidth: 1,
    borderColor: noir.greenText,
  },
  addCarIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: noir.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCarTitle: { fontSize: 16, lineHeight: 20 },
  addCarBody: { ...type.smallNoir, marginTop: 2 },

  signoff: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxxl, paddingHorizontal: spacing.xxl },
  signoffText: { fontFamily: font.medium, fontSize: 12, color: noir.textFaint },
});
