/**
 * Product detail — design "A clean light + C car line" (owner approved
 * 2026-11-18): full-bleed gallery with dots and a floating back button, brand,
 * title, price, rating, a "Fits your <car>" tag, a "Seen in reels" row, and a
 * sticky Add to cart / Buy now bar.
 *
 * The price shown is the server's price. "Add to cart" sends an id and a
 * quantity and nothing else; "Buy now" is the same add followed by the same
 * route to checkout the cart screen uses. What the customer pays is decided
 * entirely by the backend.
 */
import { useMemo, useState } from 'react';
import { Alert, Animated, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../../src/api/client';
import { fetchProduct, fetchProducts, type Product } from '../../src/api/catalogue';
import ProductCard from '../../src/components/ProductCard';
import { Badge, Button, Photo, Screenful, SectionHeader, T } from '../../src/components/ui';
import { useReelFeed } from '../../src/reels/useReels';
import { colors, font, inr, radius, shadow, spacing } from '../../src/theme';
import { useApp, type Garage } from '../../src/store';

const { width } = Dimensions.get('window');
const GALLERY_H = Math.round(width * 0.95);

/** True only when the product's own compatibility list names the saved car. */
function fitsCar(p: Product, garage: Garage | null): boolean {
  if (!garage?.make) return false;
  const make = garage.make.trim().toLowerCase();
  const model = garage.model?.trim().toLowerCase();
  return p.fits.some(
    (f) => f.make.trim().toLowerCase() === make && (!model || !f.model || f.model.trim().toLowerCase() === model),
  );
}

function FloatingButton({ icon, onPress, label, top }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string; top: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[s.float, s.floatLeft, { top }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={colors.ink} />
    </Pressable>
  );
}

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addItem, cartBusy, cart, customer, garage } = useApp();
  const [photo, setPhoto] = useState(0);
  const [added, setAdded] = useState(false);
  const [buying, setBuying] = useState(false);
  const [toast] = useState(() => new Animated.Value(0));

  const product = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(String(slug)),
    enabled: !!slug,
  });

  const p = product.data;
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
        <Stack.Screen options={{ headerShown: true, title: '' }} />
        <Screenful
          loading={product.isLoading}
          error={product.error ? (product.error as Error).message : null}
          onRetry={() => product.refetch()}
          emptyTitle="Product not found"
          emptyBody="It may have been removed from the catalogue."
        />
      </>
    );
  }

  const soldOut = p.stock === 'out';
  const inCart = cart.items.find((i) => i.productId === p.id)?.quantity ?? 0;
  const fits = fitsCar(p, garage);
  const carName = garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : '';

  const showAdded = () => {
    setAdded(true);
    Animated.sequence([
      Animated.timing(toast, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toast, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setAdded(false));
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

  const photos = p.images.length ? p.images : [''];

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.screen}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
          {/* Full-bleed gallery */}
          <View style={[s.gallery, { height: GALLERY_H + insets.top }]}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhoto(Math.round(e.nativeEvent.contentOffset.x / width))}
            >
              {photos.map((uri, i) => (
                <View key={`${uri}-${i}`} style={{ width, height: GALLERY_H + insets.top, paddingTop: insets.top }}>
                  <Photo uri={uri} style={{ width, height: GALLERY_H, backgroundColor: 'transparent' }} />
                </View>
              ))}
            </ScrollView>
            {photos.length > 1 && (
              <View style={s.dots}>
                {photos.map((_, i) => (
                  <View key={i} style={[s.dot, i === photo && s.dotOn]} />
                ))}
              </View>
            )}
          </View>

          <View style={s.body}>
            {!!p.brand && <Text style={s.brand}>{p.brand}</Text>}
            <Text style={s.title}>{p.name}</Text>

            <View style={s.priceRow}>
              <Text style={s.price}>{inr(p.price)}</Text>
              {p.mrp ? <Text style={s.mrp}>{inr(p.mrp)}</Text> : null}
              {p.discountPercent > 0 ? (
                <View style={s.off}>
                  <Text style={s.offText}>{p.discountPercent}% off</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.taxNote}>Inclusive of all taxes · Delivery calculated at checkout</Text>

            <View style={s.metaRow}>
              {p.rating > 0 && (
                <View style={s.rating}>
                  <Ionicons name="star" size={13} color={colors.star} />
                  <Text style={s.ratingText}>
                    <Text style={s.ratingStrong}>{p.rating.toFixed(1)}</Text>/5
                    {p.reviews > 0 ? ` · ${p.reviews.toLocaleString('en-IN')} ratings` : ''}
                  </Text>
                </View>
              )}
              {p.stock === 'low' && <Badge text="Only a few left" tone="red" />}
              {soldOut && <Badge text="Out of stock" tone="red" />}
              {p.stock === 'in' && <Badge text="In stock" tone="green" />}
            </View>

            {fits && (
              <View style={s.fits}>
                <Ionicons name="checkmark-circle" size={16} color={colors.green} />
                <Text style={s.fitsText} numberOfLines={1}>Fits your {carName}</Text>
              </View>
            )}
          </View>

          {seenIn.length > 0 && (
            <View style={{ marginTop: spacing.lg }}>
              <SectionHeader title="Seen in reels" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.reelRow}>
                {seenIn.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      router.push({ pathname: '/(tabs)/reels', params: { start: r.id } });
                    }}
                    style={({ pressed }) => [s.reelThumb, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Reel by ${r.creator.name}`}
                  >
                    {/* No poster on R2 reels yet: fall back to the product photo. */}
                    {(r.posterUrl || r.product?.image) ? <Image source={{ uri: (r.posterUrl || r.product?.image) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                    <View style={s.reelPlay}>
                      <Ionicons name="play" size={14} color={colors.white} />
                    </View>
                    <Text style={s.reelBy} numberOfLines={1}>{r.creator.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={s.body}>
            {!!p.description && (
              <View style={s.block}>
                <T kind="h3">About this product</T>
                <T kind="body" style={{ marginTop: spacing.sm }}>{p.description.replace(/<[^>]*>/g, '').trim()}</T>
              </View>
            )}

            {p.features.length > 0 && (
              <View style={s.block}>
                <T kind="h3">Key features</T>
                <View style={{ marginTop: spacing.sm, gap: 6 }}>
                  {p.features.map((f, i) => (
                    <View key={i} style={s.bullet}>
                      <Ionicons name="checkmark-circle" size={16} color={colors.green} />
                      <T kind="body" style={{ flex: 1 }}>{f}</T>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={s.assure}>
              {[
                { icon: 'shield-checkmark-outline' as const, text: 'Genuine part' },
                { icon: 'repeat-outline' as const, text: 'Easy returns' },
                { icon: 'headset-outline' as const, text: 'Fitment help' },
              ].map((a) => (
                <View key={a.text} style={s.assureItem}>
                  <Ionicons name={a.icon} size={18} color={colors.green} />
                  <Text style={s.assureText}>{a.text}</Text>
                </View>
              ))}
            </View>
          </View>

          {(related.data?.products ?? []).filter((r) => r.id !== p.id).length > 0 && (
            <View style={{ marginTop: spacing.xl }}>
              <SectionHeader title="More from this brand" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
                {(related.data?.products ?? [])
                  .filter((r) => r.id !== p.id)
                  .map((r) => <ProductCard key={r.id} product={r} />)}
              </ScrollView>
            </View>
          )}
        </ScrollView>

        <FloatingButton icon="chevron-back" onPress={back} label="Go back" top={insets.top + spacing.sm} />
        <Pressable
          onPress={() => router.push('/(tabs)/cart')}
          hitSlop={8}
          style={[s.float, s.floatRight, { top: insets.top + spacing.sm }]}
          accessibilityRole="button"
          accessibilityLabel={`Cart, ${cart.totalItems} items`}
        >
          <Ionicons name="bag-handle-outline" size={21} color={colors.ink} />
          {cart.totalItems > 0 && (
            <View style={s.cartCount}>
              <Text style={s.cartCountText}>{cart.totalItems > 9 ? '9+' : cart.totalItems}</Text>
            </View>
          )}
        </Pressable>

        {/* Confirmation, so the tap is never left in doubt. */}
        {added && (
          <Animated.View
            style={[
              s.toast,
              { bottom: insets.bottom + 92, opacity: toast, transform: [{ translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
            ]}
            pointerEvents="none"
          >
            <Ionicons name="checkmark-circle" size={17} color={colors.white} />
            <Text style={s.toastText}>Added to your cart{inCart > 1 ? ` · ${inCart} in cart` : ''}</Text>
          </Animated.View>
        )}

        {/* Sticky buy bar */}
        <View style={[s.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button
            label={soldOut ? 'Out of stock' : added ? 'Added' : 'Add to cart'}
            icon={added ? 'checkmark' : 'cart-outline'}
            variant="outline"
            onPress={onAdd}
            disabled={soldOut || buying}
            loading={cartBusy && !buying}
            style={{ flex: 1 }}
          />
          <Button
            label="Buy now"
            icon="flash"
            onPress={onBuy}
            disabled={soldOut || cartBusy}
            loading={buying}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  gallery: { backgroundColor: colors.subtle },
  dots: { flexDirection: 'row', gap: 5, alignSelf: 'center', position: 'absolute', bottom: spacing.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.lineStrong },
  dotOn: { backgroundColor: colors.green, width: 18 },

  float: {
    position: 'absolute', width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center', ...shadow.raised,
  },
  floatLeft: { left: spacing.lg },
  floatRight: { right: spacing.lg },
  cartCount: {
    position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9,
    backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center',
  },
  cartCountText: { fontFamily: font.bold, fontSize: 9.5, color: colors.white },

  body: { backgroundColor: colors.bg, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  brand: { fontFamily: font.bold, fontSize: 11.5, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { fontFamily: font.heading, fontSize: 21, lineHeight: 27, letterSpacing: -0.2, color: colors.ink, marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  price: { fontFamily: font.extrabold, fontSize: 26, color: colors.ink },
  mrp: { fontFamily: font.regular, fontSize: 15, color: colors.muted, textDecorationLine: 'line-through' },
  off: { backgroundColor: colors.greenSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  offText: { fontFamily: font.bold, fontSize: 12, color: colors.green },
  taxNote: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, flexWrap: 'wrap' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontFamily: font.regular, fontSize: 13, color: colors.muted },
  ratingStrong: { fontFamily: font.bold, color: colors.ink },
  fits: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.md,
    backgroundColor: colors.greenSoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  fitsText: { fontFamily: font.bold, fontSize: 13, color: colors.green },

  reelRow: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  reelThumb: { width: 96, height: 170, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.ink, justifyContent: 'flex-end' },
  reelPlay: {
    position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  reelBy: {
    fontFamily: font.bold, fontSize: 11, color: colors.white, padding: 6,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4,
  },

  block: { marginTop: spacing.xl },
  bullet: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },

  assure: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl,
    paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line,
  },
  assureItem: { alignItems: 'center', gap: 4, flex: 1 },
  assureText: { fontFamily: font.medium, fontSize: 11.5, color: colors.ink2, textAlign: 'center' },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center',
    gap: spacing.md, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
  },
  toast: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.ink, paddingVertical: spacing.md, borderRadius: radius.pill, ...shadow.raised,
  },
  toastText: { fontFamily: font.semibold, fontSize: 14, color: colors.white },
});
