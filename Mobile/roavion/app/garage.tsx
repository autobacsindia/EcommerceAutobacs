/**
 * Garage — save the customer's car once, then shop only what fits.
 *
 * This is the app's main advantage over the website: the choice is remembered
 * on the device, so every visit starts filtered to their vehicle.
 */
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchVehicles } from '../src/api/catalogue';
import { font, noir, noirSurface, radius, spacing, type } from '../src/theme';
import { EmptyState, ErrorState, GoldRule, IconButton, Overline, PremiumButton, PressScale, SectionHeader, SerifTitle, Shimmer } from '../src/ui';
import { useApp } from '../src/store';

export default function GarageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { garage, saveGarage } = useApp();
  const [make, setMake] = useState<string | null>(garage?.make ?? null);

  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => fetchVehicles() });

  const makes = useMemo(
    () => [...new Set((vehicles.data ?? []).map((v) => v.make))].sort((a, b) => a.localeCompare(b)),
    [vehicles.data],
  );
  /*
    Save the car and go straight to its parts. Saving without navigating is
    what made the old flow feel broken: the customer picked their car, nothing
    appeared to happen, and the way to the products was a separate button
    further up the screen.
  */
  const shop = useCallback(
    (pickedMake: string, model?: string) => {
      saveGarage(model ? { make: pickedMake, model } : { make: pickedMake });
      const qs = new URLSearchParams({ vehicleMake: pickedMake });
      if (model) qs.set('vehicleModel', model);
      router.push(`/search?${qs}`);
    },
    [saveGarage, router],
  );

  const models = useMemo(
    () => (vehicles.data ?? []).filter((v) => v.make === make),
    [vehicles.data, make],
  );

  const tileW = (width - spacing.lg * 2 - spacing.sm * 2) / 3;

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={s.titleRow}>
          <IconButton
            icon="chevron-back"
            label="Back"
            tone="plain"
            color={noir.text}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
          <View style={{ flex: 1 }}>
            <Overline noir>Fits your car</Overline>
            <SerifTitle size="title" italicLast accessibilityRole="header">My garage</SerifTitle>
          </View>
        </View>
        <Text style={s.subtitle}>Save your car to see parts that fit</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {garage && (
          <View style={s.carCard}>
            <GoldRule style={s.carRule} />
            <Overline tone="gold">Your car</Overline>
            <View style={s.savedRow}>
              <View style={s.savedIcon}>
                <Ionicons name="car-sport" size={26} color={noir.text} />
              </View>
              <View style={{ flex: 1 }}>
                <SerifTitle size="title" numberOfLines={1}>{garage.make}</SerifTitle>
                {!!garage.model && <Text style={s.carModel} numberOfLines={1}>{garage.model}</Text>}
              </View>
            </View>
            <PremiumButton
              label="Shop parts that fit"
              variant="noir"
              icon="search"
              full
              onPress={() =>
                router.push(
                  `/search?vehicleMake=${encodeURIComponent(garage.make)}${garage.model ? `&vehicleModel=${encodeURIComponent(garage.model)}` : ''}`,
                )
              }
              style={{ marginTop: spacing.lg }}
            />
            <PressScale onPress={() => { saveGarage(null); setMake(null); }} style={s.clear} accessibilityLabel="Remove this vehicle">
              <Text style={s.clearText}>Remove this vehicle</Text>
            </PressScale>
          </View>
        )}

        {vehicles.isLoading ? (
          <View style={s.grid}>
            {Array.from({ length: 9 }, (_, i) => (
              <Shimmer key={i} width={tileW} height={64} radius={radius.square} dark />
            ))}
          </View>
        ) : vehicles.error ? (
          <ErrorState error={vehicles.error} onRetry={() => vehicles.refetch()} onDark />
        ) : makes.length === 0 ? (
          <EmptyState icon="car-sport-outline" title="No cars listed yet" body="Our specialists can still help you find parts that fit." onDark />
        ) : (
          <>
            <SectionHeader noir italicLast inset={false} overline={garage ? 'Change vehicle' : 'Step 1'} title={garage ? 'Pick another make' : 'Pick your make'} />
            <View style={s.grid}>
              {makes.map((m) => {
                const on = make === m;
                return (
                  <PressScale
                    key={m}
                    onPress={() => setMake(m === make ? null : m)}
                    haptic="selection"
                    style={[s.makeTile, { width: tileW }, on && s.tileOn]}
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={m}
                  >
                    <Ionicons name="car-sport-outline" size={18} color={on ? noir.gold : noir.textFaint} />
                    <Text style={[s.makeText, on && s.tileTextOn]} numberOfLines={1}>{m}</Text>
                    {on && (
                      <View style={s.tick}>
                        <Ionicons name="checkmark" size={10} color={noir.ctaText} />
                      </View>
                    )}
                  </PressScale>
                );
              })}
            </View>

            {make && (
              <>
                {/*
                  Picking a make is already enough to shop, and this button says
                  so. Before, choosing "BMW" only revealed a model list headed
                  "2. Pick your model", so the model read as required; the one
                  way to shop a whole make was an "All BMW" chip sitting among
                  the models, which merely saved the car and left the customer
                  to find "Shop parts that fit" afterwards. Three steps, none
                  of them obvious, for the app's primary journey.
                */}
                <PremiumButton
                  label={`Show all ${make} parts`}
                  onPress={() => shop(make)}
                  iconRight="arrow-forward"
                  variant="noir"
                  full
                  style={{ marginTop: spacing.lg }}
                />

                <SectionHeader
                  noir
                  italicLast
                  inset={false}
                  overline="Optional"
                  title="Or pick your model"
                  subtitle="It narrows the results to parts that fit that model exactly."
                  style={{ marginTop: spacing.xl }}
                />
                <View style={s.grid}>
                  {models.map((v) => {
                    const on = garage?.make === make && garage?.model === v.model;
                    return (
                      <PressScale
                        key={`${v.make}-${v.model}`}
                        // Saves AND goes, because picking a model IS the request.
                        onPress={() => shop(make, v.model)}
                        haptic="selection"
                        style={[s.modelPill, on && s.tileOn]}
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={v.model}
                      >
                        <Text style={[s.modelText, on && s.tileTextOn]}>{v.model}</Text>
                        <Ionicons name="chevron-forward" size={13} color={on ? noir.gold : noir.textFaint} />
                      </PressScale>
                    );
                  })}
                </View>
                {models.length === 0 && (
                  <Text style={[type.smallNoir, { marginTop: spacing.sm }]}>
                    No specific models listed for {make} yet — the button above still
                    shows every {make} part we carry.
                  </Text>
                )}
              </>
            )}

            <View style={s.help}>
              <View style={s.helpIcon}>
                <Ionicons name="headset-outline" size={18} color={noir.gold} />
              </View>
              <Text style={[type.smallNoir, { flex: 1 }]}>
                Can&apos;t find your car? Our specialists can still help you find parts that fit.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: noir.page },
  header: { backgroundColor: noir.page, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  subtitle: { ...type.smallNoir, marginTop: 2, marginLeft: 48 },

  carCard: { ...noirSurface, padding: spacing.xl, marginBottom: spacing.xl, overflow: 'hidden' },
  carRule: { position: 'absolute', top: 0, left: 0, right: 0 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  savedIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: noir.green, borderWidth: 1.5, borderColor: noir.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  carModel: { ...type.bodyNoir, color: noir.textMuted },
  clear: { marginTop: spacing.md, alignSelf: 'center', padding: spacing.xs },
  clearText: { fontFamily: font.medium, fontSize: 13, color: noir.textMuted, textDecorationLine: 'underline' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  makeTile: {
    ...noirSurface, height: 64, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: spacing.xs,
  },
  makeText: { fontFamily: font.semibold, fontSize: 12.5, color: noir.text },
  tileOn: { borderColor: noir.gold, backgroundColor: noir.goldFaint },
  tileTextOn: { color: noir.text },
  tick: {
    position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: noir.gold, alignItems: 'center', justifyContent: 'center',
  },
  modelPill: {
    ...noirSurface, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingLeft: spacing.lg, paddingRight: spacing.md, height: 40,
  },
  modelText: { fontFamily: font.medium, fontSize: 13.5, color: noir.text },

  help: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginTop: spacing.xl, padding: spacing.lg,
    borderWidth: 1, borderColor: noir.hairline, borderRadius: radius.square,
  },
  helpIcon: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: noir.goldLine, alignItems: 'center', justifyContent: 'center',
  },
});
