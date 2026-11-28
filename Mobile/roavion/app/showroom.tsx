/**
 * 3D showroom — turn the car around, fit parts on it, then buy the build.
 *
 * The car on the stage is a SAMPLE drawing (see src/garage/showroom); the parts
 * listed under it are real products that fit the car, read from the shop.
 *
 * Money rule: this screen shows each product's own server price and nothing
 * else. It never adds prices up — the build's total exists only in the cart.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchProducts, type Product } from '../src/api/catalogue';
import { Photo } from '../src/components/ui';
import { displacedBy, fittedSlotKeys, paintHex, partCount, planCart, type BuildPart } from '../src/garage/build';
import Showroom3D from '../src/garage/showroom/Showroom3D';
import { STAGE_BG } from '../src/garage/showroom/showroomHtml';
import { DEFAULT_SHOWROOM_CAR, findSlot, showroomCarBySlug, SLOT_GROUPS, slotsInGroup, type Slot, type SlotGroup } from '../src/garage/slots';
import { useBuild } from '../src/garage/useBuild';
import { useApp } from '../src/store';
import { colors, elevation, font, radius, spacing, type } from '../src/theme';
import {
  Badge, EmptyState, ErrorState, IconButton, Overline, PremiumButton, PressScale, Price, Sheet, Shimmer, StripeLoader, Stripes, useReduceMotion, useToast,
} from '../src/ui';

type IconName = keyof typeof Ionicons.glyphMap;

const PAGE = 20;
const CARD_W = 148;

const toPart = (p: Product): BuildPart => ({
  productId: p.id,
  slug: p.slug,
  // Kept short: the build is stored on the phone, where space is tight.
  name: p.name.slice(0, 70),
  image: p.image,
  needsOption: p.productType === 'variable',
});

export default function ShowroomScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const reduce = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ car?: string }>();
  const car = showroomCarBySlug(params.car) ?? DEFAULT_SHOWROOM_CAR;

  const { cart, addItem } = useApp();
  const { build, loaded, fit, remove, paint, clear } = useBuild(car);

  const [group, setGroup] = useState<SlotGroup>('style');
  const [slotKey, setSlotKey] = useState<string>(() => slotsInGroup(car, 'style')[0]?.key ?? '');
  const [stage, setStage] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const slot = findSlot(car, slotKey);
  const fitted = useMemo(() => fittedSlotKeys(car, build), [car, build]);
  const count = partCount(build);
  const hex = paintHex(car, build);

  const products = useQuery({
    queryKey: ['showroom', car.slug, slotKey],
    queryFn: () => fetchProducts({ category: slotKey, vehicleMake: car.make, vehicleModel: car.model, limit: PAGE }),
    enabled: !!slotKey,
  });

  const pickGroup = useCallback(
    (g: SlotGroup) => {
      setGroup(g);
      setSlotKey(slotsInGroup(car, g)[0]?.key ?? '');
    },
    [car],
  );

  const onFit = useCallback(
    (s: Slot, p: Product) => {
      const pushedOut = displacedBy(car, build, s.key)
        .map((k) => findSlot(car, k)?.label)
        .filter(Boolean);
      fit(s.key, toPart(p));
      if (pushedOut.length) {
        toast.show({ message: `${s.label} fitted. ${pushedOut.join(' and ')} removed — they can't go on together.`, icon: 'swap-horizontal' });
      }
    },
    [car, build, fit, toast],
  );

  const onReady = useCallback(() => setStage('ready'), []);
  const onFailed = useCallback(() => setStage('failed'), []);

  const plan = useMemo(() => planCart(car, build, cart.items.map((i) => i.productId)), [car, build, cart.items]);

  /**
   * Put the build in the cart, one part at a time. Each add is confirmed by the
   * server before the next; parts already in the cart are skipped, so a second
   * tap or a retry after a failure can never double a part.
   */
  const addBuildToCart = useCallback(async () => {
    if (adding) return;
    setAdding(true);
    let added = 0;
    let failed: string | null = null;
    try {
      for (const part of plan.add) {
        try {
          await addItem(part.productId, 1, null);
          added += 1;
        } catch {
          failed = part.name;
          break;
        }
      }
    } finally {
      setAdding(false);
    }

    if (failed) {
      toast.show({
        message: `${added > 0 ? `${added} added. ` : ''}Couldn't add "${failed}". Check your connection and try again.`,
        tone: 'error',
      });
      return;
    }
    if (plan.needOption.length > 0) {
      setSheetOpen(true);
      toast.show({
        message: `${added > 0 ? `${added} added to cart. ` : ''}${plan.needOption.length} ${plan.needOption.length === 1 ? 'part needs' : 'parts need'} an option chosen first.`,
        icon: 'options-outline',
      });
      return;
    }
    setSheetOpen(false);
    if (added > 0) toast.show({ message: `${added} ${added === 1 ? 'part' : 'parts'} added to cart`, tone: 'success' });
    router.push('/(tabs)/cart');
  }, [adding, plan, addItem, toast, router]);

  const stageH = Math.round(Math.min(width * 0.86, height * 0.4));
  const list = products.data?.products ?? [];
  const more = (products.data?.total ?? 0) > list.length;

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + spacing.xs }]}>
        <IconButton icon="chevron-back" label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1 }}>
          <View style={s.overRow}>
            <Stripes width={10} height={3} gap={2} />
            <Overline>3D showroom</Overline>
          </View>
          <Text style={s.title} numberOfLines={1} accessibilityRole="header">{car.make} {car.model}</Text>
        </View>
        <IconButton
          icon="cart-outline"
          label={`Cart, ${cart.totalItems} items`}
          onPress={() => router.push('/(tabs)/cart')}
          badge={cart.totalItems}
        />
      </View>

      {/* The stage. It sits outside any scroll view so a drag always turns the car. */}
      <View style={[s.stage, { height: stageH }]}>
        {stage === 'failed' ? (
          <EmptyState
            icon="cube-outline"
            title="3D view isn't available on this phone"
            body="You can still pick parts below and add them to your cart."
          />
        ) : (
          loaded && <Showroom3D parts={fitted} paint={hex} still={reduce} onReady={onReady} onError={onFailed} />
        )}
        {stage === 'loading' && (
          <View style={s.stageLoading} pointerEvents="none">
            <StripeLoader />
            <Text style={[type.caption, { marginTop: spacing.sm }]}>Rolling the car in…</Text>
          </View>
        )}
        {stage === 'ready' && (
          <>
            <View style={s.stageTop} pointerEvents="none">
              <Badge text="Sample 3D preview" tone="grey" icon="cube-outline" />
            </View>
            <View style={s.hint} pointerEvents="none">
              <Ionicons name="sync-outline" size={12} color={colors.muted} />
              <Text style={s.hintText}>Drag to turn · pinch to zoom</Text>
            </View>
            <View style={s.paints}>
              {car.paints.map((p) => {
                const on = build.paint === p.key;
                return (
                  <PressScale
                    key={p.key}
                    onPress={() => paint(p.key)}
                    haptic="selection"
                    hitSlop={6}
                    accessibilityLabel={`${p.label} paint`}
                    accessibilityState={{ selected: on }}
                    style={[s.paintDot, on && s.paintDotOn]}
                  >
                    <View style={[s.paintFill, { backgroundColor: p.hex }]} />
                  </PressScale>
                );
              })}
            </View>
          </>
        )}
      </View>

      <View style={s.groups} accessibilityRole="tablist">
        {SLOT_GROUPS.map((g) => {
          const on = g.key === group;
          const has = slotsInGroup(car, g.key).some((x) => x.key in build.parts);
          return (
            <PressScale
              key={g.key}
              onPress={() => pickGroup(g.key)}
              haptic="selection"
              style={[s.groupTab, on && s.groupTabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={g.label}
            >
              {has && <View style={s.dot} />}
              <Text style={[s.groupText, on && s.groupTextOn]}>{g.label}</Text>
            </PressScale>
          );
        })}
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.slots}>
          {slotsInGroup(car, group).map((x) => {
            const on = x.key === slotKey;
            const done = x.key in build.parts;
            return (
              <PressScale
                key={x.key}
                onPress={() => setSlotKey(x.key)}
                haptic="selection"
                style={[s.slotChip, on && s.slotChipOn]}
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${x.label}${done ? ', fitted' : ''}`}
              >
                <Ionicons name={(done ? 'checkmark-circle' : x.icon) as IconName} size={15} color={on || done ? colors.green : colors.steel} />
                <Text style={[s.slotText, on && s.slotTextOn]}>{x.label}</Text>
              </PressScale>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ flex: 1 }}>
        {products.isLoading ? (
          <View style={s.rail}>
            {Array.from({ length: 3 }, (_, i) => (
              <Shimmer key={i} width={CARD_W} height={196} radius={radius.lg} />
            ))}
          </View>
        ) : products.error ? (
          <ErrorState error={products.error} onRetry={() => products.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState icon="construct-outline" title={`No ${slot?.label.toLowerCase() ?? 'parts'} listed yet`} body={`We'll add more for the ${car.model} soon.`} />
        ) : (
          <FlatList
            horizontal
            data={list}
            keyExtractor={(p) => p.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.rail}
            ListFooterComponent={
              more ? (
                <PressScale
                  onPress={() => router.push(`/search?vehicleMake=${encodeURIComponent(car.make)}&vehicleModel=${encodeURIComponent(car.model)}&q=${encodeURIComponent(slot?.label ?? '')}`)}
                  style={[s.card, s.moreCard]}
                  accessibilityLabel={`See all ${slot?.label ?? 'parts'}`}
                >
                  <Ionicons name="arrow-forward-circle-outline" size={26} color={colors.green} />
                  <Text style={[type.caption, { color: colors.green, textAlign: 'center' }]}>See all {products.data?.total}</Text>
                </PressScale>
              ) : undefined
            }
            renderItem={({ item: p }) => {
              const on = !!slot && build.parts[slot.key]?.productId === p.id;
              const out = p.stock === 'out';
              return (
                <View style={[s.card, on && s.cardOn]}>
                  <PressScale onPress={() => router.push(`/product/${p.slug}`)} accessibilityLabel={`${p.name}, open details`}>
                    <Photo uri={p.image} style={s.cardImg} />
                    <Text style={s.cardName} numberOfLines={2}>{p.name}</Text>
                    {p.productType === 'variable' && p.priceTo > p.priceFrom ? (
                      <Text style={s.from}>From</Text>
                    ) : null}
                    <Price price={p.productType === 'variable' ? p.priceFrom : p.price} mrp={p.productType === 'variable' ? null : p.mrp} size="sm" hideOff />
                  </PressScale>
                  {out ? (
                    <Text style={s.out}>Out of stock</Text>
                  ) : (
                    <PremiumButton
                      label={on ? 'Fitted' : 'Fit on car'}
                      icon={on ? 'checkmark' : 'add'}
                      variant={on ? 'green' : 'outline'}
                      size="sm"
                      full
                      onPress={() => {
                        if (!slot) return;
                        if (on) remove(slot.key);
                        else onFit(slot, p);
                      }}
                      accessibilityLabel={on ? `Remove ${p.name} from the car` : `Fit ${p.name} on the car`}
                      style={{ marginTop: spacing.sm }}
                    />
                  )}
                </View>
              );
            }}
          />
        )}
      </View>

      <View style={[s.bar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <PressScale onPress={() => setSheetOpen(true)} style={s.barInfo} accessibilityLabel={`My build, ${count} ${count === 1 ? 'part' : 'parts'}. Open the list.`}>
          <Text style={s.barTitle}>My build</Text>
          <View style={s.barRow}>
            <Text style={s.barCount}>{count} {count === 1 ? 'part' : 'parts'}</Text>
            <Ionicons name="chevron-up" size={14} color={colors.green} />
          </View>
        </PressScale>
        <PremiumButton
          label="Add to cart"
          icon="cart-outline"
          variant="green"
          loading={adding}
          disabled={count === 0}
          onPress={addBuildToCart}
          style={{ flex: 1 }}
        />
      </View>

      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={`My ${car.model} build`}
        footer={
          count > 0 ? (
            <PremiumButton label={plan.add.length > 0 ? `Add ${plan.add.length} to cart` : 'Go to cart'} icon="cart-outline" variant="green" loading={adding} onPress={addBuildToCart} full />
          ) : undefined
        }
      >
        {count === 0 ? (
          <EmptyState icon="construct-outline" title="Nothing fitted yet" body={'Tap "Fit on car" on any part to start your build.'} />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            {fitted.map((key) => {
              const part = build.parts[key];
              const inCart = plan.alreadyInCart.includes(part);
              const needs = plan.needOption.includes(part);
              return (
                <View key={key} style={s.row}>
                  <Photo uri={part.image} style={s.rowImg} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowSlot}>{findSlot(car, key)?.label}</Text>
                    <Text style={s.rowName} numberOfLines={2}>{part.name}</Text>
                    {inCart ? (
                      <Text style={s.rowNote}>Already in your cart</Text>
                    ) : needs ? (
                      <PressScale
                        onPress={() => {
                          setSheetOpen(false);
                          router.push(`/product/${part.slug}`);
                        }}
                        accessibilityLabel={`Choose an option for ${part.name}`}
                      >
                        <Text style={s.rowLink}>Choose an option to buy ›</Text>
                      </PressScale>
                    ) : null}
                  </View>
                  <IconButton icon="close" label={`Remove ${part.name}`} tone="plain" size={36} onPress={() => remove(key)} />
                </View>
              );
            })}
            <Text style={s.sheetNote}>Prices and your total are shown in the cart.</Text>
            <PressScale onPress={clear} style={s.clear} accessibilityLabel="Remove all parts from the build">
              <Text style={s.clearText}>Remove all parts</Text>
            </PressScale>
          </View>
        )}
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screen },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.screen },
  overRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...type.h2 },

  stage: { backgroundColor: STAGE_BG, overflow: 'hidden' },
  stageLoading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: STAGE_BG },
  stageTop: { position: 'absolute', top: spacing.sm, left: spacing.md },
  hint: {
    position: 'absolute', left: spacing.md, bottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.glassLight, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  hintText: { fontFamily: font.medium, fontSize: 11, color: colors.muted },
  paints: {
    position: 'absolute', right: spacing.md, bottom: spacing.sm, flexDirection: 'row', gap: 6,
    backgroundColor: colors.white, borderRadius: radius.pill, padding: 5, ...elevation.e1,
  },
  paintDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  paintDotOn: { borderColor: colors.green },
  paintFill: { width: 18, height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.chrome },

  groups: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  groupTab: {
    flex: 1, height: 38, borderRadius: radius.pill, backgroundColor: colors.searchFill,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  groupTabOn: { backgroundColor: colors.green },
  groupText: { fontFamily: font.semibold, fontSize: 13, color: colors.ink2 },
  groupTextOn: { color: colors.white },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold },

  slots: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  slotChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: spacing.md,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white,
  },
  slotChipOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  slotText: { fontFamily: font.medium, fontSize: 13, color: colors.ink2 },
  slotTextOn: { color: colors.green },

  rail: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },
  card: {
    width: CARD_W, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line,
    padding: spacing.sm, ...elevation.e1,
  },
  cardOn: { borderColor: colors.green, borderWidth: 1.5 },
  moreCard: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 190 },
  cardImg: { width: '100%', height: 84, borderRadius: radius.md, backgroundColor: colors.well },
  cardName: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 16, color: colors.ink, marginTop: spacing.sm, minHeight: 32 },
  from: { ...type.tiny, marginTop: 2 },
  out: { ...type.caption, color: colors.red, marginTop: spacing.md, textAlign: 'center' },

  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    backgroundColor: colors.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
  },
  barInfo: { paddingVertical: spacing.xs, paddingRight: spacing.sm },
  barTitle: { ...type.tiny },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  barCount: { fontFamily: font.heading, fontSize: 16, color: colors.ink },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowImg: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.well },
  rowSlot: { ...type.tiny, color: colors.green },
  rowName: { fontFamily: font.medium, fontSize: 13.5, lineHeight: 18, color: colors.ink },
  rowNote: { ...type.tiny, marginTop: 2 },
  rowLink: { fontFamily: font.bold, fontSize: 12.5, color: colors.green, marginTop: 4 },
  sheetNote: { ...type.small, marginTop: spacing.lg, textAlign: 'center' },
  clear: { alignSelf: 'center', padding: spacing.md },
  clearText: { fontFamily: font.medium, fontSize: 13, color: colors.muted, textDecorationLine: 'underline' },
});
