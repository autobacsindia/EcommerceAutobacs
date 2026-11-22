/**
 * Dev-only gallery of the premium foundation (src/ui), so screen authors and
 * reviewers can see every primitive in one place. Redirects home in
 * production builds — it is never reachable by customers.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { colors, noir, palette, spacing, type } from '../src/theme';
import {
  Badge,
  Card,
  Crest,
  GoldRule,
  Hairline,
  HeroScrim,
  LineDots,
  Overline,
  SearchBar,
  SerifTitle,
  EmptyState,
  GlassChip,
  IconButton,
  ListSkeleton,
  OfflineState,
  PremiumButton,
  Price,
  ProductCardSkeleton,
  Rating,
  SectionHeader,
  Sheet,
  Shimmer,
  StripeLoader,
  Stripes,
  useToast,
} from '../src/ui';

const noop = () => {};

export default function DevUi() {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: 'Design system' }} />
      <ScrollView contentContainerStyle={{ paddingVertical: spacing.lg, gap: spacing.xl }}>
        {/* Heritage Noir */}
        <View style={s.noir}>
          <View style={s.hero}>
            <HeroScrim style={{ backgroundColor: noir.green }} />
            <View style={s.heroHead}>
              <Crest />
              <Text style={s.wordmark}>AUTOBACS</Text>
              <Crest ring="gold" />
            </View>
            <View style={{ gap: spacing.sm }}>
              <Overline tone="gold">The Heritage Collection</Overline>
              <SerifTitle size="hero" italicLast>
                Make it yours.
              </SerifTitle>
              <View style={s.heroFoot}>
                <PremiumButton label="Shop now" variant="noir" size="sm" onPress={noop} />
                <LineDots count={3} index={0} />
              </View>
            </View>
          </View>
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
            <SearchBar onPress={noop} />
            <SectionHeader noir inset={false} overline="Watch & shop" title="Shop the reel" italicLast actionLabel="See all" onAction={noop} />
            <Card tone="noir">
              <Overline tone="gold">Profender</Overline>
              <SerifTitle size="product">Drift Series Suspension Kit</SerifTitle>
              <Price price={112500} mrp={140625} onDark size="lg" style={{ marginTop: spacing.sm }} />
            </Card>
            <GoldRule />
            <View style={s.row}>
              <PremiumButton label="Add to cart" variant="noirOutline" onPress={noop} style={{ flex: 1 }} />
              <PremiumButton label="Buy now" variant="noir" onPress={noop} style={{ flex: 1 }} />
            </View>
            <GoldRule label="Heritage" />
            <Hairline />
            <ProductCardSkeleton width={160} dark />
            <PremiumButton label="Toast" variant="noirOutline" size="sm" onPress={() => toast.show({ message: 'Added to cart', tone: 'success' })} />
          </View>
        </View>
        <SectionHeader overline="Foundation" title="Palette" stripes />
        <View style={s.swatches}>
          {Object.entries(palette).map(([k, v]) => (
            <View key={k} style={s.swatch}>
              <View style={[s.chip, { backgroundColor: v }]} />
              <Text style={type.tiny}>{k}</Text>
            </View>
          ))}
        </View>

        <SectionHeader title="Type" />
        <View style={s.pad}>
          <Text style={type.overline}>Overline</Text>
          <Text style={type.display}>Display 28</Text>
          <Text style={type.h1}>Heading 1 · 22</Text>
          <Text style={type.h2}>Heading 2 · 18</Text>
          <Text style={type.body}>Body 15 — DM Sans, as on the website.</Text>
          <Text style={type.caption}>Caption 12</Text>
        </View>

        <SectionHeader title="Buttons" actionLabel="See all" onAction={noop} />
        <View style={[s.pad, { gap: spacing.md }]}>
          <PremiumButton label="Buy now" onPress={noop} full />
          <PremiumButton label="Add to cart" variant="green" icon="cart-outline" onPress={noop} full />
          <View style={s.row}>
            <PremiumButton label="Outline" variant="outline" size="sm" onPress={noop} />
            <PremiumButton label="Busy" loading size="sm" onPress={noop} />
            <PremiumButton label="Toast" variant="ghost" size="sm" onPress={() => toast.show({ message: 'Added to cart', tone: 'success' })} />
            <PremiumButton label="Sheet" variant="ghost" size="sm" onPress={() => setSheet(true)} />
          </View>
          <View style={s.row}>
            <IconButton icon="heart-outline" label="Save" onPress={noop} />
            <IconButton icon="share-outline" label="Share" tone="dark" onPress={noop} />
            <IconButton icon="cart-outline" label="Cart" onPress={noop} badge={3} />
          </View>
        </View>

        <SectionHeader title="On dark" />
        <View style={[s.pad, s.dark]}>
          <GlassChip icon="car-sport-outline" label="Creta 2022" action="Change" onPress={noop} />
          <Price price={1169} mrp={1799} festivalPrice={1169} onDark size="lg" />
          <Rating rating={4.5} count={780} onDark />
          <View style={s.row}>
            <PremiumButton label="Add to cart" variant="outlineLight" size="sm" onPress={noop} />
            <PremiumButton label="Shop now" variant="light" size="sm" onPress={noop} />
          </View>
          <StripeLoader onDark size="lg" />
        </View>

        <SectionHeader title="Price · rating · badges" />
        <Card style={{ marginHorizontal: spacing.lg, gap: spacing.sm }}>
          <Price price={1299} mrp={1799} />
          <Price price={1299} festivalPrice={1169} size="lg" />
          <Rating rating={4.5} count={780} />
          <Rating rating={4.2} count={56} compact />
          <View style={s.row}>
            <Badge text="In stock" />
            <Badge text="-28%" tone="solidRed" />
            <Badge text="Pending" tone="gold" />
            <Badge text="New" tone="ink" icon="sparkles" />
          </View>
        </Card>

        <SectionHeader title="Loaders" />
        <View style={[s.pad, s.row, { alignItems: 'center' }]}>
          <StripeLoader size="sm" />
          <StripeLoader />
          <StripeLoader size="lg" />
          <Stripes />
        </View>
        <View style={[s.pad, s.row]}>
          <ProductCardSkeleton width={160} />
          <View style={{ flex: 1, gap: 8 }}>
            <Shimmer width="80%" height={14} />
            <Shimmer width="50%" height={12} />
          </View>
        </View>
        <ListSkeleton rows={2} />

        <SectionHeader title="States" />
        <View style={{ height: 360 }}>
          <EmptyState icon="cart-outline" title="Your cart is empty" body="Find something your car will love." action={{ label: 'Start shopping', onPress: noop }} />
        </View>
        <View style={{ height: 340 }}>
          <OfflineState onRetry={noop} />
        </View>
      </ScrollView>
      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Sort by" footer={<PremiumButton label="Show results" variant="noir" onPress={() => setSheet(false)} full />}>
        {['Recommended', 'Price: low to high', 'Price: high to low', 'Newest'].map((t) => (
          <Text key={t} style={[type.bodyNoir, { paddingVertical: spacing.md }]}>
            {t}
          </Text>
        ))}
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  pad: { paddingHorizontal: spacing.lg },
  noir: { backgroundColor: noir.page, paddingBottom: spacing.xl, gap: spacing.lg },
  hero: { height: 340, padding: spacing.lg, justifyContent: 'space-between' },
  heroHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  wordmark: { ...type.serifSection, fontSize: 17, letterSpacing: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dark: { backgroundColor: colors.carbon, paddingVertical: spacing.xl, gap: spacing.md, marginHorizontal: spacing.lg, borderRadius: 22 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingHorizontal: spacing.lg },
  swatch: { width: 72, alignItems: 'center', gap: 4 },
  chip: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line },
});
