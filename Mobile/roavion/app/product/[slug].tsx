/**
 * Product detail — photos, price, fitment and the add-to-cart bar.
 *
 * The price shown is the server's price. "Add to cart" sends an id and a
 * quantity and nothing else, so what the customer eventually pays is decided
 * entirely by the backend.
 */
import { useRef, useState } from 'react';
import { Animated, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchProduct, fetchProducts } from '../../src/api/catalogue';
import ProductCard from '../../src/components/ProductCard';
import { Badge, Button, Photo, Screenful, SectionHeader, Stars, T } from '../../src/components/ui';
import { colors, font, inr, radius, shadow, spacing } from '../../src/theme';
import { useApp } from '../../src/store';

const { width } = Dimensions.get('window');

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addItem, cartBusy, cart } = useApp();
  const [photo, setPhoto] = useState(0);
  const [added, setAdded] = useState(false);
  const toast = useRef(new Animated.Value(0)).current;

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

  if (product.isLoading || product.error || !p) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
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

  const onAdd = async () => {
    await addItem(p.id, 1);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setAdded(true);
    Animated.sequence([
      Animated.timing(toast, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toast, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setAdded(false));
  };

  return (
    <>
      <Stack.Screen options={{ title: p.brand || 'Product' }} />
      <View style={s.screen}>
        <ScrollView contentContainerStyle={{ paddingBottom: 190 }} showsVerticalScrollIndicator={false}>
          {/* Gallery */}
          <View style={s.gallery}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhoto(Math.round(e.nativeEvent.contentOffset.x / width))}
            >
              {(p.images.length ? p.images : ['']).map((uri, i) => (
                <Photo key={`${uri}-${i}`} uri={uri} style={{ width, height: 300 }} />
              ))}
            </ScrollView>
            {p.images.length > 1 && (
              <View style={s.dots}>
                {p.images.map((_, i) => (
                  <View key={i} style={[s.dot, i === photo && s.dotOn]} />
                ))}
              </View>
            )}
            {p.discountPercent > 0 && (
              <View style={s.discount}>
                <Text style={s.discountText}>{p.discountPercent}% OFF</Text>
              </View>
            )}
          </View>

          <View style={s.body}>
            {!!p.brand && <Text style={s.brand}>{p.brand}</Text>}
            <T kind="h2" style={{ marginTop: 2 }}>{p.name}</T>

            <View style={s.metaRow}>
              <Stars rating={p.rating} reviews={p.reviews} />
              {p.stock === 'low' && <Badge text="Only a few left" tone="red" />}
              {soldOut && <Badge text="Out of stock" tone="red" />}
              {p.stock === 'in' && <Badge text="In stock" tone="green" />}
            </View>

            <View style={s.priceRow}>
              <Text style={s.price}>{inr(p.price)}</Text>
              {p.mrp ? <Text style={s.mrp}>{inr(p.mrp)}</Text> : null}
              {p.discountPercent > 0 ? <Text style={s.save}>Save {inr((p.mrp ?? 0) - p.price)}</Text> : null}
            </View>
            <T kind="small">Inclusive of all taxes · Delivery calculated at checkout</T>

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
            <Text style={s.toastText}>Added to your cart</Text>
          </Animated.View>
        )}

        {/* Buy bar */}
        <View style={[s.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.barPrice}>{inr(p.price)}</Text>
            {inCart > 0 && <Text style={s.barNote}>{inCart} already in cart</Text>}
          </View>
          <Button
            label={soldOut ? 'Out of stock' : added ? 'Added to cart' : 'Add to cart'}
            icon={added ? 'checkmark' : 'cart-outline'}
            onPress={onAdd}
            disabled={soldOut}
            loading={cartBusy}
            style={{ flex: 1.3 }}
          />
          {inCart > 0 && (
            <Pressable onPress={() => router.push('/(tabs)/cart')} style={s.goCart} accessibilityRole="button" accessibilityLabel="Go to cart">
              <Ionicons name="arrow-forward" size={20} color={colors.white} />
            </Pressable>
          )}
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  gallery: { backgroundColor: colors.white },
  dots: { flexDirection: 'row', gap: 5, alignSelf: 'center', position: 'absolute', bottom: spacing.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.green, width: 18 },
  discount: {
    position: 'absolute', top: spacing.md, left: spacing.lg, backgroundColor: colors.red,
    paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.sm,
  },
  discountText: { fontFamily: font.bold, fontSize: 12, color: colors.white },

  body: { backgroundColor: colors.card, padding: spacing.lg, marginTop: spacing.sm },
  brand: { fontFamily: font.semibold, fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  price: { fontFamily: font.extrabold, fontSize: 26, color: colors.ink },
  mrp: { fontFamily: font.regular, fontSize: 15, color: colors.muted, textDecorationLine: 'line-through' },
  save: { fontFamily: font.semibold, fontSize: 13, color: colors.green },

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
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, ...shadow.raised,
  },
  barPrice: { fontFamily: font.bold, fontSize: 19, color: colors.ink },
  barNote: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },
  toast: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.header, paddingVertical: spacing.md, borderRadius: radius.pill, ...shadow.raised,
  },
  toastText: { fontFamily: font.semibold, fontSize: 14, color: colors.white },
  goCart: {
    width: 50, height: 50, borderRadius: radius.pill, backgroundColor: colors.header,
    alignItems: 'center', justifyContent: 'center',
  },
});
