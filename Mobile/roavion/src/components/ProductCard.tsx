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
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, inr, radius, shadow, spacing } from '../theme';
import type { Product } from '../api/catalogue';
import { useApp } from '../store';
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
  const { addItem } = useApp();
  const [adding, setAdding] = useState(false);
  const open = () => router.push(`/product/${product.slug}`);
  const soldOut = product.stock === 'out';
  const onSale = product.discountPercent > 0 && !!product.mrp;

  /*
    Quick add, as on the website's card.

    A `variable` product cannot be added from here: its options have different
    prices and stock, and the API refuses an add without a variantId. The
    listing payload does carry `productType`, so the card knows this up front
    and opens the product page instead of firing a request that is certain to
    fail. The server refusal is still handled, as the listing could be stale.

    Adding the wrong variant silently is the one failure a cart must never
    have, so neither path ever guesses an option.
  */
  const needsChoice = product.productType === 'variable';

  const quickAdd = async () => {
    if (needsChoice) {
      open();
      return;
    }
    setAdding(true);
    try {
      await addItem(product.id, 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      open();
    } finally {
      setAdding(false);
    }
  };

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

  /*
    The root is a View, not a Pressable. The quick-add button has to sit beside
    the card's own tap target, not inside it: a button nested in a button is
    invalid on web (React logs it, and the DOM reparents the markup) and
    ambiguous on native, where the outer press can swallow the inner one. So
    the card's tap target wraps only the image and the text, and the add button
    is its sibling.
  */
  return (
    <View style={[s.tile, { width }]}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={product.name}
        android_ripple={{ color: 'rgba(10,92,51,0.07)' }}
        style={({ pressed }) => pressed && s.pressed}
      >
      <View style={s.tileImageWrap}>
        <Photo uri={product.image} style={[s.tileImage, { height: width * 0.98 }]} />
        {/* Discount sits ON the image, top-left, as on the website. */}
        {onSale && (
          <View style={s.badge}>
            <Text style={s.badgeText}>-{product.discountPercent}%</Text>
          </View>
        )}
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
        {/* Both slots are fixed height. A card with a short title or no rating
            would otherwise sit shorter than its neighbour, and a rail of
            ragged cards with prices at different heights is the single most
            visible way a listing looks unfinished. */}
        <Text style={s.name} numberOfLines={2} ellipsizeMode="tail">{product.name}</Text>
        <View style={s.starSlot}>
          <Stars rating={product.rating} reviews={product.reviews} />
        </View>
      </View>
      </Pressable>

      <View style={[s.tileBody, s.tileFootWrap]}>
        <View style={s.tileFoot}>
          <View style={s.tilePrices}>
            {/* "from" rides ON the price line rather than above it. As its own
                line it added ~9px to the only cards that have variants, which
                knocked their price off the baseline every other card in the
                rail shares — and reserving a slot for it instead would cost
                every card a line to serve the few that need one. */}
            <Text style={s.price}>
              {needsChoice && product.priceTo > product.priceFrom && <Text style={s.from}>from </Text>}
              {inr(needsChoice ? product.priceFrom : product.price)}
            </Text>
            {/* The struck-through MRP keeps its space whether or not there is a
                discount — the same trick as `starSlot` above, for the same
                reason. The foot is bottom-aligned, so without this slot a
                discounted card's price floated 15px higher than the full-price
                card beside it and the prices zig-zagged across every rail. */}
            <View style={s.mrpSlot}>
              {onSale ? <Text style={s.mrp}>{inr(product.mrp!)}</Text> : null}
            </View>
          </View>
          {!soldOut && (
            <Pressable
              onPress={quickAdd}
              disabled={adding}
              hitSlop={6}
              style={s.add}
              accessibilityRole="button"
              accessibilityLabel={
                needsChoice ? `Choose options for ${product.name}` : `Add ${product.name} to cart`
              }
            >
              {adding
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Ionicons name={needsChoice ? 'options' : 'bag-handle'} size={18} color={colors.white} />}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.92 },

  tile: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  tileImageWrap: { backgroundColor: colors.white },
  tileImage: { width: '100%' },
  tileBody: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: 3 },
  tileFootWrap: { paddingTop: 0, paddingBottom: spacing.md },

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
  soldOverlayText: { fontFamily: font.bold, fontSize: 11.5, color: colors.red },

  /* Measured off the website: #cc0c39, 11px bold, radius 6, padding 4x8. */
  badge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.red,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: { fontFamily: font.bold, fontSize: 11, color: colors.white },

  tileFoot: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.sm, marginTop: 2 },
  tilePrices: { flex: 1 },
  /* The site's green circle, 40x40, bottom-right of the card. */
  add: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },

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

  /* Two lines, always — 2 x 19.25 line-height. See the note at the call site. */
  name: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: colors.ink, height: 36 },
  starSlot: { height: 16, justifyContent: 'center' },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  price: { fontFamily: font.bold, fontSize: 15.5, color: colors.ink },
  mrpSlot: { height: 15, justifyContent: 'center' },
  mrp: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted, textDecorationLine: 'line-through' },
  by: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },
  from: { fontFamily: font.regular, fontSize: 10.5, color: colors.muted },
  soldOut: { fontFamily: font.semibold, fontSize: 11.5, color: colors.red },
});
