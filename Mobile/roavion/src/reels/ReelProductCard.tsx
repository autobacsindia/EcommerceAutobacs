/**
 * The compact white product strip under a reel's caption (Instagram's
 * "View products" tag, made shoppable).
 *
 * Every number here is what the server sent in the reel's live product block —
 * the card never computes a price (`Price` only formats). Tapping the card
 * opens the product page; the two buttons hand off to the normal cart flow in
 * the feed screen (attribution first, then the cart API). Products with
 * variants say "Choose option" and open the product page.
 */
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { ReelProduct } from '../api/reels';
import { colors, elevation, font, radius, spacing } from '../theme';
import { PremiumButton, Price, PressScale, Rating } from '../ui';

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
  const choose = product.hasVariants && !out;

  return (
    <View style={s.card}>

      <PressScale onPress={onOpen} haptic="selection" scaleTo={0.98} style={s.top} accessibilityLabel={`Open ${product.title}`}>
        <View style={s.photoWell}>
          <Image source={{ uri: product.image ?? undefined }} style={s.photo} contentFit="contain" transition={200} cachePolicy="memory-disk" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={1}>{product.title}</Text>
          <View style={s.priceRow}>
            {product.hasVariants && <Text style={s.from}>From</Text>}
            <Price
              price={product.price}
              mrp={product.mrp}
              offPercent={product.discountPercent}
              festivalPrice={product.festivalPrice}
              size="sm"
            />
          </View>
          <View style={s.metaRow}>
            <Rating rating={product.averageRating} count={product.ratingCount} compact />
            {product.averageRating > 0 && <Text style={s.dot}>·</Text>}
            <View style={[s.stockDot, { backgroundColor: stock.color }]} />
            <Text style={[s.meta, { color: stock.color }]}>{stock.label}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.steel} />
      </PressScale>

      <View style={s.actions}>
        {/* Sold out: the first button still goes somewhere useful (details,
            similar parts) instead of sitting there greyed out. */}
        <PremiumButton
          label={out ? 'View details' : choose ? 'Choose option' : 'Add to cart'}
          icon={out ? 'eye-outline' : choose ? 'options-outline' : 'bag-add-outline'}
          variant="outline"
          size="sm"
          onPress={out ? onOpen : onAdd}
          disabled={!!busy && busy !== 'add'}
          loading={busy === 'add'}
          haptic={false}
          style={s.btn}
        />
        <PremiumButton
          label={out ? 'Sold out' : 'Buy now'}
          icon={out ? 'close-circle-outline' : 'flash'}
          variant="green"
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
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    gap: spacing.sm + 2,
    backgroundColor: colors.white,
    ...elevation.e2,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photoWell: {
    width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.white, padding: 3,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  photo: { width: '100%', height: '100%' },
  title: { fontFamily: font.semibold, fontSize: 13.5, lineHeight: 18, color: colors.ink },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 4 },
  from: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted, marginBottom: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  meta: { fontFamily: font.medium, fontSize: 11.5 },
  dot: { color: colors.chrome, marginHorizontal: 2 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1 },
});
