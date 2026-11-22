/**
 * The frosted shoppable card at the bottom of a reel (Heritage Noir: frosted
 * carbon, 1px gold hairline at 40%, square corners).
 *
 * Every number here is what the server sent in the reel's live product block —
 * the card never computes a price (`Price` only formats). Tapping the card
 * opens the product page; the two buttons hand off to the normal cart flow in
 * the feed screen (attribution first, then the cart API). Products with
 * variants say "Choose option" and open the product page.
 *
 * The gold overline reads "In this reel": the reels API does not send a brand,
 * and we don't make one up.
 */
import { Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { ReelProduct } from '../api/reels';
import { font, noir, palette, radius, spacing } from '../theme';
import { Overline, PremiumButton, Price, PressScale, Rating, SerifTitle } from '../ui';

const STOCK: Record<ReelProduct['availability'], { label: string; color: string }> = {
  in: { label: 'In stock', color: noir.greenText },
  low: { label: 'Only a few left', color: noir.gold },
  out: { label: 'Out of stock', color: noir.sale },
  backorder: { label: 'Ships when restocked', color: noir.textFaint },
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
  const choose = product.hasVariants && !out;

  return (
    <View style={s.card}>
      {Platform.OS === 'ios' ? (
        <>
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: noir.glass, opacity: 0.7 }]} />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: noir.glassStrong }]} />
      )}

      <PressScale onPress={onOpen} haptic="selection" scaleTo={0.98} style={s.top} accessibilityLabel={`Open ${product.title}`}>
        <View style={s.thumb}>
          <Image source={{ uri: product.image ?? undefined }} style={s.photo} contentFit="contain" transition={200} cachePolicy="memory-disk" />
        </View>
        <View style={s.body}>
          <Overline tone="gold" style={s.overline}>In this reel</Overline>
          <SerifTitle size="small" numberOfLines={1}>{product.title}</SerifTitle>
          <View style={s.priceRow}>
            {product.hasVariants && <Text style={s.from}>From</Text>}
            <Price
              price={product.price}
              mrp={product.mrp}
              offPercent={product.discountPercent}
              festivalPrice={product.festivalPrice}
              size="sm"
              onDark
            />
          </View>
          <View style={s.metaRow}>
            <Rating rating={product.averageRating} count={product.ratingCount} onDark />
            {product.averageRating > 0 && <Text style={s.dot}>·</Text>}
            <View style={[s.stockDot, { backgroundColor: stock.color }]} />
            <Text style={s.meta}>{stock.label}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={noir.textFaint} />
      </PressScale>

      <View style={s.actions}>
        <PremiumButton
          label={choose ? 'Choose option' : 'Add to cart'}
          variant="noirOutline"
          size="sm"
          onPress={onAdd}
          disabled={out || (!!busy && busy !== 'add')}
          loading={busy === 'add'}
          haptic={false}
          style={s.btn}
        />
        <PremiumButton
          label={out ? 'Out of stock' : 'Buy now'}
          variant="noir"
          size="sm"
          onPress={onBuy}
          disabled={out || (!!busy && busy !== 'buy')}
          loading={busy === 'buy'}
          haptic={false}
          style={s.btn}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: radius.square,
    padding: spacing.md - 2,
    gap: spacing.sm + 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: noir.goldLine,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md - 2 },
  // Catalogue photos are cut-outs on white, so the square well stays white.
  thumb: { width: 60, height: 60, borderRadius: radius.none, backgroundColor: palette.white, padding: 3 },
  photo: { width: '100%', height: '100%' },
  body: { flex: 1, minWidth: 0, gap: 2 },
  overline: { fontSize: 8.5 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 2 },
  from: { fontFamily: font.regular, fontSize: 11, color: noir.textMuted, marginBottom: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' },
  meta: { fontFamily: font.medium, fontSize: 11, color: noir.textMuted },
  dot: { color: noir.textFaint, marginHorizontal: 2 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1 },
});
