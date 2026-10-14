/**
 * Home — the shop front, laid out the way the website lays itself out on a
 * phone, because that view is the one the business already judged as right.
 *
 * The structure that matters is the white panel: every row on the site sits in
 * one on the grey page, with its own heading and its own "See all". Rows that
 * float loose on the background (what this screen did before) read as a pile of
 * widgets; panels read as a catalogue. The dense four-up tiles do the same job
 * from the other side — they put twelve ways into the catalogue above the fold
 * instead of one.
 *
 * Every row is live catalogue data. A row with nothing in it is not rendered
 * rather than padded with filler, and while data loads each row shows skeletons
 * in the shape of what is coming, so a slow connection reads as "loading".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Animated,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchBrands,
  fetchCategories,
  fetchOffers,
  fetchProducts,
  fetchTestimonials,
  fetchVehicleMakes,
  type Category,
  type Product,
} from '../../src/api/catalogue';
import AppHeader from '../../src/components/AppHeader';
import OfferSlider from '../../src/components/OfferSlider';
import ScrollTopButton from '../../src/components/ScrollTopButton';
import { useHeaderScroll, useScrollToTop } from '../../src/components/useHeaderScroll';
import ProductCard from '../../src/components/ProductCard';
import {
  Chip,
  MiniTile,
  Panel,
  Photo,
  ProductCardSkeleton,
  Skeleton,
  TextLink,
} from '../../src/components/ui';
import { colors, font, radius, spacing } from '../../src/theme';
import { useApp } from '../../src/store';

const { width: SCREEN } = Dimensions.get('window');

/** Usable width inside a panel, and the grid units derived from it. */
const PANEL_INNER = SCREEN - spacing.md * 2 - spacing.lg * 2;
const GRID_GAP = 10;
const MINI_W = Math.floor((PANEL_INNER - GRID_GAP * 3) / 4);
const BRAND_W = Math.floor((PANEL_INNER - GRID_GAP * 2) / 3);
const HERO_PHOTO = 112;

/** Support contacts live in config, never in a screen. */
const extra = (Constants.expoConfig?.extra ?? {}) as { supportPhone?: string; supportWhatsapp?: string };

// ── rails ────────────────────────────────────────────────────────────────────

/** A horizontal rail of product cards inside a panel, with loading skeletons. */
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
  /** Numbers the cards "#1 Best seller", as the website's best-seller row does. */
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

/** The dense four-up tile grid: categories, departments, quick deals. */
function MiniGrid({
  title,
  items,
  loading,
  linkLabel,
  onLink,
}: {
  title: string;
  items: { key: string; label: string; image?: string; onPress: () => void }[];
  loading: boolean;
  linkLabel: string;
  onLink: () => void;
}) {
  if (!loading && !items.length) return null;
  return (
    <Panel title={title}>
      <View style={s.grid}>
        {loading
          ? [0, 1, 2, 3].map((i) => (
              <View key={i} style={{ width: MINI_W, gap: 6 }}>
                <Skeleton width={MINI_W} height={MINI_W} radius={radius.sm} />
                <Skeleton width={MINI_W - 16} height={9} />
              </View>
            ))
          : items.map((it) => (
              <MiniTile key={it.key} label={it.label} image={it.image} onPress={it.onPress} width={MINI_W} />
            ))}
      </View>
      <TextLink label={linkLabel} onPress={onLink} style={{ marginTop: spacing.md }} />
    </Panel>
  );
}

// ── hero ─────────────────────────────────────────────────────────────────────

/**
 * The website's "Shop by vehicle" opener: the fitment promise first, the
 * photographs second. It sells the one thing that makes this shop different
 * from a generic marketplace, which a rotating product banner does not.
 */
function Hero({ photos, loading }: { photos: Product[]; loading: boolean }) {
  const router = useRouter();
  const rail = useRef<FlatList<Product>>(null);
  const touched = useRef(false);
  const slides = photos.slice(0, 8);

  // Drifts gently on its own, and yields the moment a thumb lands on it.
  useEffect(() => {
    if (slides.length < 3) return;
    let at = 0;
    const timer = setInterval(() => {
      if (touched.current) return;
      at = (at + 1) % Math.max(1, slides.length - 2);
      rail.current?.scrollToOffset({ offset: at * (HERO_PHOTO + GRID_GAP), animated: true });
    }, 3500);
    return () => clearInterval(timer);
  }, [slides.length]);

  // Pale mint with dark text, exactly as the website renders this block at
  // phone width. It also stops the home screen opening with two saturated green
  // panels stacked on each other, which read as one heavy slab.
  return (
    <LinearGradient
      colors={[colors.greenFaint, colors.greenSoft]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.hero}
    >
      <Text style={s.heroEyebrow}>SHOP BY VEHICLE</Text>
      <Text style={s.heroTitle}>Parts that fit your car</Text>
      <Text style={s.heroBody}>Choose your make and model — see only the upgrades that fit it.</Text>

      <Pressable
        onPress={() => router.push('/(tabs)/garage')}
        android_ripple={{ color: 'rgba(10,92,51,0.12)' }}
        style={({ pressed }) => [s.heroCta, pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
        accessibilityLabel="Find my parts"
      >
        <Text style={s.heroCtaText}>Find my parts</Text>
        <Ionicons name="arrow-forward" size={15} color={colors.white} />
      </Pressable>

      {loading ? (
        <View style={[s.heroRail, { flexDirection: 'row', gap: GRID_GAP }]}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={HERO_PHOTO} height={HERO_PHOTO * 0.78} radius={radius.md} />
          ))}
        </View>
      ) : slides.length ? (
        <FlatList
          ref={rail}
          horizontal
          data={slides}
          keyExtractor={(p) => p.id}
          style={s.heroRail}
          showsHorizontalScrollIndicator={false}
          snapToInterval={HERO_PHOTO + GRID_GAP}
          decelerationRate="fast"
          onTouchStart={() => { touched.current = true; }}
          ItemSeparatorComponent={() => <View style={{ width: GRID_GAP }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/product/${item.slug}`)}
              accessibilityRole="button"
              accessibilityLabel={item.name}
              style={({ pressed }) => [s.heroPhoto, pressed && { opacity: 0.85 }]}
            >
              <Photo uri={item.image} style={s.heroPhotoImg} contentFit="cover" />
            </Pressable>
          )}
        />
      ) : null}
    </LinearGradient>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { garage } = useApp();
  const scroller = useRef<ScrollView>(null);
  const [refreshing, setRefreshing] = useState(false);

  /*
    The header scrolls away with the content, as the website's does, so the
    full-size search bar is never traded for screen space. `0` because nothing
    collapses — the hook is here only for the back-to-top button.
  */
  const { onScroll, showTop } = useHeaderScroll(0);
  const scrollToTop = useScrollToTop(scroller);

  const [categories, deals, newest, popular, brands, reviews, makes] = useQueries({
    queries: [
      { queryKey: ['categories'], queryFn: () => fetchCategories() },
      { queryKey: ['home', 'deals'], queryFn: () => fetchOffers(14) },
      { queryKey: ['home', 'new'], queryFn: () => fetchProducts({ sort: '-createdAt', limit: 12 }) },
      { queryKey: ['home', 'popular'], queryFn: () => fetchProducts({ sort: '-salesScore', limit: 12 }) },
      { queryKey: ['brands'], queryFn: () => fetchBrands() },
      { queryKey: ['home', 'reviews'], queryFn: () => fetchTestimonials(8) },
      { queryKey: ['vehicleMakes'], queryFn: () => fetchVehicleMakes() },
    ],
  });

  const topCategories: Category[] = useMemo(
    () => (categories.data ?? []).filter((c) => !c.parentId),
    [categories.data],
  );

  // "Top in Lighting", "Top in Exterior"… — the website's per-department rails.
  // Three is enough to show depth without turning the home screen into a scroll
  // of near-identical rows.
  const departmentRails = useQueries({
    queries: topCategories.slice(0, 3).map((c) => ({
      queryKey: ['home', 'dept', c.slug],
      queryFn: () => fetchProducts({ category: c.slug, limit: 10 }),
    })),
  });

  // Parts that fit the saved car — the row that makes the garage worth setting.
  const [forMyCar] = useQueries({
    queries: [
      {
        queryKey: ['home', 'garage', garage?.make, garage?.model],
        queryFn: () => fetchProducts({ vehicleMake: garage?.make, vehicleModel: garage?.model, limit: 12 }),
        enabled: !!garage?.make,
      },
    ],
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      categories.refetch(),
      deals.refetch(),
      newest.refetch(),
      popular.refetch(),
      brands.refetch(),
      reviews.refetch(),
    ]);
    setRefreshing(false);
  }, [categories, deals, newest, popular, brands, reviews]);

  const dealList = deals.data ?? [];

  const departments = useMemo(
    () => [
      { label: "Today's Deals", onPress: () => router.push('/category/offers') },
      ...topCategories.slice(0, 8).map((c) => ({ label: c.name, onPress: () => router.push(`/category/${c.slug}`) })),
    ],
    [topCategories, router],
  );

  const call = (scheme: 'tel' | 'whatsapp') => {
    const phone = (scheme === 'tel' ? extra.supportPhone : extra.supportWhatsapp) ?? extra.supportPhone;
    if (!phone) return;
    const url = scheme === 'tel' ? `tel:${phone}` : `https://wa.me/${phone.replace(/[^0-9]/g, '')}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={s.screen}>
      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.green}
            colors={[colors.green]}
          />
        }
      >
        <AppHeader departments={departments} />

        {/* Offers first — the banner is what a shopper scans before anything
            else, and it is the only slot wide enough to actually sell one. */}
        <OfferSlider offers={dealList} loading={deals.isLoading} />

        <Hero photos={dealList.length ? dealList : (popular.data?.products ?? [])} loading={deals.isLoading} />

        <MiniGrid
          title="Shop by category"
          loading={categories.isLoading}
          items={topCategories.slice(0, 4).map((c) => ({
            key: c.id,
            label: c.name,
            image: c.image,
            onPress: () => router.push(`/category/${c.slug}`),
          }))}
          linkLabel="See all categories"
          onLink={() => router.push('/(tabs)/shop')}
        />

        <MiniGrid
          title="Upgrade your ride"
          loading={categories.isLoading}
          items={topCategories.slice(4, 8).map((c) => ({
            key: c.id,
            label: c.name,
            image: c.image,
            onPress: () => router.push(`/category/${c.slug}`),
          }))}
          linkLabel="Explore more"
          onLink={() => router.push('/(tabs)/shop')}
        />

        <MiniGrid
          title="Top deals for you"
          loading={deals.isLoading}
          items={dealList.slice(0, 4).map((p) => ({
            key: p.id,
            label: p.name,
            image: p.image,
            onPress: () => router.push(`/product/${p.slug}`),
          }))}
          linkLabel="See all deals"
          onLink={() => router.push('/category/offers')}
        />

        {/* Vehicle finder — the website's green-ruled card, as quick picks. */}
        <View style={s.finder}>
          <View style={s.finderHead}>
            <View style={s.finderIcon}>
              <Ionicons name="car-sport" size={17} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.finderTitle}>Parts that fit your car</Text>
              <Text style={s.finderSub}>Pick your car — we&apos;ll show only what fits.</Text>
            </View>
          </View>
          <View style={s.finderBody}>
            <Pressable
              onPress={() => router.push('/(tabs)/garage')}
              android_ripple={{ color: 'rgba(10,92,51,0.08)' }}
              style={({ pressed }) => [s.finderSelect, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel={garage ? 'Change your car' : 'Select your car'}
            >
              <Text style={s.finderSelectText} numberOfLines={1}>
                {garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : 'Select make and model'}
              </Text>
              <Ionicons name="chevron-down" size={17} color={colors.ink2} />
            </Pressable>
            <View style={s.finderChips}>
              {(makes.data ?? []).slice(0, 6).map((m) => (
                <Chip
                  key={m}
                  label={m}
                  active={garage?.make === m}
                  onPress={() => router.push(`/search?vehicleMake=${encodeURIComponent(m)}`)}
                />
              ))}
            </View>
          </View>
        </View>

        {garage?.make && (
          <ProductRail
            title={`For your ${garage.make}`}
            subtitle="Parts matched to the car in your garage"
            products={forMyCar?.data?.products ?? []}
            loading={!!forMyCar?.isLoading}
            onSeeAll={() =>
              router.push(
                `/search?vehicleMake=${encodeURIComponent(garage.make)}${
                  garage.model ? `&vehicleModel=${encodeURIComponent(garage.model)}` : ''
                }`,
              )
            }
          />
        )}

        <ProductRail
          title="Today's Deals"
          subtitle="Real savings on genuine parts — M.R.P. shown on every deal"
          products={dealList}
          loading={deals.isLoading}
          onSeeAll={() => router.push('/category/offers')}
        />

        <ProductRail
          title="Best Sellers"
          subtitle="Most bought by our customers"
          products={popular.data?.products ?? []}
          loading={popular.isLoading}
          ranked
        />

        {/* Trust — the website's 2×2, which is where it answers "why here". */}
        <Panel>
          <View style={s.trust}>
            {[
              { icon: 'shield-checkmark-outline' as const, title: 'Genuine parts', body: 'Sourced from trusted brands' },
              { icon: 'headset-outline' as const, title: 'Fitment support', body: 'Talk to a specialist before you buy' },
              { icon: 'lock-closed-outline' as const, title: 'Secure payments', body: 'Razorpay · UPI · Cards · EMI' },
              { icon: 'cube-outline' as const, title: 'Delivered across India', body: 'Track every order online' },
            ].map((t) => (
              <View key={t.title} style={s.trustItem}>
                <View style={s.trustIcon}>
                  <Ionicons name={t.icon} size={17} color={colors.green} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.trustTitle}>{t.title}</Text>
                  <Text style={s.trustBody}>{t.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </Panel>

        {topCategories.slice(0, 3).map((c, i) => (
          <ProductRail
            key={c.id}
            title={`Top in ${c.name}`}
            products={departmentRails[i]?.data?.products ?? []}
            loading={!!departmentRails[i]?.isLoading}
            onSeeAll={() => router.push(`/category/${c.slug}`)}
          />
        ))}

        <ProductRail
          title="New Arrivals"
          subtitle="Fresh additions to the catalogue"
          products={newest.data?.products ?? []}
          loading={newest.isLoading}
          onSeeAll={() => router.push('/(tabs)/shop')}
        />

        {/* Brands — bordered boxes in a grid, as on the site. */}
        {(brands.data ?? []).length > 0 && (
          <Panel title="Shop by brand" actionLabel="See all" onAction={() => router.push('/(tabs)/shop')}>
            <View style={s.grid}>
              {(brands.data ?? []).slice(0, 6).map((b) => (
                <Pressable
                  key={b.slug}
                  onPress={() => router.push(`/search?brand=${encodeURIComponent(b.name)}`)}
                  android_ripple={{ color: 'rgba(10,92,51,0.07)' }}
                  style={({ pressed }) => [s.brandBox, { width: BRAND_W }, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={b.name}
                >
                  {b.logo ? (
                    <Photo uri={b.logo} style={{ width: BRAND_W - 24, height: 34 }} contentFit="contain" />
                  ) : (
                    <Text style={s.brandName} numberOfLines={2}>{b.name}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          </Panel>
        )}

        {/* Reviews */}
        {(reviews.data ?? []).length > 0 && (
          <Panel title="What customers say" flush>
            <FlatList
              horizontal
              data={reviews.data ?? []}
              keyExtractor={(r) => r.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.railContent}
              ItemSeparatorComponent={() => <View style={{ width: GRID_GAP }} />}
              renderItem={({ item }) => (
                <View style={s.review}>
                  <View style={s.reviewStars}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Ionicons key={n} name={n <= item.rating ? 'star' : 'star-outline'} size={13} color={colors.star} />
                    ))}
                  </View>
                  <Text style={s.reviewText} numberOfLines={4}>{item.comment}</Text>
                  <View style={s.reviewWho}>
                    <View style={s.avatar}>
                      <Text style={s.avatarText}>{item.name.trim().charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={s.reviewName} numberOfLines={1}>{item.name}</Text>
                    {item.verified && <Ionicons name="checkmark-circle" size={13} color={colors.green} />}
                  </View>
                  {!!item.productName && <Text style={s.reviewProduct} numberOfLines={1}>{item.productName}</Text>}
                </View>
              )}
            />
          </Panel>
        )}

        {/* Footer — back to top, then the two ways to reach a human. */}
        <Pressable
          onPress={() => scroller.current?.scrollTo({ y: 0, animated: true })}
          android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
          style={s.backToTop}
          accessibilityRole="button"
          accessibilityLabel="Back to top"
        >
          <Ionicons name="arrow-up" size={15} color={colors.white} />
          <Text style={s.backToTopText}>Back to top</Text>
        </Pressable>

        <View style={s.footer}>
          {(['tel', 'whatsapp'] as const).map((how) => (
            <Pressable
              key={how}
              onPress={() => call(how)}
              disabled={!extra.supportPhone}
              android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
              style={s.footerItem}
              accessibilityRole="button"
              accessibilityLabel={how === 'tel' ? 'Call us' : 'Chat on WhatsApp'}
            >
              <Ionicons name={how === 'tel' ? 'call-outline' : 'logo-whatsapp'} size={20} color={colors.white} />
              <View style={{ flex: 1 }}>
                <Text style={s.footerTitle}>{how === 'tel' ? 'Call us' : 'WhatsApp'}</Text>
                <Text style={s.footerBody} numberOfLines={1}>
                  {how === 'tel' ? (extra.supportPhone ?? 'Talk to our team') : 'Chat with an expert'}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Animated.ScrollView>

      <ScrollTopButton visible={showTop} onPress={scrollToTop} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  railContent: { paddingHorizontal: spacing.lg, paddingVertical: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },

  hero: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    paddingLeft: spacing.lg,
    overflow: 'hidden',
  },
  heroEyebrow: {
    fontFamily: font.bold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.green,
  },
  heroTitle: { fontFamily: font.heading, fontSize: 22, lineHeight: 31, letterSpacing: -0.25, color: colors.ink, marginTop: 6 },
  heroBody: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink2,
    marginTop: 6,
    paddingRight: spacing.lg,
  },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    marginTop: spacing.lg,
    backgroundColor: colors.green,
    paddingHorizontal: spacing.xl,
    height: 44,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  heroCtaText: { fontFamily: font.bold, fontSize: 14, color: colors.white },
  heroRail: { marginTop: spacing.lg, overflow: 'visible' },
  heroPhoto: {
    width: HERO_PHOTO,
    height: HERO_PHOTO * 0.78,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  heroPhotoImg: { width: '100%', height: '100%' },

  finder: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.green,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  finderHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.green,
    padding: spacing.lg,
  },
  finderIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finderTitle: { fontFamily: font.bold, fontSize: 15, color: colors.white },
  finderSub: { fontFamily: font.regular, fontSize: 11.5, color: 'rgba(255,255,255,0.82)', marginTop: 1 },
  finderBody: { padding: spacing.lg, gap: spacing.md },
  finderSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  finderSelectText: { flex: 1, fontFamily: font.medium, fontSize: 13, color: colors.ink },
  finderChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  trust: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.lg },
  trustItem: { width: '50%', flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.sm },
  trustIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.greenFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustTitle: { fontFamily: font.semibold, fontSize: 12, lineHeight: 17, color: colors.ink },
  trustBody: { fontFamily: font.regular, fontSize: 11.5, lineHeight: 16, color: colors.muted, marginTop: 1 },

  brandBox: {
    height: 68,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    overflow: 'hidden',
  },
  brandName: { fontFamily: font.bold, fontSize: 11.5, color: colors.ink, textAlign: 'center' },

  review: {
    width: 258,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  reviewStars: { flexDirection: 'row', gap: 2 },
  reviewText: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 19, color: colors.ink2 },
  reviewWho: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.bold, fontSize: 12, color: colors.green },
  reviewName: { flex: 1, fontFamily: font.semibold, fontSize: 12, color: colors.ink },
  reviewProduct: { fontFamily: font.medium, fontSize: 11.5, color: colors.green },

  backToTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.green,
    overflow: 'hidden',
  },
  backToTopText: { fontFamily: font.semibold, fontSize: 13, color: colors.white },

  footer: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.header,
    overflow: 'hidden',
  },
  footerItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  footerTitle: { fontFamily: font.semibold, fontSize: 13, color: colors.white },
  footerBody: { fontFamily: font.regular, fontSize: 11.5, color: 'rgba(255,255,255,0.65)', marginTop: 1 },
});
