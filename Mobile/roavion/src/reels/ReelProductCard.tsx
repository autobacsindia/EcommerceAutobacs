/**
 * The frosted shoppable card at the bottom of a reel.
 *
 * Every number here is what the server sent in the reel's live product block —
 * the card never computes a price (`Price` only formats). Tapping the card
 * opens the product page; the two buttons hand off to the normal cart flow in
 * the feed screen (attribution first, then the cart API). Products with
 * variants say "Choose option" and open the product page.
 */
import { Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { ReelProduct } from '../api/reels';
import { alpha, colors, elevation, font, palette, radius, spacing } from '../theme';
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
      {Platform.OS === 'ios' ? (
        <BlurView intensity={70} tint="systemChromeMaterialLight" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(palette.white, 0.94) }]} />
      )}

      <PressScale onPress={onOpen} haptic="selection" scaleTo={0.98} style={s.top} accessibilityLabel={`Open ${product.title}`}>
        <View style={s.photoWell}>
          <Image source={{ uri: product.image ?? undefined }} style={s.photo} contentFit="contain" transition={200} cachePolicy="memory-disk" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={2}>{product.title}</Text>
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
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(palette.white, 0.6),
    ...elevation.e3,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photoWell: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.white, padding: 4 },
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
