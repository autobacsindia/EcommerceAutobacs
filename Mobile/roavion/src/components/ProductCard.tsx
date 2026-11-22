/**
 * The product card used by every list in the app. One component, two shapes,
 * so a price or a discount can never look different in two places.
 *
 * Heritage Noir (2026-11-22): square carbon-2 card with a hairline, the
 * photo on a white well, red savings badge, gold brand caps, serif two-line
 * name, rating and price on dark, and a square white quick-add. The whole
 * card springs on press.
 *
 * Everything shown is a value the server sent. The card never computes a
 * discount or a total of its own.
 */
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { alpha, colors, noir, noirSurface, radius, spacing, type } from '../theme';
import type { Product } from '../api/catalogue';
import { useApp } from '../store';
import { Photo } from './ui';
import { Badge, Overline, PressScale, Price, Rating, StripeLoader, haptic, usePressScale } from '../ui';
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
          {!!product.brand && <Overline tone="gold">{product.brand}</Overline>}
          <Text style={s.name} numberOfLines={2}>{product.name}</Text>
          <Rating rating={product.rating} count={product.reviews} compact onDark />
          <Price price={product.price} mrp={onSale ? product.mrp : null} offPercent={product.discountPercent} size="sm" onDark />
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
          <Photo uri={product.image} style={[s.tileImage, { height: Math.round(width * 0.92) }]} />
          {onSale && <Badge text={`-${product.discountPercent}%`} tone="solidRed" style={s.badge} />}
          {rank ? <Badge text={`#${rank} Best seller`} tone="ink" style={[s.badge, onSale && s.badgeLow]} /> : null}
          {soldOut && (
            <View style={s.soldOverlay}>
              <Text style={s.soldOverlayText}>Out of stock</Text>
            </View>
          )}
        </View>

        <View style={s.tileBody}>
          {/* Always present (blank when unbranded) so prices line up across a rail. */}
          <Overline tone="gold">{product.brand || '\u00A0'}</Overline>
          <Text style={s.name} numberOfLines={2}>{product.name}</Text>
          <Rating rating={product.rating} count={product.reviews} compact onDark />
        </View>
      </Pressable>

      <View style={s.tileFoot}>
        <Price price={product.price} mrp={onSale ? product.mrp : null} hideOff size="sm" onDark style={s.tilePrices} />
        {!soldOut && (
          <PressScale
            onPress={quickAdd}
            disabled={adding}
            hitSlop={8}
            scaleTo={0.9}
            style={s.add}
            accessibilityLabel={`Add ${product.name} to cart`}
          >
            {adding ? <StripeLoader size="sm" /> : <Ionicons name="add" size={20} color={noir.ctaText} />}
          </PressScale>
        )}
      </View>
    </Animated.View>
  );
}

export default memo(ProductCard);

const s = StyleSheet.create({
  tile: {
    ...noirSurface,
    overflow: 'hidden',
  },
  // Catalogue photos are shot on white, so the photo keeps a white well.
  well: { backgroundColor: colors.white },
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
  badgeLow: { top: spacing.sm + 26 },

  soldOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(noir.page, 0.72),
  },
  soldOverlayText: { ...type.capsNoir, color: noir.text },

  // Square white quick-add — the Heritage Noir primary, small.
  add: {
    width: 34,
    height: 34,
    borderRadius: radius.square,
    backgroundColor: noir.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: {
    ...noirSurface,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  rowImageWrap: { borderRadius: radius.square, overflow: 'hidden', backgroundColor: colors.white },
  rowImage: { width: 92, height: 92 },
  rowBody: { flex: 1, gap: 4, justifyContent: 'center' },

  name: { ...type.serifSmall, minHeight: 36 },
  soldOut: { ...type.capsNoir, color: noir.sale },
});
