/**
 * Home — matches autobacsindia.com's DEFAULT light store theme (owner,
 * 2026-11-22): dark header with the logo, "Parts for <car>" and search; the
 * website's hero banners; Instagram-style reels; the website's category cards;
 * product rails in the website card style; a light page throughout.
 *
 * Top to bottom: header, hero carousel (admin promo banner + the website's
 * Today's Deals / Shop by vehicle / New arrivals slides, or category photos
 * when there are none), reels stories + "Shop the reel", category cards,
 * "Fits your car" (or Popular with an add-your-car prompt), today's deals,
 * brands, best sellers, new arrivals.
 *
 * Every row is live catalogue data. A row with nothing in it is not rendered,
 * and while data loads each row shows a skeleton in the shape of what is
 * coming. Nothing here computes a price: cards show what the server sent, and
 * the hero's "Up to N% off" is the largest discount the server reported.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, RefreshControl, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueries } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchActiveBanner, fetchCategories, fetchOffers, fetchProducts, type Category, type Product } from '../../src/api/catalogue';
import AppHeader from '../../src/components/AppHeader';
import ScrollTopButton from '../../src/components/ScrollTopButton';
import { useHeaderScroll, useScrollToTop } from '../../src/components/useHeaderScroll';
import HeroCarousel, { HeroSkeleton, type HeroPhoto, type HeroSlide } from '../../src/home/HeroCarousel';
import ShopTheReel from '../../src/home/ShopTheReel';
import ProductRail from '../../src/home/ProductRail';
import BrandStrip from '../../src/home/BrandStrip';
import { CategoryQuads } from '../../src/home/Collections';
import { colors, font, radius, spacing, type } from '../../src/theme';
import { PressScale, Stripes } from '../../src/ui';
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

/**
 * The website's hero slides (Front-end/web `StoreHome.buildSlides`), at phone
 * size. Photos are handed out ACROSS slides so two slides never show the same
 * three products — the same rule the website follows.
 */
function buildHeroSlides(input: {
  banner: { image: string; title: string; route: string } | null;
  deals: Product[];
  popular: Product[];
  newest: Product[];
  categories: Category[];
  car: { name: string; route: string } | null;
}): HeroSlide[] {
  const used = new Set<string>();
  const photos = (pool: Product[]): HeroPhoto[] => {
    const chosen: Product[] = [];
    for (const p of pool) {
      if (chosen.length >= 3) break;
      if (!p.image || used.has(p.id)) continue;
      chosen.push(p);
      used.add(p.id);
    }
    return chosen.map((p) => ({ uri: p.image as string, route: `/product/${p.slug}`, name: p.name }));
  };

  const out: HeroSlide[] = [];
  if (input.banner) {
    out.push({ kind: 'banner', key: 'banner', image: input.banner.image, title: input.banner.title, cta: 'Shop the offer', route: input.banner.route });
  }

  const maxOff = input.deals.reduce((m, p) => Math.max(m, p.discountPercent || 0), 0);
  const hasDeals = input.deals.length >= 3 && maxOff > 0;
  if (hasDeals) {
    out.push({
      kind: 'tone',
      key: 'deals',
      tone: 'green',
      eyebrow: "Today's deals",
      title: `Up to ${maxOff}% off on top upgrades`,
      subtitle: 'Suspension, body kits, lighting and more.',
      cta: 'Shop the deals',
      route: '/category/offers',
      photos: photos(input.deals.filter((d) => d.discountPercent > 0)),
    });
  }

  out.push({
    kind: 'tone',
    key: 'vehicle',
    tone: 'mint',
    eyebrow: 'Shop by vehicle',
    title: input.car ? `Parts that fit your ${input.car.name}` : 'Parts that fit your car',
    subtitle: 'Choose your make and model — see only the upgrades that fit it.',
    cta: input.car ? 'Find my parts' : 'Add my car',
    route: input.car ? input.car.route : '/garage',
    photos: photos(input.popular.length >= 3 ? input.popular : input.newest),
  });

  const hasNew = input.newest.length >= 3;
  if (hasNew) {
    out.push({
      kind: 'tone',
      key: 'new',
      tone: 'light',
      eyebrow: 'Just landed',
      title: 'New arrivals this week',
      subtitle: 'Fresh additions from brands you trust.',
      cta: 'See what\u2019s new',
      route: '/(tabs)/shop',
      photos: photos(input.newest),
    });
  }

  // No banner and no catalogue slides: build the hero from category photos.
  if (!input.banner && !hasDeals && !hasNew) {
    for (const c of input.categories.filter((x) => !!x.image).slice(0, 3)) {
      out.push({ kind: 'photo', key: `cat-${c.id}`, image: c.image, eyebrow: 'Shop by category', title: c.name, cta: 'Explore', route: `/category/${c.slug}` });
    }
  }
  return out;
}

/** Shown instead of "Fits your car" until a car is saved. */
function AddCarPrompt() {
  const router = useRouter();
  return (
    <PressScale onPress={() => router.push('/garage')} haptic="light" style={s.addCar} accessibilityLabel="Add your car to see parts that fit">
      <View style={s.addCarIcon}>
        <Ionicons name="car-sport" size={22} color={colors.white} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.addCarTitle}>Add your car</Text>
        <Text style={s.addCarBody}>See only the parts that fit it.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.green} />
    </PressScale>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { garage } = useApp();
  const insets = useSafeAreaInsets();
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

  const carName = garage ? garage.model || garage.make : null;
  const carQuery = garage
    ? `/search?vehicleMake=${encodeURIComponent(garage.make)}${garage.model ? `&vehicleModel=${encodeURIComponent(garage.model)}` : ''}`
    : null;

  const heroSlides: HeroSlide[] = useMemo(() => {
    const b = banner.data;
    const image = b ? b.mobileImageUrl || b.imageUrl : null;
    return buildHeroSlides({
      banner: b && image ? { image, title: b.title || "Today's offers", route: bannerRoute(b.linkPath) } : null,
      deals: deals.data ?? [],
      popular: popular.data?.products ?? [],
      newest: newest.data?.products ?? [],
      categories: topCategories,
      car: carName && carQuery ? { name: carName, route: carQuery } : null,
    });
  }, [banner.data, deals.data, popular.data, newest.data, topCategories, carName, carQuery]);

  return (
    <View style={s.screen}>
      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} colors={[colors.green]} />}
      >
        {/* iOS pull-down bounce shows the bar colour above the header, not the page. */}
        <View pointerEvents="none" style={s.overscroll} />
        <AppHeader />

        <View style={{ marginTop: spacing.lg }}>
          {deals.isLoading || banner.isLoading || (popular.isLoading && newest.isLoading) ? (
            <HeroSkeleton />
          ) : (
            <HeroCarousel slides={heroSlides} />
          )}
        </View>

        <ShopTheReel />

        <CategoryQuads categories={topCategories} deals={deals.data ?? []} loading={categories.isLoading} />

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
            <ProductRail overline="Most bought" title="Best sellers" products={popular.data?.products ?? []} loading={popular.isLoading} ranked />
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
          <Stripes />
          <Text style={s.signoffText}>Genuine parts · Delivered across India</Text>
        </View>
      </Animated.ScrollView>

      {/* The header scrolls away; this keeps the (light) status bar on the dark bar colour. */}
      <View pointerEvents="none" style={[s.statusPlate, { height: insets.top }]} />

      <ScrollTopButton visible={showTop} onPress={scrollToTop} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  overscroll: { position: 'absolute', top: -1000, left: 0, right: 0, height: 1000, backgroundColor: colors.header },
  statusPlate: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.header },

  addCar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xxl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.greenFaint,
    borderWidth: 1,
    borderColor: colors.greenSoft,
  },
  addCarIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCarTitle: { ...type.h3 },
  addCarBody: { ...type.small, marginTop: 1 },

  signoff: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxxl },
  signoffText: { fontFamily: font.medium, fontSize: 12, color: colors.muted },
});
