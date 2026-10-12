/**
 * The product card used by every list in the app. One component, three shapes,
 * so a price or a discount can never look different in two places.
 *
 * It carries the same signals the website's mobile card does — the red savings
 * pill, the struck-through M.R.P., the brand byline and the best-seller rank.
 * Those are what make a listing look like a shop rather than a gallery, and
 * leaving them off was most of why the app read as emptier than the web view.
 *
 * Everything shown is a value the server sent. The card never computes a
 * discount or a total of its own.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, font, inr, radius, shadow, spacing } from '../theme';
import type { Product } from '../api/catalogue';
import { Photo, Stars } from './ui';

export const CARD_WIDTH = 172;

export default function ProductCard({
  product,
  variant = 'tile',
  width = CARD_WIDTH,
  rank,
}: {
  product: Product;
  variant?: 'tile' | 'row';
  /** Tile width. Grids pass `flex: 1` wrappers and leave this alone. */
  width?: number;
  /** 1-based position, shown as the website's "#1 Best seller" ribbon. */
  rank?: number;
}) {
  const router = useRouter();
  const open = () => router.push(`/product/${product.slug}`);
  const soldOut = product.stock === 'out';
  const onSale = product.discountPercent > 0 && !!product.mrp;

  if (variant === 'row') {
    return (
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={product.name}
        android_ripple={{ color: 'rgba(10,92,51,0.07)' }}
        style={({ pressed }) => [s.row, pressed && s.pressed]}
      >
        <Photo uri={product.image} style={s.rowImage} />
        <View style={s.rowBody}>
          <Text style={s.name} numberOfLines={2}>{product.name}</Text>
          <Stars rating={product.rating} reviews={product.reviews} />
          <View style={s.priceLine}>
            <Text style={s.price}>{inr(product.price)}</Text>
            {onSale ? <Text style={s.mrp}>{inr(product.mrp!)}</Text> : null}
          </View>
          {!!product.brand && <Text style={s.by} numberOfLines={1}>by {product.brand}</Text>}
          {soldOut && <Text style={s.soldOut}>Out of stock</Text>}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={product.name}
      android_ripple={{ color: 'rgba(10,92,51,0.07)' }}
      style={({ pressed }) => [s.tile, { width }, pressed && s.pressed]}
    >
      <View style={s.tileImageWrap}>
        <Photo uri={product.image} style={[s.tileImage, { height: width * 0.86 }]} />
        {rank ? (
          <View style={s.rank}>
            <Text style={s.rankText}>#{rank} Best seller</Text>
          </View>
        ) : null}
        {soldOut && (
          <View style={s.soldOverlay}>
            <Text style={s.soldOverlayText}>Out of stock</Text>
          </View>
        )}
      </View>

      <View style={s.tileBody}>
        {onSale && (
          <View style={s.dealRow}>
            <View style={s.dealPill}>
              <Text style={s.dealPillText}>-{product.discountPercent}%</Text>
            </View>
            <Text style={s.dealWord}>Deal</Text>
          </View>
        )}
        <Text style={s.name} numberOfLines={2}>{product.name}</Text>
        <Stars rating={product.rating} reviews={product.reviews} />
        <View style={s.priceLine}>
          <Text style={s.price}>{inr(product.price)}</Text>
          {onSale ? <Text style={s.mrp}>M.R.P.: {inr(product.mrp!)}</Text> : null}
        </View>
        {!!product.brand && <Text style={s.by} numberOfLines={1}>by {product.brand}</Text>}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.92 },

  tile: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  tileImageWrap: { backgroundColor: colors.white },
  tileImage: { width: '100%' },
  tileBody: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: 3 },

  rank: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.header,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  rankText: { fontFamily: font.bold, fontSize: 10, color: colors.white },

  soldOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  soldOverlayText: { fontFamily: font.bold, fontSize: 12, color: colors.red },

  dealRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1 },
  dealPill: { backgroundColor: colors.red, paddingHorizontal: 6, paddingVertical: 2.5, borderRadius: 4 },
  dealPillText: { fontFamily: font.bold, fontSize: 11, color: colors.white },
  dealWord: { fontFamily: font.semibold, fontSize: 11.5, color: colors.ink2 },

  row: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    overflow: 'hidden',
  },
  rowImage: { width: 92, height: 92, borderRadius: radius.sm },
  rowBody: { flex: 1, gap: 3, justifyContent: 'center' },

  name: { fontFamily: font.medium, fontSize: 13.5, lineHeight: 18, color: colors.ink },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  price: { fontFamily: font.extrabold, fontSize: 17, color: colors.ink },
  mrp: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted, textDecorationLine: 'line-through' },
  by: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },
  soldOut: { fontFamily: font.semibold, fontSize: 11.5, color: colors.red },
});
