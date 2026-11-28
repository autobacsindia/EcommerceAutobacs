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
import { colors, elevation, font, radius, spacing, type } from '../src/theme';
import { EmptyState, ErrorState, IconButton, Overline, PremiumButton, PressScale, SectionHeader, Shimmer, Stripes } from '../src/ui';
import { DEFAULT_SHOWROOM_CAR, showroomCarFor } from '../src/garage/slots';
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

  // The 3D showroom exists for a few cars only. A customer whose saved car has
  // one opens their own; everyone else is offered the first car to try it.
  const showroomCar = showroomCarFor(garage?.make, garage?.model) ?? DEFAULT_SHOWROOM_CAR;

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={s.titleRow}>
          <IconButton
            icon="chevron-back"
            label="Back"
            tone="plain"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
          <View style={{ flex: 1 }}>
            <View style={s.overRow}>
              <Stripes width={10} height={3} gap={2} />
              <Overline>Fits your car</Overline>
            </View>
            <Text style={s.title} accessibilityRole="header">My garage</Text>
          </View>
        </View>
        <Text style={s.subtitle}>Save your car to see parts that fit</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        <PressScale
          onPress={() => router.push(`/showroom?car=${showroomCar.slug}`)}
          haptic="light"
          style={s.showroom}
          accessibilityLabel={`Open the 3D showroom for the ${showroomCar.make} ${showroomCar.model}`}
        >
          <View style={s.showroomIcon}>
            <Ionicons name="cube-outline" size={22} color={colors.green} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={s.overRow}>
              <Overline>New · 3D showroom</Overline>
            </View>
            <Text style={s.showroomTitle}>Build your {showroomCar.make} {showroomCar.model}</Text>
            <Text style={s.showroomBody}>Turn the car around and fit parts on it.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.green} />
        </PressScale>

        {garage && (
          <View style={s.carCard}>
            <View style={s.carStripes} pointerEvents="none">
              <Stripes width={40} height={140} gap={10} onDark />
            </View>
            <Overline onDark>Your car</Overline>
            <View style={s.savedRow}>
              <View style={s.savedIcon}>
                <Ionicons name="car-sport" size={26} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.carMake} numberOfLines={1}>{garage.make}</Text>
                {!!garage.model && <Text style={s.carModel} numberOfLines={1}>{garage.model}</Text>}
              </View>
            </View>
            <PremiumButton
              label="Shop parts that fit"
              variant="light"
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
              <Shimmer key={i} width={tileW} height={64} radius={radius.lg} />
            ))}
          </View>
        ) : vehicles.error ? (
          <ErrorState error={vehicles.error} onRetry={() => vehicles.refetch()} />
        ) : makes.length === 0 ? (
          <EmptyState icon="car-sport-outline" title="No cars listed yet" body="Our specialists can still help you find parts that fit." />
        ) : (
          <>
            <SectionHeader inset={false} overline={garage ? 'Change vehicle' : 'Step 1'} title={garage ? 'Pick another make' : 'Pick your make'} />
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
                    <Ionicons name="car-sport-outline" size={18} color={on ? colors.green : colors.steel} />
                    <Text style={[s.makeText, on && s.tileTextOn]} numberOfLines={1}>{m}</Text>
                    {on && (
                      <View style={s.tick}>
                        <Ionicons name="checkmark" size={10} color={colors.white} />
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
                  full
                  style={{ marginTop: spacing.lg }}
                />

                <SectionHeader
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
                        <Ionicons name="chevron-forward" size={13} color={on ? colors.green : colors.chrome} />
                      </PressScale>
                    );
                  })}
                </View>
                {models.length === 0 && (
                  <Text style={[type.small, { marginTop: spacing.sm, color: colors.muted }]}>
                    No specific models listed for {make} yet — the button above still
                    shows every {make} part we carry.
                  </Text>
                )}
              </>
            )}

            <View style={s.help}>
              <View style={s.helpIcon}>
                <Ionicons name="headset-outline" size={18} color={colors.green} />
              </View>
              <Text style={[type.small, { flex: 1, color: colors.ink2 }]}>
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
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.bg, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  overRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...type.h1 },
  subtitle: { ...type.small, color: colors.muted, marginTop: 2, marginLeft: 48 },

  carCard: {
    backgroundColor: colors.carbon, borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.xl,
    overflow: 'hidden', ...elevation.e2,
  },
  carStripes: { position: 'absolute', right: spacing.lg, top: spacing.lg, opacity: 0.16 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  savedIcon: {
    width: 52, height: 52, borderRadius: radius.lg, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center',
  },
  carMake: { ...type.h1, color: colors.white },
  carModel: { ...type.body, color: colors.onDarkMuted },
  clear: { marginTop: spacing.md, alignSelf: 'center', padding: spacing.xs },
  clearText: { fontFamily: font.medium, fontSize: 13, color: colors.onDarkMuted, textDecorationLine: 'underline' },

  showroom: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.xl,
    backgroundColor: colors.greenFaint, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.greenSoft,
  },
  showroomIcon: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  showroomTitle: { ...type.h3, marginTop: 2 },
  showroomBody: { ...type.small },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  makeTile: {
    height: 64, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: spacing.xs, ...elevation.e1,
  },
  makeText: { fontFamily: font.semibold, fontSize: 12.5, color: colors.ink },
  tileOn: { backgroundColor: colors.greenFaint, borderColor: colors.green, borderWidth: 1.5 },
  tileTextOn: { color: colors.green },
  tick: {
    position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center',
  },
  modelPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.white, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, paddingLeft: spacing.lg, paddingRight: spacing.md, height: 40,
  },
  modelText: { fontFamily: font.medium, fontSize: 13.5, color: colors.ink },

  help: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginTop: spacing.xl, padding: spacing.lg,
    backgroundColor: colors.greenFaint, borderRadius: radius.lg,
  },
  helpIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});
