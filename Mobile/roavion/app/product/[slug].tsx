/**
 * Product detail — the same content the website's product page carries, in the
 * order it carries it.
 *
 * The app used to show a gallery, a price, a description and a buy bar, which
 * is roughly a third of the page a customer sees on the web: no specification
 * table, no reviews, no quantity, no similar products, no complementary items,
 * no fitment help. On a parts catalogue those are not decoration — the spec
 * table is how someone checks a winch will pull their vehicle, and "similar
 * products" is how they find the wire-rope version of the one they are looking
 * at. Leaving them out made the app look like a demo of the shop.
 *
 * Section order, matching the web page:
 *   gallery → title/price/summary → quantity → buy bar → trust row →
 *   specifications → description → features → what's in the box →
 *   reviews → similar products → frequently bought together → fitment help
 *
 * Money rule, unchanged: the price shown is the server's price, and add-to-cart
 * sends an id and a quantity and nothing else. What the customer pays is
 * decided entirely by the backend.
 */
import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchComplementary,
  fetchProduct,
  fetchProducts,
  fetchReviewSummary,
  fetchReviews,
  type Product,
  type Variant,
} from '../../src/api/catalogue';
import ProductCard from '../../src/components/ProductCard';
import { Badge, Button, Panel, Photo, Screenful, Stars, T } from '../../src/components/ui';
import { colors, font, inr, radius, shadow, spacing } from '../../src/theme';
import { useApp } from '../../src/store';

const { width: SCREEN } = Dimensions.get('window');
const GALLERY_H = Math.round(SCREEN * 0.82);

/** Admin stores description as HTML; a phone wants paragraphs. */
function toParagraphs(html: string): string[] {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A labelled bullet list — "Key features", "What's in the box". */
function BulletList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Panel title={title}>
      <View style={{ gap: spacing.sm }}>
        {items.map((it, i) => (
          <View key={`${it}-${i}`} style={s.bullet}>
            <Ionicons name="checkmark-circle" size={16} color={colors.green} style={{ marginTop: 2 }} />
            <Text style={s.bulletText}>{it}</Text>
          </View>
        ))}
      </View>
    </Panel>
  );
}

/** A horizontal rail of product cards inside a panel. */
function Rail({ title, subtitle, products }: { title: string; subtitle?: string; products: Product[] }) {
  if (!products.length) return null;
  return (
    <Panel title={title} subtitle={subtitle} flush>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 10 }}
      >
        {products.map((r) => <ProductCard key={r.id} product={r} />)}
      </ScrollView>
    </Panel>
  );
}

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addItem, cartBusy, cart } = useApp();

  const [photo, setPhoto] = useState(0);
  const [qty, setQty] = useState(1);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [added, setAdded] = useState(false);
  const toast = useRef(new Animated.Value(0)).current;

  const product = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(String(slug)),
    enabled: !!slug,
  });

  const p = product.data;

  const [similar, bought, summary, reviews] = useQueries({
    queries: [
      {
        // Same category first — on a parts catalogue that is what "similar"
        // means. Brand is the fallback when the payload carries no category.
        queryKey: ['pdp', 'similar', p?.category?.slug ?? p?.brand, p?.id],
        queryFn: () =>
          fetchProducts(
            p?.category?.slug ? { category: p.category.slug, limit: 12 } : { brand: p?.brand, limit: 12 },
          ),
        enabled: !!(p?.category?.slug || p?.brand),
      },
      {
        queryKey: ['pdp', 'bought', slug],
        queryFn: () => fetchComplementary(String(slug)),
        enabled: !!slug,
      },
      {
        queryKey: ['pdp', 'summary', p?.id],
        queryFn: () => fetchReviewSummary(p!.id),
        enabled: !!p?.id,
      },
      {
        queryKey: ['pdp', 'reviews', p?.id],
        queryFn: () => fetchReviews(p!.id, 5),
        enabled: !!p?.id,
      },
    ],
  });

  const paragraphs = useMemo(() => (p ? toParagraphs(p.description) : []), [p]);

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

  /*
    For a `variable` product every option has its own price and stock, and the
    API refuses an add without a variantId ("Please select a variant before
    adding to cart"). So the screen resolves ONE target — a chosen variant, or
    the product itself — and price, stock and both buy buttons read from it.

    The first in-stock option is selected on arrival, the way Amazon and
    Flipkart do: an unselected picker means the buy button is dead on landing,
    and people tap it before they read. The choice is never hidden though — the
    chips sit above the price and the selected label is repeated in the buy bar
    and in the added-to-cart toast, so nobody buys the wrong one quietly.
  */
  const variants = p.variants;
  const isVariable = p.productType === 'variable' && variants.length > 0;
  const selected: Variant | null = isVariable
    ? (variants.find((v) => v.id === variantId) ??
       variants.find((v) => v.stock !== 'out') ??
       variants[0])
    : null;

  // Price, MRP, discount and stock all come from the target, not the parent.
  const price = selected?.price ?? p.price;
  const mrp = selected ? selected.mrp : p.mrp;
  const discountPercent = selected ? selected.discountPercent : p.discountPercent;
  const stock = selected?.stock ?? p.stock;

  const soldOut = stock === 'out';
  const inCart = cart.items.find(
    (i) => i.productId === p.id && (i.variantId ?? null) === (selected?.id ?? null),
  )?.quantity ?? 0;
  const dist = summary.data?.distribution;
  const totalRated = summary.data?.total ?? 0;
  const similarList = (similar.data?.products ?? []).filter((r) => r.id !== p.id).slice(0, 10);

  const onAdd = async () => {
    await addItem(p.id, qty, selected?.id ?? null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setAdded(true);
    Animated.sequence([
      Animated.timing(toast, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(toast, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setAdded(false));
  };

  const onBuyNow = async () => {
    await addItem(p.id, qty, selected?.id ?? null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push('/checkout');
  };

  return (
    <>
      <Stack.Screen options={{ title: p.brand || 'Product' }} />
      <View style={s.screen}>
        <ScrollView contentContainerStyle={{ paddingBottom: 200 }} showsVerticalScrollIndicator={false}>
          {/* Gallery */}
          <View style={s.gallery}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhoto(Math.round(e.nativeEvent.contentOffset.x / SCREEN))}
            >
              {(p.images.length ? p.images : ['']).map((uri, i) => (
                <Photo key={`${uri}-${i}`} uri={uri} style={{ width: SCREEN, height: GALLERY_H }} />
              ))}
            </ScrollView>

            {discountPercent > 0 && (
              <View style={s.discount}>
                <Text style={s.discountText}>{discountPercent}% OFF</Text>
              </View>
            )}
            {p.images.length > 1 && (
              <>
                <View style={s.counter}>
                  <Text style={s.counterText}>{photo + 1} / {p.images.length}</Text>
                </View>
                <View style={s.dots}>
                  {p.images.map((uri, i) => (
                    <View key={`${uri}-dot-${i}`} style={[s.dot, i === photo && s.dotOn]} />
                  ))}
                </View>
              </>
            )}
          </View>

          {/* Identity, price, summary */}
          <View style={s.head}>
            <View style={s.crumbRow}>
              {!!p.brand && <Text style={s.brand} numberOfLines={1}>{p.brand}</Text>}
              {!!p.category && (
                <Pressable onPress={() => router.push(`/category/${p.category!.slug}`)} hitSlop={6}>
                  <Text style={s.crumb}>in {p.category.name}</Text>
                </Pressable>
              )}
            </View>

            <T kind="h2" style={{ marginTop: 4 }}>{p.name}</T>

            <View style={s.metaRow}>
              {totalRated > 0 ? (
                <Stars rating={summary.data!.average} reviews={totalRated} />
              ) : (
                <Text style={s.noRating}>No reviews yet</Text>
              )}
              {stock === 'in' && <Badge text="In stock" tone="green" />}
              {stock === 'low' && <Badge text="Only a few left" tone="red" />}
              {soldOut && <Badge text="Out of stock" tone="red" />}
            </View>

            <View style={s.priceRow}>
              <Text style={s.price}>{inr(price)}</Text>
              {mrp ? <Text style={s.mrp}>{inr(mrp)}</Text> : null}
              {discountPercent > 0 && mrp ? (
                <Text style={s.save}>Save {inr(mrp - price)}</Text>
              ) : null}
            </View>
            <Text style={s.taxNote}>Inclusive of all taxes · Shipping calculated at checkout</Text>

            {!!p.summary && <Text style={s.summary}>{p.summary}</Text>}

            {/* Variant picker. Out-of-stock options stay visible but
                unselectable, so a customer can see the option exists and is
                simply gone, rather than wondering if it was ever offered. */}
            {isVariable && (
              <View style={s.variantBlock}>
                <Text style={s.variantLabel}>
                  {variants[0].attribute}
                  {selected ? <Text style={s.variantChosen}>: {selected.label}</Text> : null}
                </Text>
                <View style={s.variantRow}>
                  {variants.map((v) => {
                    const on = v.id === selected?.id;
                    const gone = v.stock === 'out';
                    return (
                      <Pressable
                        key={v.id}
                        onPress={() => { setVariantId(v.id); setQty(1); }}
                        disabled={gone}
                        android_ripple={{ color: 'rgba(10,92,51,0.1)' }}
                        style={[s.variantChip, on && s.variantChipOn, gone && s.variantChipGone]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on, disabled: gone }}
                        accessibilityLabel={`${v.label}${gone ? ', out of stock' : `, ${inr(v.price)}`}`}
                      >
                        <Text style={[s.variantChipText, on && s.variantChipTextOn, gone && s.variantChipTextGone]}>
                          {v.label}
                        </Text>
                        {/* A price per chip only when the options differ —
                            repeating one price on every chip is noise. */}
                        {p.priceFrom !== p.priceTo && !gone && (
                          <Text style={[s.variantChipPrice, on && s.variantChipTextOn]}>{inr(v.price)}</Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Quantity — the website has this above the buy buttons. */}
            {!soldOut && (
              <View style={s.qtyRow}>
                <Text style={s.qtyLabel}>Quantity</Text>
                <View style={s.stepper}>
                  <Pressable
                    onPress={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                    style={s.stepBtn}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease quantity"
                  >
                    <Ionicons name="remove" size={18} color={qty <= 1 ? colors.line : colors.ink} />
                  </Pressable>
                  <Text style={s.qtyValue}>{qty}</Text>
                  <Pressable
                    onPress={() => setQty((q) => Math.min(10, q + 1))}
                    disabled={qty >= 10}
                    style={s.stepBtn}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Increase quantity"
                  >
                    <Ionicons name="add" size={18} color={qty >= 10 ? colors.line : colors.ink} />
                  </Pressable>
                </View>
              </View>
            )}

            {/* Trust row — the website's three promises. */}
            <View style={s.assure}>
              {[
                { icon: 'shield-checkmark-outline' as const, text: 'Genuine\nproducts' },
                { icon: 'lock-closed-outline' as const, text: 'Secure\ncheckout' },
                {
                  icon: p.returnable ? ('repeat-outline' as const) : ('information-circle-outline' as const),
                  text: p.returnable ? 'Easy\nreturns' : 'Non-\nreturnable',
                },
              ].map((a) => (
                <View key={a.text} style={s.assureItem}>
                  <Ionicons name={a.icon} size={19} color={colors.green} />
                  <Text style={s.assureText}>{a.text}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Technical specifications — the table the web page calls DETAILS. */}
          {p.specs.length > 0 && (
            <Panel title="Technical specifications">
              <View style={s.specTable}>
                {p.specs.map((row, i) => (
                  <View key={`${row.key}-${i}`} style={[s.specRow, i === p.specs.length - 1 && s.specRowLast]}>
                    <Text style={s.specKey}>{row.key}</Text>
                    <Text style={s.specValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            </Panel>
          )}

          {/* Description */}
          {paragraphs.length > 0 && (
            <Panel title="Product description">
              <View style={{ gap: spacing.sm }}>
                {(expanded ? paragraphs : paragraphs.slice(0, 2)).map((para, i) => (
                  <Text key={i} style={s.para}>{para}</Text>
                ))}
              </View>
              {paragraphs.length > 2 && (
                <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8} style={s.moreBtn}>
                  <Text style={s.moreText}>{expanded ? 'Show less' : 'Read more'}</Text>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={colors.green} />
                </Pressable>
              )}
            </Panel>
          )}

          <BulletList title="Key features" items={p.features} />
          <BulletList title="Why choose this" items={p.whyChoose} />
          <BulletList title="What's in the box" items={p.packageContents} />

          {/* Reviews, with the website's distribution bars. */}
          <Panel title="Customer reviews" subtitle={totalRated > 0 ? 'From verified buyers' : undefined}>
            <View style={s.ratingBox}>
              <View style={s.ratingLeft}>
                <Text style={s.ratingBig}>{(summary.data?.average ?? 0).toFixed(1)}</Text>
                <Text style={s.ratingOutOf}>out of 5</Text>
                <View style={s.ratingStars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Ionicons
                      key={n}
                      name={n <= Math.round(summary.data?.average ?? 0) ? 'star' : 'star-outline'}
                      size={13}
                      color={colors.star}
                    />
                  ))}
                </View>
                <Text style={s.ratingCount}>{totalRated} review{totalRated === 1 ? '' : 's'}</Text>
              </View>

              <View style={s.ratingBars}>
                {([5, 4, 3, 2, 1] as const).map((star) => {
                  const n = dist?.[star] ?? 0;
                  const pct = totalRated > 0 ? (n / totalRated) * 100 : 0;
                  return (
                    <View key={star} style={s.barRow}>
                      <Text style={s.barLabel}>{star}</Text>
                      <Ionicons name="star" size={10} color={colors.star} />
                      <View style={s.barTrack}>
                        <View style={[s.barFill, { width: `${pct}%` }]} />
                      </View>
                      <Text style={s.barCount}>{n}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {(reviews.data ?? []).length > 0 ? (
              <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
                {(reviews.data ?? []).map((r) => (
                  <View key={r.id} style={s.review}>
                    <View style={s.reviewTop}>
                      <View style={s.avatar}>
                        <Text style={s.avatarText}>{r.name.trim().charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.reviewName} numberOfLines={1}>{r.name}</Text>
                        <View style={s.reviewStars}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Ionicons key={n} name={n <= r.rating ? 'star' : 'star-outline'} size={11} color={colors.star} />
                          ))}
                          {r.verified && <Text style={s.verified}>Verified purchase</Text>}
                        </View>
                      </View>
                    </View>
                    {!!r.title && <Text style={s.reviewTitle}>{r.title}</Text>}
                    <Text style={s.reviewText}>{r.comment}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={s.noReviews}>No reviews yet — be the first to review this product.</Text>
            )}
          </Panel>

          <Rail title="Similar products" products={similarList} />
          <Rail
            title="Frequently bought together"
            subtitle="Complete your build with these"
            products={bought.data ?? []}
          />

          {/* Fitment help — the website's "Not sure it fits?" block. */}
          <Pressable
            onPress={() => router.push('/(tabs)/garage')}
            android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
            style={s.help}
            accessibilityRole="button"
          >
            <Ionicons name="headset" size={22} color={colors.white} />
            <View style={{ flex: 1 }}>
              <Text style={s.helpTitle}>Not sure it fits?</Text>
              <Text style={s.helpBody}>Tell us your vehicle and our team will confirm fitment before you buy.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </ScrollView>

        {added && (
          <Animated.View
            style={[
              s.toast,
              {
                bottom: insets.bottom + 104,
                opacity: toast,
                transform: [{ translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
              },
            ]}
            pointerEvents="none"
          >
            <Ionicons name="checkmark-circle" size={17} color={colors.white} />
            <Text style={s.toastText} numberOfLines={1}>
              Added{selected ? ` · ${selected.label}` : ''} to your cart
            </Text>
          </Animated.View>
        )}

        {/* Buy bar — Add to cart and Buy now, as on the website. */}
        <View style={[s.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={s.barPriceCol}>
            <Text style={s.barPrice}>{inr(price * qty)}</Text>
            {!!selected && <Text style={s.barVariant} numberOfLines={1}>{selected.label}</Text>}
            {inCart > 0 && <Text style={s.barNote}>{inCart} in cart</Text>}
          </View>
          <Button
            label={soldOut ? 'Out of stock' : 'Add to cart'}
            icon="cart-outline"
            variant="outline"
            onPress={onAdd}
            disabled={soldOut}
            loading={cartBusy}
            style={s.barBtn}
          />
          <Button
            label="Buy now"
            onPress={onBuyNow}
            disabled={soldOut}
            loading={cartBusy}
            style={s.barBtn}
          />
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
  counter: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.lg,
    backgroundColor: 'rgba(15,17,17,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  counterText: { fontFamily: font.medium, fontSize: 11.5, color: colors.white },
  discount: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    backgroundColor: colors.red,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  discountText: { fontFamily: font.bold, fontSize: 11.5, color: colors.white },

  head: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  crumbRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  brand: { fontFamily: font.bold, fontSize: 11.5, color: colors.green, textTransform: 'uppercase', letterSpacing: 0.6 },
  crumb: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  noRating: { fontFamily: font.regular, fontSize: 12, color: colors.muted },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  price: { fontFamily: font.bold, fontSize: 24, color: colors.ink },
  mrp: { fontFamily: font.regular, fontSize: 14, color: colors.muted, textDecorationLine: 'line-through' },
  save: { fontFamily: font.bold, fontSize: 12.5, color: colors.green },
  taxNote: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted, marginTop: 3 },
  summary: { fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: colors.ink2, marginTop: spacing.md },

  variantBlock: { marginTop: spacing.lg },
  variantLabel: { fontFamily: font.medium, fontSize: 12.5, color: colors.muted },
  variantChosen: { fontFamily: font.bold, color: colors.ink },
  variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  variantChip: {
    minWidth: 76,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  variantChipOn: { borderColor: colors.green, backgroundColor: colors.greenFaint },
  variantChipGone: { backgroundColor: colors.bg, borderStyle: 'dashed' },
  variantChipText: { fontFamily: font.medium, fontSize: 12.5, color: colors.ink },
  variantChipTextOn: { fontFamily: font.bold, color: colors.green },
  variantChipTextGone: { color: colors.muted, textDecorationLine: 'line-through' },
  variantChipPrice: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted, marginTop: 1 },

  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  qtyLabel: { fontFamily: font.medium, fontSize: 13, color: colors.ink },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  stepBtn: { width: 42, height: 38, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { fontFamily: font.bold, fontSize: 14, color: colors.ink, minWidth: 28, textAlign: 'center' },

  assure: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  assureItem: { flex: 1, alignItems: 'center', gap: 5 },
  assureText: { fontFamily: font.medium, fontSize: 11.5, lineHeight: 15, color: colors.ink2, textAlign: 'center' },

  specTable: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden' },
  specRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  specRowLast: { borderBottomWidth: 0 },
  specKey: { flex: 1, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  specValue: { flex: 1.3, fontFamily: font.medium, fontSize: 12.5, lineHeight: 18, color: colors.ink, textAlign: 'right' },

  para: { fontFamily: font.regular, fontSize: 14, lineHeight: 22, color: colors.ink2 },
  moreBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md },
  moreText: { fontFamily: font.bold, fontSize: 13, color: colors.green },

  bullet: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bulletText: { flex: 1, fontFamily: font.regular, fontSize: 13, lineHeight: 20, color: colors.ink2 },

  ratingBox: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  ratingLeft: { alignItems: 'center', minWidth: 92 },
  ratingBig: { fontFamily: font.bold, fontSize: 30, lineHeight: 38, color: colors.ink },
  ratingOutOf: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },
  ratingStars: { flexDirection: 'row', gap: 2, marginTop: 4 },
  ratingCount: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted, marginTop: 4 },
  ratingBars: { flex: 1, gap: 5 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  barLabel: { fontFamily: font.regular, fontSize: 11, color: colors.muted, width: 8 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.star },
  barCount: { fontFamily: font.regular, fontSize: 11, color: colors.muted, minWidth: 16, textAlign: 'right' },

  review: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md, gap: 5 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.bold, fontSize: 13, color: colors.green },
  reviewName: { fontFamily: font.bold, fontSize: 13, color: colors.ink },
  reviewStars: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 },
  verified: { fontFamily: font.medium, fontSize: 10.5, color: colors.green, marginLeft: 5 },
  reviewTitle: { fontFamily: font.bold, fontSize: 13, color: colors.ink },
  reviewText: { fontFamily: font.regular, fontSize: 13, lineHeight: 20, color: colors.ink2 },
  noReviews: { fontFamily: font.regular, fontSize: 13, color: colors.muted, marginTop: spacing.lg },

  help: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.header,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  helpTitle: { fontFamily: font.bold, fontSize: 14, color: colors.white },
  helpBody: { fontFamily: font.regular, fontSize: 11.5, lineHeight: 17, color: 'rgba(255,255,255,0.7)', marginTop: 1 },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    ...shadow.raised,
  },
  barBtn: { flex: 1, paddingHorizontal: spacing.sm },
  barPriceCol: { width: 88 },
  barPrice: { fontFamily: font.bold, fontSize: 16, color: colors.ink },
  barVariant: { fontFamily: font.regular, fontSize: 11, color: colors.green },
  barNote: { fontFamily: font.regular, fontSize: 11, color: colors.muted },

  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.header,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    ...shadow.raised,
  },
  toastText: { fontFamily: font.bold, fontSize: 13, color: colors.white },
});
