/**
 * In / Low / Out. NOT optimistic: the tapped option shows a spinner, and the
 * highlighted value changes only when the server confirms. On failure the old
 * value simply stays and the error is shown.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Availability, type Listing } from '../api';
import { colors, font, radius } from '../theme';
import { AVAILABILITY } from './status';
import { storeListing } from './listingCache';

const ORDER: Availability[] = ['in', 'low', 'out'];

export function StockToggle({ listing, disabled }: { listing: Listing; disabled?: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationKey: ['availability', listing.id],
    mutationFn: (a: Availability) => api.setAvailability(listing.id, a),
    onSuccess: (l) => storeListing(qc, l),
  });
  const pending = m.isPending ? m.variables : null;

  return (
    <View>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Stock">
        {ORDER.map((a) => {
          const on = listing.availability === a;
          const meta = AVAILABILITY[a];
          return (
            <Pressable
              key={a}
              disabled={disabled || m.isPending || on}
              onPress={() => m.mutate(a)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, busy: pending === a }}
              accessibilityLabel={meta.label}
              style={[styles.opt, on && { backgroundColor: meta.bg, borderColor: meta.fg }, disabled && { opacity: 0.5 }]}
              hitSlop={4}
            >
              {pending === a ? (
                <ActivityIndicator size="small" color={meta.fg} />
              ) : (
                <Text style={[styles.text, on && { color: meta.fg, fontFamily: font.bold }]}>{meta.short}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      {m.isError ? <Text style={styles.err}>{errorMessage(m.error)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  opt: { minWidth: 48, height: 34, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  text: { fontFamily: font.medium, fontSize: 13, color: colors.ink2 },
  err: { fontFamily: font.medium, fontSize: 12, color: colors.red, marginTop: 4 },
});
