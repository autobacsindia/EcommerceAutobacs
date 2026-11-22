/**
 * The shoppable card at the bottom of a reel.
 *
 * Every number here is what the server sent in the reel's live product block —
 * the card never computes a price. Tapping the card opens the product page;
 * the two buttons hand off to the normal cart flow (see the feed screen).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { ReelProduct } from '../api/reels';
import { colors, font, inr, radius, spacing } from '../theme';
import { StripeLoader } from '../ui';

const STOCK: Record<ReelProduct['availability'], { label: string; color: string }> = {
  in: { label: 'In stock', color: colors.success },
  low: { label: 'Only a few left', color: colors.red },
  out: { label: 'Out of stock', color: colors.red },
  backorder: { label: 'Ships when restocked', color: colors.steel },
};

export function ReelProductCard({
  product,
  busy,
  onOpen,
  onAdd,
  onBuy,
}: {
  product: ReelProduct;
  busy: 'add' | 'buy' | null;
  onOpen: () => void;
  onAdd: () => void;
  onBuy: () => void;
}) {
  const out = product.availability === 'out';
  const stock = STOCK[product.availability] ?? STOCK.in;
  // The festival offer is display-only; the cart and checkout decide the charge.
  const shown = product.festivalPrice != null && product.festivalPrice < product.price ? product.festivalPrice : product.price;
  const festive = shown !== product.price;
  const was = product.mrp != null && product.mrp > shown ? product.mrp : festive ? product.price : null;
  const pct = was ? Math.round((1 - shown / was) * 100) : 0;
  const choose = product.hasVariants && !out;

  return (
    <View style={s.card}>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [s.top, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={`Open ${product.title}`}
      >
        <Image source={{ uri: product.image ?? undefined }} style={s.photo} contentFit="contain" transition={150} cachePolicy="memory-disk" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={2}>{product.title}</Text>
          <View style={s.priceRow}>
            {product.hasVariants && <Text style={s.from}>From</Text>}
            <Text style={s.price}>{inr(shown)}</Text>
            {was != null && <Text style={s.mrp}>{inr(was)}</Text>}
            {pct > 0 && (
              <View style={s.off}>
                <Text style={s.offText}>{pct}% off</Text>
              </View>
            )}
            {festive && (
              <View style={s.festive}>
                <Text style={s.festiveText}>Festival offer</Text>
              </View>
            )}
          </View>
          <View style={s.metaRow}>
            {product.averageRating > 0 && (
              <>
                <Ionicons name="star" size={11} color={colors.star} />
                <Text style={s.meta}>
                  <Text style={s.metaStrong}>{product.averageRating.toFixed(1)}</Text>/5
                  {product.ratingCount > 0 ? ` · ${product.ratingCount.toLocaleString('en-IN')} ratings` : ''}
                </Text>
                <Text style={s.dot}>·</Text>
              </>
            )}
            <View style={[s.stockDot, { backgroundColor: stock.color }]} />
            <Text style={[s.meta, { color: stock.color }]}>{stock.label}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>

      <View style={s.actions}>
        <Pressable
          onPress={onAdd}
          disabled={out || !!busy}
          style={({ pressed }) => [s.btn, s.btnGhost, (out || pressed) && { opacity: out ? 0.45 : 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel={choose ? 'Choose an option' : 'Add to cart'}
          accessibilityState={{ disabled: out || !!busy }}
        >
          {busy === 'add' ? (
            <StripeLoader size="sm" />
          ) : (
            <>
              <Ionicons name={choose ? 'options-outline' : 'cart-outline'} size={17} color={colors.green} />
              <Text style={[s.btnText, { color: colors.green }]}>{choose ? 'Choose option' : 'Add to cart'}</Text>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={onBuy}
          disabled={out || !!busy}
          style={({ pressed }) => [s.btn, s.btnSolid, (out || pressed) && { opacity: out ? 0.45 : 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={out ? 'Out of stock' : 'Buy now'}
          accessibilityState={{ disabled: out || !!busy }}
        >
          {busy === 'buy' ? (
            <StripeLoader size="sm" onDark />
          ) : (
            <>
              <Ionicons name={out ? 'close-circle-outline' : 'flash'} size={16} color={colors.white} />
              <Text style={s.btnText}>{out ? 'Out of stock' : 'Buy now'}</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Design A: a white card floating over the reel.
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.subtle },
  title: { fontFamily: font.medium, fontSize: 14, lineHeight: 18, color: colors.ink },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  price: { fontFamily: font.bold, fontSize: 17, color: colors.ink },
  from: { fontFamily: font.regular, fontSize: 12, color: colors.muted },
  festive: { backgroundColor: colors.goldSoft, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  festiveText: { fontFamily: font.bold, fontSize: 10.5, color: colors.ink2 },
  mrp: { fontFamily: font.regular, fontSize: 12.5, color: colors.muted, textDecorationLine: 'line-through' },
  off: { backgroundColor: colors.greenSoft, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  offText: { fontFamily: font.bold, fontSize: 11, color: colors.green },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  meta: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },
  metaStrong: { fontFamily: font.bold, color: colors.ink },
  dot: { color: colors.lineStrong, marginHorizontal: 2 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  btnGhost: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.green },
  btnSolid: { backgroundColor: colors.green },
  btnText: { fontFamily: font.bold, fontSize: 14, color: colors.white },
});
