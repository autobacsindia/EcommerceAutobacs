/**
 * 3D garage — the car stands in a garage that fills the whole screen. Turn it,
 * fit parts on it from the strip at the bottom, then buy the build.
 *
 * The car on the stage is a SAMPLE drawing (see src/garage/showroom); the parts
 * in the strip are real products that fit the car, read from the shop.
 *
 * This is the one deliberately dark screen in the app: the controls float over
 * a lit garage, the way a showroom configurator does (owner, 2026-11-28).
 *
 * Money rule: this screen shows each product's own server price and nothing
 * else. It never adds prices up — the build's total exists only in the cart.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
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
import { alpha, colors, font, inr, radius, spacing, type } from '../src/theme';
import { EmptyState, IconButton, PremiumButton, PressScale, Sheet, StripeLoader, Stripes, useReduceMotion, useToast } from '../src/ui';

const PAGE = 20;
const CARD_W = 128;
/** The colour picker sits beside the part slots, but it is not a part. */
const PAINT = 'paint';
const HEADER_H = 56;

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
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{ car?: string }>();
  const car = showroomCarBySlug(params.car) ?? DEFAULT_SHOWROOM_CAR;

  const { cart, addItem } = useApp();
  const { build, loaded, fit, remove, paint, clear } = useBuild(car);

  const [group, setGroup] = useState<SlotGroup>('style');
  const [choice, setChoice] = useState<string>(PAINT);
  const [stage, setStage] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [panelH, setPanelH] = useState(0);

  /** What the ‹ › arrows step through in this group: colours first under Style, then the slots. */
  const choices = useMemo(
    () => [...(group === 'style' ? [{ key: PAINT, label: 'Colours' }] : []), ...slotsInGroup(car, group).map((s) => ({ key: s.key, label: s.label }))],
    [car, group],
  );
  const index = Math.max(0, choices.findIndex((c) => c.key === choice));
  const current = choices[index];
  const slot = current && current.key !== PAINT ? findSlot(car, current.key) : null;

  const fitted = useMemo(() => fittedSlotKeys(car, build), [car, build]);
  const count = partCount(build);
  const hex = paintHex(car, build);

  const products = useQuery({
    queryKey: ['showroom', car.slug, slot?.key],
    queryFn: () => fetchProducts({ category: slot?.key, vehicleMake: car.make, vehicleModel: car.model, limit: PAGE }),
    enabled: !!slot,
  });

  const pickGroup = useCallback(
    (g: SlotGroup) => {
      setGroup(g);
      setChoice(g === 'style' ? PAINT : slotsInGroup(car, g)[0]?.key ?? PAINT);
    },
    [car],
  );
  const step = useCallback(
    (by: number) => {
      const next = choices[(index + by + choices.length) % choices.length];
      if (next) setChoice(next.key);
    },
    [choices, index],
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
  const onPanelLayout = useCallback((e: LayoutChangeEvent) => setPanelH(Math.round(e.nativeEvent.layout.height)), []);

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

  const list = products.data?.products ?? [];
  const more = (products.data?.total ?? 0) > list.length;
  const insetTop = (insets.top + HEADER_H) / height;
  const insetBottom = panelH / height;

  return (
    <View style={s.screen}>
      <StatusBar style="light" />

      {/* The garage fills the screen; everything else floats over it. */}
      <View style={StyleSheet.absoluteFill}>
        {stage === 'failed' ? (
          <View style={[s.center, { paddingBottom: panelH }]}>
            <EmptyState icon="cube-outline" title="3D view isn't available on this phone" body="You can still pick parts below and add them to your cart." onDark />
          </View>
        ) : (
          // Mounted once the saved build and the panel's size are known, so the
          // car opens already fitted and already framed above the controls.
          loaded && panelH > 0 && (
            <Showroom3D parts={fitted} paint={hex} still={reduce} insetTop={insetTop} insetBottom={insetBottom} onReady={onReady} onError={onFailed} />
          )
        )}
        {stage === 'loading' && (
          <View style={[s.center, StyleSheet.absoluteFill, { backgroundColor: STAGE_BG, paddingBottom: panelH }]} pointerEvents="none">
            <StripeLoader onDark />
            <Text style={s.loadingText}>Opening the garage…</Text>
          </View>
        )}
      </View>

      <LinearGradient colors={[alpha(colors.void, 0.78), alpha(colors.void, 0)]} style={[s.header, { paddingTop: insets.top, height: insets.top + HEADER_H + 24 }]} pointerEvents="box-none">
        <View style={s.headerRow}>
          <IconButton icon="chevron-back" label="Back" tone="glass" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <View style={{ flex: 1 }}>
            <View style={s.overRow}>
              <Stripes width={10} height={3} gap={2} onDark />
              <Text style={s.over}>My garage</Text>
            </View>
            <Text style={s.title} numberOfLines={1} accessibilityRole="header">{car.make} {car.model}</Text>
          </View>
          <IconButton icon="cart-outline" label={`Cart, ${cart.totalItems} items`} tone="glass" onPress={() => router.push('/(tabs)/cart')} badge={cart.totalItems} />
        </View>
      </LinearGradient>

      <View style={s.panel} onLayout={onPanelLayout} pointerEvents="box-none">
        <LinearGradient colors={[alpha(colors.void, 0), alpha(colors.void, 0.82)]} style={s.fade} pointerEvents="none" />

        {/* What can go in this slot. The strip is see-through so the car shows behind it. */}
        <View style={s.options}>
          {current?.key === PAINT ? (
            <View style={s.paints}>
              {car.paints.map((p) => {
                const on = build.paint === p.key;
                return (
                  <PressScale key={p.key} onPress={() => paint(p.key)} haptic="selection" style={s.paintItem} accessibilityLabel={`${p.label} paint`} accessibilityState={{ selected: on }}>
                    <View style={[s.paintRing, on && s.paintRingOn]}>
                      <View style={[s.paintFill, { backgroundColor: p.hex }]} />
                    </View>
                    <Text style={[s.paintLabel, on && s.paintLabelOn]}>{p.label}</Text>
                  </PressScale>
                );
              })}
            </View>
          ) : products.isLoading ? (
            <View style={s.optionsCenter}><StripeLoader onDark size="sm" /></View>
          ) : products.error ? (
            <View style={s.optionsCenter}>
              <Text style={s.note}>Couldn&apos;t load these parts.</Text>
              <PremiumButton label="Try again" variant="light" size="sm" onPress={() => products.refetch()} style={{ marginTop: spacing.sm }} />
            </View>
          ) : list.length === 0 ? (
            <View style={s.optionsCenter}><Text style={s.note}>No {slot?.label.toLowerCase()} listed for the {car.model} yet.</Text></View>
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
                    <Ionicons name="arrow-forward-circle-outline" size={26} color={colors.white} />
                    <Text style={s.note}>See all {products.data?.total}</Text>
                  </PressScale>
                ) : undefined
              }
              renderItem={({ item: p }) => {
                const on = !!slot && build.parts[slot.key]?.productId === p.id;
                const out = p.stock === 'out';
                const variable = p.productType === 'variable';
                return (
                  // The card is a plain box holding two separate buttons (fit, details):
                  // a button inside a button is not allowed and confuses screen readers.
                  <View style={[s.card, on && s.cardOn, out && { opacity: 0.55 }]}>
                    <PressScale
                      disabled={out}
                      onPress={() => {
                        if (!slot) return;
                        if (on) remove(slot.key);
                        else onFit(slot, p);
                      }}
                      haptic="light"
                      accessibilityLabel={out ? `${p.name}, out of stock` : on ? `Remove ${p.name} from the car` : `Fit ${p.name} on the car`}
                      accessibilityState={{ selected: on, disabled: out }}
                    >
                      <Photo uri={p.image} style={s.cardImg} />
                      <View style={[s.cardMark, on && s.cardMarkOn]}>
                        <Ionicons name={on ? 'checkmark' : 'add'} size={14} color={colors.white} />
                      </View>
                      <Text style={s.cardName} numberOfLines={2}>{p.name}</Text>
                    </PressScale>
                    <View style={s.cardFoot}>
                      <Text style={s.cardPrice} numberOfLines={1}>
                        {out ? 'Out of stock' : `${variable && p.priceTo > p.priceFrom ? 'From ' : ''}${inr(variable ? p.priceFrom : p.price)}`}
                      </Text>
                      <PressScale onPress={() => router.push(`/product/${p.slug}`)} hitSlop={10} accessibilityLabel={`${p.name}, open details`}>
                        <Ionicons name="information-circle-outline" size={18} color={colors.onDarkMuted} />
                      </PressScale>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>

        <View style={[s.controls, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Text style={s.disclaimer}>3D picture is a sample. The real car and parts may look different.</Text>

          {/* ‹ Roll bar › — step through what can be changed in this group. */}
          <View style={s.stepper}>
            <IconButton icon="chevron-back" label="Previous" tone="plain" color={colors.white} onPress={() => step(-1)} />
            <View style={s.stepMid}>
              <View style={s.stepTitleRow}>
                {(current?.key === PAINT || (current && current.key in build.parts)) && <View style={s.dotOn} />}
                <Text style={s.stepTitle} accessibilityRole="header">{current?.label}</Text>
              </View>
              <View style={s.pips}>
                {choices.map((c, i) => (
                  <View key={c.key} style={[s.pip, i === index && s.pipOn]} />
                ))}
              </View>
            </View>
            <IconButton icon="chevron-forward" label="Next" tone="plain" color={colors.white} onPress={() => step(1)} />
          </View>

          <View style={s.groups} accessibilityRole="tablist">
            {SLOT_GROUPS.map((g) => {
              const on = g.key === group;
              const has = slotsInGroup(car, g.key).some((x) => x.key in build.parts);
              return (
                <PressScale key={g.key} onPress={() => pickGroup(g.key)} haptic="selection" style={s.groupTab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={g.label}>
                  {has && <View style={s.dotOn} />}
                  <Text style={[s.groupText, on && s.groupTextOn]}>{g.label}</Text>
                </PressScale>
              );
            })}
          </View>

          <View style={s.actions}>
            <PressScale onPress={() => setSheetOpen(true)} style={s.buildBtn} accessibilityLabel={`My build, ${count} ${count === 1 ? 'part' : 'parts'}. Open the list.`}>
              <Text style={s.buildBtnText}>My build · {count}</Text>
            </PressScale>
            <PremiumButton label="Add to cart" icon="cart-outline" variant="green" loading={adding} disabled={count === 0} onPress={addBuildToCart} style={{ flex: 1.3 }} />
          </View>
        </View>
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
          <EmptyState icon="construct-outline" title="Nothing fitted yet" body="Tap any part to fit it on the car and start your build." />
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
  screen: { flex: 1, backgroundColor: STAGE_BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontFamily: font.medium, fontSize: 12, color: colors.onDarkMuted, marginTop: spacing.sm },

  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  headerRow: { height: HEADER_H, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  overRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  over: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.onDarkMuted },
  title: { fontFamily: font.heading, fontSize: 20, lineHeight: 26, color: colors.white },

  panel: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  fade: { position: 'absolute', left: 0, right: 0, top: 0, height: 150 },

  options: { height: 150, justifyContent: 'flex-end' },
  optionsCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  note: { fontFamily: font.medium, fontSize: 12.5, color: colors.onDarkMuted, textAlign: 'center' },
  rail: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'flex-end' },
  card: {
    width: CARD_W, borderRadius: radius.lg, padding: spacing.sm, backgroundColor: alpha(colors.carbon, 0.78),
    borderWidth: 1, borderColor: colors.onDarkFaint,
  },
  cardOn: { borderColor: colors.greenOnDark, borderWidth: 1.5, backgroundColor: alpha(colors.greenDeep, 0.82) },
  moreCard: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 138 },
  cardImg: { width: '100%', height: 62, borderRadius: radius.md, backgroundColor: colors.white },
  cardMark: {
    position: 'absolute', top: -4, right: -4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: alpha(colors.ink, 0.7), alignItems: 'center', justifyContent: 'center',
  },
  cardMarkOn: { backgroundColor: colors.greenMid },
  cardName: { fontFamily: font.medium, fontSize: 11.5, lineHeight: 15, color: colors.white, marginTop: 6, minHeight: 30 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: 2 },
  cardPrice: { flex: 1, fontFamily: font.bold, fontSize: 12.5, color: colors.white },

  paints: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  paintItem: { alignItems: 'center', gap: 6 },
  paintRing: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  paintRingOn: { borderColor: colors.white },
  paintFill: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.onDarkFaint },
  paintLabel: { fontFamily: font.medium, fontSize: 11.5, color: colors.onDarkMuted },
  paintLabelOn: { fontFamily: font.bold, color: colors.white },

  controls: { backgroundColor: alpha(colors.void, 0.82), paddingTop: spacing.sm },
  disclaimer: { fontFamily: font.regular, fontSize: 10.5, color: alpha(colors.white, 0.55), textAlign: 'center', paddingHorizontal: spacing.lg },
  stepper: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, marginTop: 2 },
  stepMid: { flex: 1, alignItems: 'center', gap: 6 },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepTitle: { fontFamily: font.semibold, fontSize: 15, color: colors.white },
  pips: { flexDirection: 'row', gap: 5 },
  pip: { width: 14, height: 2, borderRadius: 1, backgroundColor: colors.onDarkFaint },
  pipOn: { backgroundColor: colors.greenOnDark },
  dotOn: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.greenOnDark },

  groups: {
    flexDirection: 'row', marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.onDarkFaint,
  },
  groupTab: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  groupText: { fontFamily: font.medium, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: alpha(colors.white, 0.55) },
  groupTextOn: { fontFamily: font.bold, fontSize: 14, color: colors.white },

  actions: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  buildBtn: { flex: 1, height: 50, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  buildBtnText: { fontFamily: font.bold, fontSize: 14, color: colors.white },

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
