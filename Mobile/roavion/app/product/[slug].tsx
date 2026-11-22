/**
 * Product detail — "Heritage Noir" (owner approved 2026-11-22): a full-bleed
 * gallery with line dots and glass round back / share / heart buttons, a gold
 * "Watch in reels · n" chip, gold brand overline, serif title, price with
 * struck MRP and a red % OFF tag, a green "Fits your car" box, trust tiles and
 * a frosted sticky bar (gold hairline) with ADD TO CART / BUY NOW.
 *
 * The price shown is the server's price. "Add to cart" sends an id and a
 * quantity and nothing else; "Buy now" is the same add followed by the same
 * route to checkout the cart screen uses. What the customer pays is decided
 * entirely by the backend.
 *
 * Everything on screen is backed by data: "Fits your car" comes from the
 * product's own compatibility list, the reels chip only shows when a loaded
 * reel tags this product, and there is NO delivery-date promise because the
 * product API does not return one.
 */
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../../src/api/client';
import { fetchProduct, fetchProducts, type Product } from '../../src/api/catalogue';
import ProductCard from '../../src/components/ProductCard';
import { Photo } from '../../src/components/ui';
import { useReelFeed } from '../../src/reels/useReels';
import { font, inr, noir, noirSurface, radius, spacing, type } from '../../src/theme';
import { useApp, type Garage } from '../../src/store';
import {
  EmptyState,
  ErrorState,
  GlassChip,
  GoldRule,
  HeroScrim,
  IconButton,
  LineDots,
  Overline,
  PremiumButton,
  PressScale,
  ProductDetailSkeleton,
  Rating,
  SectionHeader,
  SerifTitle,
  useToast,
} from '../../src/ui';
import { ZoomViewer } from '../../src/product/ZoomViewer';
import { useSaved } from '../../src/product/useSaved';

const SITE = (Constants.expoConfig?.extra as { siteUrl?: string } | undefined)?.siteUrl ?? 'https://www.autobacsindia.com';

/** True only when the product's own compatibility list names the saved car. */
function fitsCar(p: Product, garage: Garage | null): boolean {
  if (!garage?.make) return false;
  const make = garage.make.trim().toLowerCase();
  const model = garage.model?.trim().toLowerCase();
  return p.fits.some(
    (f) => f.make.trim().toLowerCase() === make && (!model || !f.model || f.model.trim().toLowerCase() === model),
  );
}

/** Square hairline tile: gold icon + short fact. */
function TrustTile({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={s.tile}>
      <Ionicons name={icon} size={16} color={noir.gold} />
      <Text style={s.tileText} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const galleryH = Math.round(width * 1.02);
  const toast = useToast();
  const { addItem, cartBusy, cart, customer, garage } = useApp();
  const [photo, setPhoto] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const [buying, setBuying] = useState(false);

  const product = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(String(slug)),
    enabled: !!slug,
  });

  const p = product.data;
  const heart = useSaved(p?.id);
  // "More like this" uses the brand, which is the closest signal the list API gives.
  const related = useQuery({
    queryKey: ['related', p?.brand, p?.id],
    queryFn: () => fetchProducts({ brand: p?.brand, limit: 10 }),
    enabled: !!p?.brand,
  });

  // Reels already loaded in the feed that tag this product. Hidden when none.
  const feed = useReelFeed();
  const seenIn = useMemo(() => (p ? feed.reels.filter((r) => r.product?.id === p.id).slice(0, 10) : []), [feed.reels, p]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (product.isLoading || product.error || !p) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.screen}>
          {product.isLoading ? (
            <ProductDetailSkeleton dark />
          ) : product.error ? (
            <ErrorState error={product.error} onRetry={() => product.refetch()} onDark />
          ) : (
            <EmptyState
              icon="pricetag-outline"
              title="Product not found"
              body="It may have been removed from the catalogue."
              action={{ label: 'Browse the shop', onPress: () => router.replace('/(tabs)/shop') }}
              onDark
            />
          )}
          <IconButton icon="chevron-back" label="Go back" tone="glass" onPress={back} style={[s.floatLeft, { top: insets.top + spacing.sm }]} />
        </View>
      </>
    );
  }

  const soldOut = p.stock === 'out';
  const fits = fitsCar(p, garage);
  const carName = garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : '';

  const showAdded = () => {
    setAdded(true);
    toast.show({
      message: 'Added to your cart',
      tone: 'success',
      icon: 'checkmark-circle',
      action: { label: 'View cart', onPress: () => router.push('/(tabs)/cart') },
    });
    setTimeout(() => setAdded(false), 2000);
  };

  const fail = (err: unknown) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    Alert.alert('Not added', err instanceof ApiError ? err.message : 'Could not add to cart. Please try again.');
  };

  const onAdd = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await addItem(p.id, 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showAdded();
    } catch (err) {
      fail(err);
    }
  };

  const onBuy = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setBuying(true);
    try {
      await addItem(p.id, 1);
      router.push(customer ? '/checkout' : '/login?next=/checkout');
    } catch (err) {
      fail(err);
    } finally {
      setBuying(false);
    }
  };

  const onHeart = async () => {
    const now = await heart.toggle();
    toast.show({ message: now ? 'Saved on this phone' : 'Removed from saved', icon: now ? 'heart' : 'heart-outline', duration: 1600 });
  };

  // Same share shape the Reels tab uses (iOS takes a url, Android a message).
  const onShare = () => {
    const url = `${SITE}/products/${p.slug}`;
    Share.share(
      Platform.OS === 'ios' ? { url, message: `${p.name} on Autobacs` } : { message: `${p.name} on Autobacs\n${url}`, title: p.name },
    ).catch(() => {});
  };

  const photos = p.images.length ? p.images : [''];
  const related_ = (related.data?.products ?? []).filter((r) => r.id !== p.id);
  const about = p.description.replace(/<[^>]*>/g, '').trim();
  // Display only — the server's numbers. "% OFF" prefers the server's value.
  const was = p.mrp != null && p.mrp > p.price ? p.mrp : null;
  const off = p.discountPercent && p.discountPercent > 0 ? p.discountPercent : was ? Math.round(((was - p.price) / was) * 100) : 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.screen}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
          {/* Full-bleed gallery — tap any photo for full-screen pinch-zoom. */}
          <View style={[s.gallery, { height: galleryH + insets.top }]}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhoto(Math.round(e.nativeEvent.contentOffset.x / width))}
            >
              {photos.map((uri, i) => (
                <Pressable
                  key={`${uri}-${i}`}
                  onPress={() => uri && setZoomOpen(true)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Photo ${i + 1} of ${photos.length}. Tap to zoom`}
                  style={{ width, height: galleryH + insets.top }}
                >
                  <Photo uri={uri} style={{ width, height: galleryH + insets.top }} />
                </Pressable>
              ))}
            </ScrollView>

            {/* Dark top for the buttons, straight into carbon at the bottom. */}
            <HeroScrim variant="gallery" />

            <View style={s.galleryFoot} pointerEvents="box-none">
              {seenIn.length > 0 ? (
                <GlassChip
                  tone="gold"
                  icon="play"
                  label={`Watch in reels · ${seenIn.length}`}
                  onPress={() => router.push({ pathname: '/(tabs)/reels', params: { start: seenIn[0].id } })}
                />
              ) : (
                <View />
              )}
              <LineDots count={photos.length} index={photo} />
            </View>
          </View>

          <View style={s.body}>
            {!!p.brand && <Overline tone="gold">{p.brand}</Overline>}
            <SerifTitle size="product" style={s.title} accessibilityRole="header">
              {p.name}
            </SerifTitle>

            <View style={s.metaRow}>
              <Rating rating={p.rating} count={p.reviews} onDark />
              {p.stock === 'low' && <Text style={s.low}>Only a few left</Text>}
              {soldOut && <Text style={s.outText}>Out of stock</Text>}
            </View>

            <View style={s.priceRow} accessibilityLabel={`Price ${inr(p.price)}${was ? `, was ${inr(was)}` : ''}${off > 0 ? `, ${off}% off` : ''}`}>
              <Text style={s.price}>{inr(p.price)}</Text>
              {was != null && <Text style={s.mrp}>{inr(was)}</Text>}
              {off > 0 && (
                <View style={s.offTag}>
                  <Text style={s.offText}>{off}% OFF</Text>
                </View>
              )}
            </View>
            <Text style={s.taxNote}>Inclusive of all taxes · Delivery calculated at checkout</Text>

            {/* "Fits your car" — only from the product's own compatibility list. */}
            {fits && (
              <View style={s.fits}>
                <Ionicons name="checkmark" size={16} color={noir.greenText} />
                <Text style={s.fitsText} numberOfLines={1}>
                  Fits your <Text style={s.fitsCar}>{carName}</Text>
                </Text>
              </View>
            )}
            {!garage && p.fits.length > 0 && (
              <PressScale onPress={() => router.push('/garage')} haptic="selection" style={s.fitsCheck} accessibilityLabel="Check it fits your car">
                <Ionicons name="car-sport-outline" size={16} color={noir.greenText} />
                <Text style={s.fitsText}>Check it fits your car</Text>
                <Ionicons name="chevron-forward" size={14} color={noir.textMuted} />
              </PressScale>
            )}

            <View style={s.tiles}>
              <TrustTile icon="shield-checkmark-outline" label="Genuine parts" />
              <TrustTile icon="car-outline" label="Delivered across India" />
            </View>
            {(p.stock === 'in' || p.returnable) && (
              <View style={[s.tiles, { marginTop: spacing.sm }]}>
                {p.stock === 'in' && <TrustTile icon="cube-outline" label="In stock" />}
                {p.returnable && <TrustTile icon="repeat-outline" label="Easy returns" />}
              </View>
            )}
          </View>

          {seenIn.length > 0 && (
            <View style={s.section}>
              <SectionHeader noir overline="As seen on" title="Autobacs reels" italicLast />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.reelRow}>
                {seenIn.map((r) => (
                  <PressScale
                    key={r.id}
                    haptic="selection"
                    onPress={() => router.push({ pathname: '/(tabs)/reels', params: { start: r.id } })}
                    style={s.reelThumb}
                    accessibilityLabel={`Reel by ${r.creator.name}`}
                  >
                    {/* No poster on R2 reels yet: fall back to the product photo. */}
                    {(r.posterUrl || r.product?.image) ? (
                      <Image source={{ uri: (r.posterUrl || r.product?.image) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                    ) : null}
                    <HeroScrim variant="tile" />
                    <View style={s.reelPlay}>
                      <Ionicons name="play" size={13} color={noir.text} />
                    </View>
                    <Text style={s.reelBy} numberOfLines={1}>{r.creator.name}</Text>
                  </PressScale>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={s.body}>
            {!!about && (
              <View style={s.block}>
                <Overline noir>Overview</Overline>
                <SerifTitle size="section" italicLast style={{ marginTop: 4 }}>About this product</SerifTitle>
                <Text style={s.para}>{about}</Text>
              </View>
            )}

            {p.features.length > 0 && (
              <View style={s.block}>
                <Overline noir>Highlights</Overline>
                <SerifTitle size="section" italicLast style={{ marginTop: 4 }}>Key features</SerifTitle>
                <View style={s.featureCard}>
                  {p.features.map((f, i) => (
                    <View key={i} style={[s.bullet, i < p.features.length - 1 && s.bulletLine]}>
                      <Ionicons name="checkmark" size={15} color={noir.greenText} style={{ marginTop: 3 }} />
                      <Text style={s.bulletText}>{f}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={s.assure}>
              {[
                { icon: 'shield-checkmark-outline' as const, title: 'Genuine', text: 'From the brand' },
                { icon: 'repeat-outline' as const, title: 'Returns', text: 'Hassle-free' },
                { icon: 'headset-outline' as const, title: 'Fitment', text: 'Expert help' },
              ].map((a) => (
                <View key={a.title} style={s.assureItem}>
                  <Ionicons name={a.icon} size={20} color={noir.gold} />
                  <Text style={s.assureTitle}>{a.title}</Text>
                  <Text style={s.assureText}>{a.text}</Text>
                </View>
              ))}
            </View>
          </View>

          {related_.length > 0 && (
            <View style={s.section}>
              <SectionHeader noir overline={p.brand || 'More'} title="More from this brand" italicLast />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
                {related_.map((r) => <ProductCard key={r.id} product={r} />)}
              </ScrollView>
            </View>
          )}
        </ScrollView>

        {/* Glass round buttons over the gallery */}
        <IconButton icon="chevron-back" label="Go back" tone="glass" onPress={back} style={[s.floatLeft, { top: insets.top + spacing.sm }]} />
        <View style={[s.floatRight, { top: insets.top + spacing.sm }]}>
          <IconButton icon="share-outline" label="Share this product" tone="glass" onPress={onShare} />
          <IconButton
            icon={heart.saved ? 'heart' : 'heart-outline'}
            tone="glass"
            color={heart.saved ? noir.gold : undefined}
            label={heart.saved ? 'Remove from saved' : 'Save this product'}
            onPress={onHeart}
          />
          <IconButton
            icon="bag-handle-outline"
            tone="glass"
            label={`Cart, ${cart.totalItems} items`}
            onPress={() => router.push('/(tabs)/cart')}
            badge={cart.totalItems}
          />
        </View>

        {/* Sticky frosted buy bar with a gold hairline */}
        <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />}
          <GoldRule style={s.barRule} />
          <PremiumButton
            label={soldOut ? 'Out of stock' : added ? 'Added' : 'Add to cart'}
            icon={added ? 'checkmark' : undefined}
            variant="noirOutline"
            onPress={onAdd}
            disabled={soldOut || buying}
            loading={cartBusy && !buying}
            haptic={false}
            style={{ flex: 1 }}
          />
          <PremiumButton
            label="Buy now"
            variant="noir"
            onPress={onBuy}
            disabled={soldOut || cartBusy}
            loading={buying}
            haptic={false}
            style={{ flex: 1 }}
          />
        </View>

        {zoomOpen && <ZoomViewer photos={photos.filter(Boolean)} index={photo} visible onClose={() => setZoomOpen(false)} />}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: noir.page },
  gallery: { backgroundColor: noir.surface },
  galleryFoot: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },

  floatLeft: { position: 'absolute', left: spacing.lg },
  floatRight: { position: 'absolute', right: spacing.lg, flexDirection: 'row', gap: spacing.sm },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  title: { marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  low: { ...type.capsNoir, color: noir.gold },
  outText: { ...type.capsNoir, color: noir.sale },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  price: { fontFamily: font.heading, fontSize: 26, color: noir.text },
  mrp: { fontFamily: font.medium, fontSize: 14, color: noir.textFaint, textDecorationLine: 'line-through' },
  offTag: { backgroundColor: noir.sale, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.square, alignSelf: 'center' },
  offText: { fontFamily: font.heading, fontSize: 10, letterSpacing: 0.6, color: noir.text },
  taxNote: { ...type.smallNoir, fontSize: 12, color: noir.textFaint, marginTop: 2 },

  fits: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg,
    backgroundColor: noir.greenWash, borderWidth: 1, borderColor: noir.greenText, borderRadius: radius.square,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  fitsCheck: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg,
    borderWidth: 1, borderColor: noir.hairlineStrong, borderRadius: radius.square, paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  fitsText: { flex: 1, fontFamily: font.medium, fontSize: 13, color: noir.text },
  fitsCar: { fontFamily: font.bold },

  tiles: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  tile: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderWidth: 1, borderColor: noir.hairline, borderRadius: radius.square,
  },
  tileText: { flex: 1, fontFamily: font.medium, fontSize: 12, color: noir.textMuted },

  section: { marginTop: spacing.xl },
  reelRow: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  reelThumb: {
    width: 104, height: 184, borderRadius: radius.none, overflow: 'hidden', backgroundColor: noir.surface,
    justifyContent: 'flex-end', borderBottomWidth: 2, borderBottomColor: noir.gold,
  },
  reelPlay: {
    position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13,
    backgroundColor: noir.glassIcon, alignItems: 'center', justifyContent: 'center',
  },
  reelBy: { fontFamily: font.bold, fontSize: 11, color: noir.text, padding: spacing.sm },

  block: { marginTop: spacing.xl },
  para: { ...type.bodyNoir, marginTop: spacing.sm, color: noir.textMuted },
  featureCard: { ...noirSurface, marginTop: spacing.md, paddingHorizontal: spacing.lg },
  bullet: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.md },
  bulletLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: noir.hairline },
  bulletText: { ...type.bodyNoir, flex: 1 },

  assure: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  assureItem: { ...noirSurface, flex: 1, alignItems: 'center', gap: 2, paddingVertical: spacing.lg },
  assureTitle: { fontFamily: font.semibold, fontSize: 13, color: noir.text, marginTop: spacing.xs },
  assureText: { fontFamily: font.regular, fontSize: 11.5, color: noir.textFaint },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, backgroundColor: Platform.OS === 'ios' ? 'transparent' : noir.glassStrong, overflow: 'hidden',
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
  },
  barRule: { position: 'absolute', top: 0, left: 0, right: 0 },
});
