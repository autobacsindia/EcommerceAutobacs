/**
 * The product card used by every list in the app. One component, two shapes,
 * so a price or a discount can never look different in two places.
 *
 * Website tile look (store.css `.st-tile`, 2026-11-22): white card, square
 * photo contained on the grey well, green "#1 Best seller" badge on the
 * photo, a deal line (red "N% off" chip + "Deal"), two-line name, stars with
 * the review count, price with struck M.R.P., and a round green quick-add.
 * The whole card springs on press.
 *
 * Everything shown is a value the server sent. The card never computes a
 * discount or a total of its own.
 */
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { alpha, colors, elevation, font, radius, spacing } from '../theme';
import type { Product } from '../api/catalogue';
import { useApp } from '../store';
import { Photo } from './ui';
import { Badge, PressScale, Price, Rating, StripeLoader, haptic, usePressScale } from '../ui';
import Animated from 'react-native-reanimated';

export const CARD_WIDTH = 172;

function ProductCard({
  product,
  variant = 'tile',
  width = CARD_WIDTH,
  rank,
}: {
  product: Product;
  variant?: 'tile' | 'row';
  /** Tile width. Grids pass `flex: 1` wrappers and leave this alone. */
  width?: number;
  /** 1-based position, shown as a "#1 Best seller" ribbon. */
  rank?: number;
}) {
  const router = useRouter();
  const { addItem } = useApp();
  const [adding, setAdding] = useState(false);
  const press = usePressScale();
  const open = () => router.push(`/product/${product.slug}`);
  const soldOut = product.stock === 'out';
  const onSale = product.discountPercent > 0 && !!product.mrp;

  /*
    Quick add, as on the website's card.

    The listing payload carries no variant field, so the card cannot tell
    whether a product needs an option chosen. Rather than guess — adding the
    wrong variant silently is the one failure a cart must never have — it asks
    the server, and ON ANY REFUSAL opens the product page so the customer
    finishes the choice there. The fast path stays one tap; the ambiguous one
    lands exactly where it can be resolved. The success buzz fires only after
    the server confirmed the add.
  */
  const quickAdd = async () => {
    haptic.light();
    setAdding(true);
    try {
      await addItem(product.id, 1);
      haptic.success();
    } catch {
      open();
    } finally {
      setAdding(false);
    }
  };

  if (variant === 'row') {
    return (
      <PressScale onPress={open} haptic="selection" accessibilityLabel={product.name} style={s.row}>
        <View style={s.rowImageWrap}>
          <Photo uri={product.image} style={s.rowImage} />
        </View>
        <View style={s.rowBody}>
          {!!product.brand && <Text style={s.brand} numberOfLines={1}>{product.brand}</Text>}
          <Text style={s.name} numberOfLines={2}>{product.name}</Text>
          <Rating rating={product.rating} count={product.reviews} compact />
          <Price price={product.price} mrp={onSale ? product.mrp : null} offPercent={product.discountPercent} size="sm" />
          {soldOut && <Text style={s.soldOut}>Out of stock</Text>}
        </View>
      </PressScale>
    );
  }

  /*
    The root is a View, not a Pressable. The quick-add button has to sit beside
    the card's own tap target, not inside it: a button nested in a button is
    invalid on web and ambiguous on native, where the outer press can swallow
    the inner one. So the tap target wraps the image and the text, the add
    button is its sibling, and the whole card scales from the shared press value.
  */
  return (
    <Animated.View style={[s.tile, { width }, press.style]}>
      <Pressable
        onPress={open}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={product.name}
      >
        <View style={s.well}>
          <Photo uri={product.image} style={[s.tileImage, { height: width - 12 }]} />
          {rank ? <Badge text={`#${rank} Best seller`} tone="solidGreen" style={s.badge} /> : null}
          {soldOut && (
            <View style={s.soldOverlay}>
              <Text style={s.soldOverlayText}>Out of stock</Text>
            </View>
          )}
        </View>

        <View style={s.tileBody}>
          {/* Always present (blank when not on sale) so names line up across a rail. */}
          <View style={s.dealLine}>
            {onSale ? (
              <>
                <View style={s.offChip}>
                  <Text style={s.offChipText}>{product.discountPercent}% off</Text>
                </View>
                <Text style={s.dealLabel}>Deal</Text>
              </>
            ) : (
              <Text style={s.brand} numberOfLines={1}>{product.brand || ' '}</Text>
            )}
          </View>
          <Text style={s.name} numberOfLines={2}>{product.name}</Text>
          <Rating rating={product.rating} count={product.reviews} compact />
        </View>
      </Pressable>

      <View style={s.tileFoot}>
        <Price price={product.price} mrp={onSale ? product.mrp : null} hideOff size="sm" style={s.tilePrices} />
        {!soldOut && (
          <PressScale
            onPress={quickAdd}
            disabled={adding}
            hitSlop={8}
            scaleTo={0.9}
            style={s.add}
            accessibilityLabel={`Add ${product.name} to cart`}
          >
            {adding ? <StripeLoader size="sm" onDark /> : <Ionicons name="add" size={20} color={colors.white} />}
          </PressScale>
        )}
      </View>
    </Animated.View>
  );
}

export default memo(ProductCard);

const s = StyleSheet.create({
  tile: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: 'hidden',
    ...elevation.e1,
  },
  // The website's `.st-tile-media`: grey well, photo contained.
  well: { backgroundColor: colors.well, margin: 6, marginBottom: 0, borderRadius: radius.md, overflow: 'hidden' },
  tileImage: { width: '100%' },
  tileBody: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: 4 },
  tileFoot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  tilePrices: { flex: 1 },

  badge: { position: 'absolute', top: spacing.sm, left: spacing.sm },

  dealLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  offChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.red },
  offChipText: { fontFamily: font.bold, fontSize: 11, color: colors.white },
  dealLabel: { fontFamily: font.bold, fontSize: 11.5, color: colors.red },

  soldOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.white, 0.72),
  },
  soldOverlayText: { fontFamily: font.bold, fontSize: 12, color: colors.red },

  add: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...elevation.e1,
  },
  rowImageWrap: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.well },
  rowImage: { width: 92, height: 92 },
  rowBody: { flex: 1, gap: 4, justifyContent: 'center' },

  brand: { fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.steel },
  name: { fontFamily: font.medium, fontSize: 13.5, lineHeight: 18.5, color: colors.ink, minHeight: 37 },
  soldOut: { fontFamily: font.bold, fontSize: 11.5, color: colors.red },
});
