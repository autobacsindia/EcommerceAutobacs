/**
 * Garage — save the customer's car once, then shop only what fits.
 *
 * This is the app's main advantage over the website: the choice is remembered
 * on the device, so every visit starts filtered to their vehicle.
 */
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchVehicles } from '../../src/api/catalogue';
import { Button, Card, Screenful, T } from '../../src/components/ui';
import { colors, font, radius, shadow, spacing } from '../../src/theme';
import { useApp } from '../../src/store';

export default function GarageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={s.title}>My garage</Text>
        <Text style={s.subtitle}>Save your car to see parts that fit</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {garage && (
          <Card style={{ marginBottom: spacing.lg }}>
            <View style={s.savedRow}>
              <View style={s.savedIcon}>
                <Ionicons name="car-sport" size={22} color={colors.green} />
              </View>
              <View style={{ flex: 1 }}>
                <T kind="h3">{garage.make}{garage.model ? ` ${garage.model}` : ''}</T>
                <T kind="small">Your saved vehicle</T>
              </View>
            </View>
            <View style={s.savedActions}>
              <Button
                label="Shop parts that fit"
                onPress={() =>
                  router.push(
                    `/search?vehicleMake=${encodeURIComponent(garage.make)}${garage.model ? `&vehicleModel=${encodeURIComponent(garage.model)}` : ''}`,
                  )
                }
                icon="search"
                style={{ flex: 1 }}
              />
            </View>
            <Pressable onPress={() => { saveGarage(null); setMake(null); }} style={s.clear} accessibilityRole="button">
              <Text style={s.clearText}>Remove this vehicle</Text>
            </Pressable>
          </Card>
        )}

        {vehicles.isLoading || vehicles.error ? (
          <Screenful
            loading={vehicles.isLoading}
            error={vehicles.error ? (vehicles.error as Error).message : null}
            onRetry={() => vehicles.refetch()}
          />
        ) : (
          <>
            <T kind="h3" style={{ marginBottom: spacing.md }}>{garage ? 'Change vehicle' : 'Pick your make'}</T>
            <View style={s.grid}>
              {makes.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMake(m === make ? null : m)}
                  style={[s.pill, make === m && s.pillOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: make === m }}
                >
                  <Text style={[s.pillText, make === m && s.pillTextOn]}>{m}</Text>
                </Pressable>
              ))}
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
                <Button
                  label={`Show all ${make} parts`}
                  onPress={() => shop(make)}
                  icon="arrow-forward"
                  style={{ marginTop: spacing.lg }}
                />

                <T kind="h3" style={{ marginTop: spacing.xl, marginBottom: spacing.xs }}>
                  Or pick your model
                </T>
                <T kind="small" style={{ marginBottom: spacing.md }}>
                  Optional — it narrows the results to parts that fit that model exactly.
                </T>
                <View style={s.grid}>
                  {models.map((v) => {
                    const on = garage?.make === make && garage?.model === v.model;
                    return (
                      <Pressable
                        key={`${v.make}-${v.model}`}
                        // Saves AND goes, because picking a model IS the request.
                        onPress={() => shop(make, v.model)}
                        style={[s.pill, on && s.pillOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[s.pillText, on && s.pillTextOn]}>{v.model}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {models.length === 0 && (
                  <T kind="small" style={{ marginTop: spacing.sm }}>
                    No specific models listed for {make} yet — the button above still
                    shows every {make} part we carry.
                  </T>
                )}
              </>
            )}

            <View style={s.help}>
              <Ionicons name="headset-outline" size={18} color={colors.green} />
              <T kind="small" style={{ flex: 1 }}>
                Can&apos;t find your car? Our specialists can still help you find parts that fit.
              </T>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.header, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { fontFamily: font.bold, fontSize: 20, color: colors.white },
  subtitle: { fontFamily: font.regular, fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  savedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  savedIcon: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  savedActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  clear: { marginTop: spacing.md, alignSelf: 'center' },
  clearText: { fontFamily: font.medium, fontSize: 12.5, color: colors.red },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, ...shadow.card,
  },
  pillOn: { backgroundColor: colors.greenSoft, borderColor: colors.green },
  pillText: { fontFamily: font.medium, fontSize: 13, color: colors.ink2 },
  pillTextOn: { fontFamily: font.semibold, color: colors.green },

  help: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginTop: spacing.xl, padding: spacing.lg, backgroundColor: colors.greenFaint, borderRadius: radius.lg },
});
