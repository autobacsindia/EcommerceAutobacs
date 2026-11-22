/** Plain-words labels and colours for listing and account statuses. */
import { StyleSheet, Text, View } from 'react-native';
import type { Availability, ListingStatus } from '../api';
import { colors, font, radius } from '../theme';

export const LISTING_STATUS: Record<ListingStatus, { label: string; fg: string; bg: string; explain: string }> = {
  draft: { label: 'Draft', fg: colors.ink2, bg: colors.page, explain: 'Only you can see this. Send it for check when it is ready.' },
  submitted: { label: 'Waiting for check', fg: colors.blue, bg: colors.blueSoft, explain: 'Our procurement team is checking this product. You will see the result here.' },
  changes_requested: { label: 'Needs a fix', fg: colors.gold, bg: colors.goldSoft, explain: 'Procurement asked for a change. Read the note, edit, and send it again.' },
  live: { label: 'Live', fg: colors.green, bg: colors.greenSoft, explain: 'Customers can buy this on autobacsindia.com. Keep the stock status right.' },
  rejected: { label: 'Rejected', fg: colors.red, bg: colors.redSoft, explain: 'We cannot list this product. The note says why.' },
  withdrawn: { label: 'Withdrawn', fg: colors.muted, bg: colors.page, explain: 'You took this back. Edit it and send it for check again any time.' },
};

export const AVAILABILITY: Record<Availability, { label: string; short: string; fg: string; bg: string }> = {
  in: { label: 'In stock', short: 'In', fg: colors.green, bg: colors.greenSoft },
  low: { label: 'Low stock', short: 'Low', fg: colors.gold, bg: colors.goldSoft },
  out: { label: 'Out of stock', short: 'Out', fg: colors.red, bg: colors.redSoft },
};

export function StatusChip({ status }: { status: ListingStatus }) {
  const s = LISTING_STATUS[status];
  return (
    <View style={[styles.chip, { backgroundColor: s.bg }]}>
      <View style={[styles.dot, { backgroundColor: s.fg }]} />
      <Text style={[styles.text, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  text: { fontFamily: font.bold, fontSize: 12 },
});
