/**
 * Product detail — premium launch look (owner approved 2026-11-22): an
 * immersive full-bleed gallery (dots, tap for pinch-zoom), heart, "Watch in
 * reels" chip, overline brand, price block, rating, trust chips and a sticky
 * Add to cart / Buy now bar.
 *
 * The price shown is the server's price. "Add to cart" sends an id and a
 * quantity and nothing else; "Buy now" is the same add followed by the same
 * route to checkout the cart screen uses. What the customer pays is decided
 * entirely by the backend.
 *
 * Trust chips only state what the data proves: "Fits your car" comes from the
 * product's own compatibility list, and there is NO delivery-date chip because
 * the product API does not return one (never invent a promise).
 */
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../../src/api/client';
import { fetchProduct, fetchProducts, type Product, type Variant } from '../../src/api/catalogue';
import ProductCard from '../../src/components/ProductCard';
import { Photo } from '../../src/components/ui';
import { useReelFeed } from '../../src/reels/useReels';
import { alpha, colors, elevation, font, inr, palette, radius, spacing, type } from '../../src/theme';
import { useApp, type Garage } from '../../src/store';
import {
  Badge,
  EmptyState,
  ErrorState,
  GlassChip,
  IconButton,
  Overline,
  PremiumButton,
  Price,
  PressScale,
  ProductDetailSkeleton,
  Rating,
  SectionHeader,
  Stripes,
  useToast,
} from '../../src/ui';
import { ZoomViewer } from '../../src/product/ZoomViewer';
import { useSaved } from '../../src/product/useSaved';

/** True only when the product's own compatibility list names the saved car. */
function fitsCar(p: Product, garage: Garage | null): boolean {
  if (!garage?.make) return false;
  const make = garage.make.trim().toLowerCase();
  const model = garage.model?.trim().toLowerCase();
  return p.fits.some(
    (f) => f.make.trim().toLowerCase() === make && (!model || !f.model || f.model.trim().toLowerCase() === model),
  );
}

function TrustChip({ icon, label, tone = 'plain', onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; tone?: 'green' | 'plain'; onPress?: () => void }) {
  const body = (
    <>
      <Ionicons name={icon} size={15} color={tone === 'green' ? colors.green : colors.ink2} />
      <Text style={[s.trustText, tone === 'green' && { color: colors.green }]} numberOfLines={1}>
        {label}
      </Text>
      {onPress && <Ionicons name="chevron-forward" size={13} color={colors.green} />}
    </>
  );
  const style = [s.trust, tone === 'green' && s.trustGreen];
  return onPress ? (
    <PressScale onPress={onPress} haptic="selection" style={style} accessibilityLabel={label}>
      {body}
    </PressScale>
  ) : (
    <View style={style}>{body}</View>
  );
}

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const galleryH = Math.round(width * 1.02);
  const toast = useToast();
  const { addItem, cartBusy, cart, customer, garage } = useApp();
  const [photo, setPhoto] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const [buying, setBuying] = useState(false);
  /** Chosen option of a `variable` product. Never pre-picked: the customer chooses. */
  const [variantId, setVariantId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [pickerY, setPickerY] = useState(0);

  const product = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(String(slug)),
    enabled: !!slug,
  });

  const p = product.data;
  const heart = useSaved(p?.id);
  // "More like this" uses the brand, which is the closest signal the list API gives.
  const related = useQuery({
    queryKey: ['related', p?.brand, p?.id],
    queryFn: () => fetchProducts({ brand: p?.brand, limit: 10 }),
    enabled: !!p?.brand,
  });

  // Reels already loaded in the feed that tag this product. Hidden when none.
  const feed = useReelFeed();
  const seenIn = useMemo(() => (p ? feed.reels.filter((r) => r.product?.id === p.id).slice(0, 10) : []), [feed.reels, p]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (product.isLoading || product.error || !p) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.screen}>
          {product.isLoading ? (
            <ProductDetailSkeleton />
          ) : product.error ? (
            <ErrorState error={product.error} onRetry={() => product.refetch()} />
          ) : (
            <EmptyState
              icon="pricetag-outline"
              title="Product not found"
              body="It may have been removed from the catalogue."
              action={{ label: 'Browse the shop', onPress: () => router.replace('/(tabs)/shop') }}
            />
          )}
          <IconButton icon="chevron-back" label="Go back" onPress={back} style={[s.floatLeft, { top: insets.top + spacing.sm }]} />
        </View>
      </>
    );
  }

  // Options: a variable product cannot be added until one is chosen (the cart
  // API rejects it). Price/stock shown are the server's figures for the option.
  const needsOption = p.productType === 'variable' && p.variants.length > 0;
  const variant: Variant | null = needsOption ? p.variants.find((v) => v.id === variantId) ?? null : null;
  const allOptionsOut = needsOption && p.variants.every((v) => v.stock === 'out');
  const stock = variant ? variant.stock : needsOption ? (allOptionsOut ? 'out' : 'in') : p.stock;
  const soldOut = stock === 'out';
  const fits = fitsCar(p, garage);
  const carName = garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : '';
  // A listed compatibility that does NOT include the saved car — say so, never guess "fits".
  const notListed = !!garage && !fits && p.fits.length > 0;
  const optionName = p.variants[0]?.attribute && p.variants[0].attribute.toLowerCase() !== 'option' ? p.variants[0].attribute.toLowerCase() : 'option';

  /** Tapped Add/Buy without an option: take them to the picker instead of an error. */
  const askForOption = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    // pickerY is measured inside the body block, which starts under the gallery.
    scrollRef.current?.scrollTo({ y: Math.max(0, galleryH + insets.top + pickerY - spacing.xl), animated: true });
    toast.show({ message: `Choose a ${optionName} first`, icon: 'options-outline', duration: 2000 });
  };

  const showAdded = () => {
    setAdded(true);
    toast.show({
      message: 'Added to your cart',
      tone: 'success',
      icon: 'checkmark-circle',
      action: { label: 'View cart', onPress: () => router.push('/(tabs)/cart') },
    });
    setTimeout(() => setAdded(false), 2000);
  };

  const fail = (err: unknown) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    Alert.alert('Not added', err instanceof ApiError ? err.message : 'Could not add to cart. Please try again.');
  };

  const onAdd = async () => {
    if (needsOption && !variant) return askForOption();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await addItem(p.id, 1, variant?.id ?? null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showAdded();
    } catch (err) {
      fail(err);
    }
  };

  const onBuy = async () => {
    if (needsOption && !variant) return askForOption();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setBuying(true);
    try {
      await addItem(p.id, 1, variant?.id ?? null);
      router.push(customer ? '/checkout' : '/login?next=/checkout');
    } catch (err) {
      fail(err);
    } finally {
      setBuying(false);
    }
  };

  const onHeart = async () => {
    const now = await heart.toggle();
    toast.show({ message: now ? 'Saved on this phone' : 'Removed from saved', icon: now ? 'heart' : 'heart-outline', duration: 1600 });
  };

  const photos = p.images.length ? p.images : [''];
  const related_ = (related.data?.products ?? []).filter((r) => r.id !== p.id);
  const about = p.description.replace(/<[^>]*>/g, '').trim();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.screen}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: insets.bottom + 110 }} showsVerticalScrollIndicator={false}>
          {/* Immersive gallery — tap any photo for full-screen pinch-zoom. */}
          <View style={[s.gallery, { height: galleryH + insets.top }]}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhoto(Math.round(e.nativeEvent.contentOffset.x / width))}
            >
              {photos.map((uri, i) => (
                <Pressable
                  key={`${uri}-${i}`}
                  onPress={() => uri && setZoomOpen(true)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Photo ${i + 1} of ${photos.length}. Tap to zoom`}
                  style={{ width, height: galleryH + insets.top, paddingTop: insets.top + spacing.xxl }}
                >
                  <Photo uri={uri} style={{ width, height: galleryH - spacing.xxl, backgroundColor: 'transparent' }} />
                </Pressable>
              ))}
            </ScrollView>

            {/* Soft fade into the page so the photo never ends on a hard line. */}
            <LinearGradient colors={[alpha(palette.page, 0), colors.bg]} style={s.galleryFade} pointerEvents="none" />

            <View style={s.galleryFoot} pointerEvents="box-none">
              {seenIn.length > 0 ? (
                <GlassChip
                  icon="play"
                  label="Watch in reels"
                  action={seenIn.length > 1 ? `${seenIn.length}` : undefined}
                  onPress={() => router.push({ pathname: '/(tabs)/reels', params: { start: seenIn[0].id } })}
                />
              ) : (
                <View />
              )}
              {photos.length > 1 && (
                <View style={s.dots} accessibilityLabel={`Photo ${photo + 1} of ${photos.length}`}>
                  {photos.map((_, i) => (
                    <View key={i} style={[s.dot, i === photo && s.dotOn]} />
                  ))}
                </View>
              )}
            </View>
          </View>

          <View style={s.body}>
            <View style={s.brandRow}>
              <Stripes width={10} height={3} gap={2} />
              {!!p.brand && <Overline>{p.brand}</Overline>}
            </View>
            <Text style={s.title} accessibilityRole="header">{p.name}</Text>

            <View style={s.metaRow}>
              <Rating rating={p.rating} count={p.reviews} />
              {stock === 'low' && <Badge text="Only a few left" tone="red" icon="flame-outline" />}
              {soldOut && <Badge text={variant ? 'This option is out of stock' : 'Out of stock'} tone="grey" />}
            </View>

            {needsOption && !variant ? (
              <View style={s.fromRow}>
                <Text style={s.fromText}>From</Text>
                <Price price={p.priceFrom} size="lg" />
              </View>
            ) : (
              <Price
                price={variant ? variant.price : p.price}
                mrp={variant ? variant.mrp : p.mrp}
                offPercent={variant ? variant.discountPercent : p.discountPercent}
                size="lg"
                style={{ marginTop: spacing.lg }}
              />
            )}
            <Text style={s.taxNote}>
              {needsOption && !variant ? `Price depends on the ${optionName} you choose · ` : ''}Inclusive of all taxes · Delivery calculated at checkout
            </Text>
            {!!p.summary && <Text style={[type.body, s.summary]}>{p.summary.replace(/<[^>]*>/g, '').trim()}</Text>}

            {needsOption && (
              <View style={s.picker} onLayout={(e) => setPickerY(e.nativeEvent.layout.y)}>
                <Text style={s.pickerTitle}>
                  Choose {optionName}
                  {variant ? <Text style={s.pickerChosen}>{`  ·  ${variant.label}`}</Text> : null}
                </Text>
                <View style={s.optionWrap}>
                  {p.variants.map((v) => {
                    const on = v.id === variantId;
                    const out = v.stock === 'out';
                    return (
                      <PressScale
                        key={v.id}
                        onPress={() => setVariantId(v.id)}
                        haptic="selection"
                        scaleTo={0.96}
                        style={[s.option, on && s.optionOn, out && s.optionOut]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${v.label}${out ? ', out of stock' : ''}`}
                      >
                        <Text style={[s.optionLabel, on && s.optionLabelOn, out && s.optionLabelOut]} numberOfLines={2}>
                          {v.label}
                        </Text>
                        <Text style={[s.optionPrice, on && { color: colors.green }]}>{out ? 'Out of stock' : inr(v.price)}</Text>
                      </PressScale>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Trust chips — each one is backed by real data. */}
            <View style={s.trustRow}>
              {fits && <TrustChip icon="checkmark-circle" label={`Fits your ${carName}`} tone="green" />}
              {!garage && p.fits.length > 0 && (
                <TrustChip icon="car-sport-outline" label="Check it fits your car" tone="green" onPress={() => router.push('/garage')} />
              )}
              {notListed && (
                <TrustChip icon="help-circle-outline" label={`Not listed for your ${carName}`} onPress={() => router.push('/garage')} />
              )}
              {stock === 'in' && (!needsOption || !!variant) && <TrustChip icon="cube-outline" label="In stock" />}
              {p.returnable && <TrustChip icon="repeat-outline" label="Easy returns" />}
              <TrustChip icon="shield-checkmark-outline" label="Genuine part" />
            </View>
          </View>

          {seenIn.length > 0 && (
            <View style={s.section}>
              <SectionHeader overline="As seen on" title="Autobacs reels" stripes />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.reelRow}>
                {seenIn.map((r) => (
                  <PressScale
                    key={r.id}
                    haptic="selection"
                    onPress={() => router.push({ pathname: '/(tabs)/reels', params: { start: r.id } })}
                    style={s.reelThumb}
                    accessibilityLabel={`Reel by ${r.creator.name}`}
                  >
                    {/* No poster on R2 reels yet: fall back to the product photo. */}
                    {(r.posterUrl || r.product?.image) ? (
                      <Image source={{ uri: (r.posterUrl || r.product?.image) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                    ) : null}
                    <LinearGradient colors={[alpha(palette.ink, 0), colors.scrimStrong]} style={s.reelScrim} pointerEvents="none" />
                    <View style={s.reelPlay}>
                      <Ionicons name="play" size={13} color={colors.white} />
                    </View>
                    <Text style={s.reelBy} numberOfLines={1}>{r.creator.name}</Text>
                  </PressScale>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={s.body}>
            {!!about && (
              <View style={s.block}>
                <Overline>Overview</Overline>
                <Text style={[type.h2, { marginTop: 4 }]}>About this product</Text>
                <Text style={[type.body, s.para]}>{about}</Text>
              </View>
            )}

            {p.features.length > 0 && (
              <View style={s.block}>
                <Overline>Highlights</Overline>
                <Text style={[type.h2, { marginTop: 4 }]}>Key features</Text>
                <View style={s.featureCard}>
                  {p.features.map((f, i) => (
                    <View key={i} style={[s.bullet, i < p.features.length - 1 && s.bulletLine]}>
                      <View style={s.bulletDot}>
                        <Ionicons name="checkmark" size={12} color={colors.green} />
                      </View>
                      <Text style={[type.body, { flex: 1 }]}>{f}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {p.specs.length > 0 && (
              <View style={s.block}>
                <Overline>Details</Overline>
                <Text style={[type.h2, { marginTop: 4 }]}>Specifications</Text>
                <View style={s.featureCard}>
                  {p.specs.map((sp, i) => (
                    <View key={`${sp.key}-${i}`} style={[s.specRow, i < p.specs.length - 1 && s.bulletLine]}>
                      <Text style={s.specKey}>{sp.key}</Text>
                      <Text style={s.specVal}>{sp.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {p.packageContents.length > 0 && (
              <View style={s.block}>
                <Overline>In the box</Overline>
                <Text style={[type.h2, { marginTop: 4 }]}>What you get</Text>
                <View style={s.featureCard}>
                  {p.packageContents.map((c, i) => (
                    <View key={i} style={[s.bullet, i < p.packageContents.length - 1 && s.bulletLine]}>
                      <Ionicons name="cube-outline" size={16} color={colors.green} style={{ marginTop: 2 }} />
                      <Text style={[type.body, { flex: 1 }]}>{c}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={s.assure}>
              {[
                { icon: 'shield-checkmark-outline' as const, title: 'Genuine', text: 'From the brand' },
                // Only promise returns when this product's own policy allows them.
                ...(p.returnable ? [{ icon: 'repeat-outline' as const, title: 'Returns', text: 'Hassle-free' }] : []),
                { icon: 'headset-outline' as const, title: 'Fitment', text: 'Expert help' },
              ].map((a) => (
                <View key={a.title} style={s.assureItem}>
                  <Ionicons name={a.icon} size={20} color={colors.green} />
                  <Text style={s.assureTitle}>{a.title}</Text>
                  <Text style={s.assureText}>{a.text}</Text>
                </View>
              ))}
            </View>
          </View>

          {related_.length > 0 && (
            <View style={s.section}>
              <SectionHeader overline={p.brand || 'More'} title="More from this brand" stripes />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
                {related_.map((r) => <ProductCard key={r.id} product={r} />)}
              </ScrollView>
            </View>
          )}
        </ScrollView>

        {/* Floating chrome over the gallery */}
        <IconButton icon="chevron-back" label="Go back" onPress={back} style={[s.floatLeft, { top: insets.top + spacing.sm }]} />
        <View style={[s.floatRight, { top: insets.top + spacing.sm }]}>
          <IconButton
            icon={heart.saved ? 'heart' : 'heart-outline'}
            color={heart.saved ? colors.red : undefined}
            label={heart.saved ? 'Remove from saved' : 'Save this product'}
            onPress={onHeart}
          />
          <IconButton
            icon="bag-handle-outline"
            label={`Cart, ${cart.totalItems} items`}
            onPress={() => router.push('/(tabs)/cart')}
            badge={cart.totalItems}
          />
        </View>

        {/* Sticky buy bar */}
        <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {soldOut ? (
            <View style={s.soldOut} accessibilityLiveRegion="polite">
              <View style={{ flex: 1 }}>
                <Text style={s.soldOutTitle}>{variant ? 'This option is sold out' : 'Currently out of stock'}</Text>
                <Text style={s.soldOutText}>
                  {needsOption && !allOptionsOut ? `Try another ${optionName} above.` : 'Our specialists can suggest an alternative.'}
                </Text>
              </View>
              <PremiumButton label="Shop similar" variant="outline" size="sm" onPress={() => router.push('/(tabs)/shop')} haptic={false} />
            </View>
          ) : (
            <>
              <PremiumButton
                label={added ? 'Added' : needsOption && !variant ? `Choose ${optionName}` : 'Add to cart'}
                icon={added ? 'checkmark' : needsOption && !variant ? 'options-outline' : 'bag-add-outline'}
                variant="outline"
                onPress={onAdd}
                disabled={buying}
                loading={cartBusy && !buying}
                haptic={false}
                style={{ flex: 1 }}
              />
              <PremiumButton
                label="Buy now"
                icon="flash"
                onPress={onBuy}
                disabled={cartBusy}
                loading={buying}
                haptic={false}
                style={{ flex: 1 }}
              />
            </>
          )}
        </View>

        {zoomOpen && <ZoomViewer photos={photos.filter(Boolean)} index={photo} visible onClose={() => setZoomOpen(false)} />}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  gallery: { backgroundColor: colors.white },
  galleryFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 },
  galleryFoot: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.chrome },
  dotOn: { backgroundColor: colors.ink, width: 18 },

  floatLeft: { position: 'absolute', left: spacing.lg },
  floatRight: { position: 'absolute', right: spacing.lg, flexDirection: 'row', gap: spacing.sm },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...type.h1, marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  taxNote: { ...type.caption, color: colors.muted, marginTop: spacing.xs },
  fromRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: spacing.lg },
  fromText: { fontFamily: font.medium, fontSize: 14, color: colors.muted, marginBottom: 4 },
  summary: { marginTop: spacing.md, color: colors.ink2 },

  picker: { marginTop: spacing.lg },
  pickerTitle: { fontFamily: font.semibold, fontSize: 14, color: colors.ink },
  pickerChosen: { fontFamily: font.regular, color: colors.muted },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  option: {
    minWidth: 96, maxWidth: '100%', minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, justifyContent: 'center',
  },
  optionOn: { borderColor: colors.green, borderWidth: 2, backgroundColor: colors.greenFaint },
  optionOut: { backgroundColor: colors.page },
  optionLabel: { fontFamily: font.medium, fontSize: 13.5, color: colors.ink },
  optionLabelOn: { fontFamily: font.semibold, color: colors.green },
  optionLabelOut: { color: colors.muted, textDecorationLine: 'line-through' },
  optionPrice: { fontFamily: font.semibold, fontSize: 12.5, color: colors.ink2, marginTop: 2 },

  specRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  specKey: { width: '40%', fontFamily: font.medium, fontSize: 13.5, color: colors.muted },
  specVal: { flex: 1, fontFamily: font.medium, fontSize: 13.5, color: colors.ink },

  soldOut: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  soldOutTitle: { fontFamily: font.semibold, fontSize: 14, color: colors.ink },
  soldOutText: { ...type.caption, color: colors.muted },

  trustRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  trust: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 34,
    borderRadius: radius.pill, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line,
  },
  trustGreen: { backgroundColor: colors.greenSoft, borderColor: colors.greenSoft },
  trustText: { fontFamily: font.medium, fontSize: 12.5, color: colors.ink2 },

  section: { marginTop: spacing.xl },
  reelRow: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  reelThumb: { width: 104, height: 184, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.carbon, justifyContent: 'flex-end' },
  reelScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80 },
  reelPlay: {
    position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.glassDark, alignItems: 'center', justifyContent: 'center',
  },
  reelBy: { fontFamily: font.bold, fontSize: 11, color: colors.white, padding: spacing.sm },

  block: { marginTop: spacing.xl },
  para: { marginTop: spacing.sm, color: colors.ink2 },
  featureCard: {
    marginTop: spacing.md, backgroundColor: colors.white, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.lg,
  },
  bullet: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.md },
  bulletLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  bulletDot: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.greenSoft,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },

  assure: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  assureItem: {
    flex: 1, alignItems: 'center', gap: 2, paddingVertical: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.greenFaint,
  },
  assureTitle: { fontFamily: font.semibold, fontSize: 13, color: colors.ink, marginTop: spacing.xs },
  assureText: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center',
    gap: spacing.md, backgroundColor: colors.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, ...elevation.e3,
  },
});
