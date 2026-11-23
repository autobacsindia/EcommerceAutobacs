/** One product: status + what procurement said, photos, details, stock, actions. */
import { Dimensions, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Listing } from '../../../src/api';
import { listingKey, refreshLists, storeListing } from '../../../src/features/listingCache';
import { LISTING_STATUS, StatusChip } from '../../../src/features/status';
import { StockToggle } from '../../../src/features/StockToggle';
import { formatPaise, supplierPayout } from '../../../src/lib/money';
import { confirm } from '../../../src/lib/dialog';
import { colors, radius, spacing } from '../../../src/theme';
import { Banner, Button, Card, Divider, ErrorState, Loading, T } from '../../../src/ui';

const W = Math.min(Dimensions.get('window').width, 520);
const EDITABLE: Listing['status'][] = ['draft', 'changes_requested', 'live', 'withdrawn', 'rejected'];

export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: listingKey(id), queryFn: () => api.getListing(id) });

  const act = useMutation({
    mutationFn: (what: 'submit' | 'withdraw') => (what === 'submit' ? api.submitListing(id) : api.withdrawListing(id)),
    onSuccess: async (l) => {
      storeListing(qc, l);
      await refreshLists(qc);
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const l = q.data;
  const s = LISTING_STATUS[l.status];
  const payout = supplierPayout(l.costPaise, l.gstPct);
  const canEdit = EDITABLE.includes(l.status);
  const canSubmit = ['draft', 'changes_requested', 'withdrawn'].includes(l.status);
  const canWithdraw = ['submitted', 'live'].includes(l.status);

  const withdraw = async () => {
    const yes = await confirm({
      title: l.status === 'live' ? 'Take this product off sale?' : 'Withdraw from check?',
      message: l.status === 'live' ? 'Customers will no longer be able to buy it. You can send it for check again later.' : 'You can edit it and send it again.',
      ok: 'Withdraw',
      destructive: true,
    });
    if (yes) act.mutate('withdraw');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: s.label, headerRight: canEdit ? () => <Button small variant="ghost" label="Edit" onPress={() => router.push({ pathname: '/listing/[id]/edit', params: { id } })} /> : undefined }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.green} />}
      >
        {l.images.length ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {l.images.map((img) => (
              <View key={img.key} style={{ width: W, height: W * 0.75, backgroundColor: colors.white }}>
                {img.url ? <Image source={{ uri: img.url }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={[styles.noPhoto, { height: W * 0.5 }]}>
            <Ionicons name="image-outline" size={36} color={colors.chrome} />
            <T kind="small">No photos yet</T>
          </View>
        )}

        <View style={{ padding: spacing.lg }}>
          <StatusChip status={l.status} />
          <T kind="h1" style={{ marginTop: spacing.sm }}>
            {l.title}
          </T>
          <T kind="small" style={{ marginTop: 2 }}>
            {[l.brand, l.partNumber && `Part no. ${l.partNumber}`].filter(Boolean).join(' · ')}
          </T>

          <View style={{ height: spacing.lg }} />
          {l.reviewNote && ['changes_requested', 'rejected', 'submitted', 'live'].includes(l.status) ? (
            <Banner tone={l.status === 'rejected' ? 'error' : 'warn'} title="Note from procurement">
              {l.reviewNote}
            </Banner>
          ) : null}
          <Banner tone={l.status === 'live' ? 'success' : 'info'}>{s.explain}</Banner>
          {act.isError ? <Banner tone="error">{errorMessage(act.error)}</Banner> : null}

          <Card style={{ gap: 2 }}>
            <T kind="small">You get, per unit</T>
            <T kind="h1" style={{ color: colors.green }}>
              {formatPaise(payout.cost)} + GST
            </T>
            <T kind="small">
              GST {l.gstPct}% = {formatPaise(payout.gst)} · invoice total {formatPaise(payout.total)}
            </T>
          </Card>

          {l.status !== 'rejected' ? (
            <Card style={{ marginTop: spacing.md }}>
              <View style={styles.between}>
                <View>
                  <T kind="bodyBold">Stock</T>
                  <T kind="caption">Dispatch in {l.dispatchDays ?? '—'} day{l.dispatchDays === 1 ? '' : 's'}</T>
                </View>
                <StockToggle listing={l} />
              </View>
            </Card>
          ) : null}

          <Card style={{ marginTop: spacing.md }}>
            <Detail label="Fits" value={l.fits} />
            <Detail label="Category" value={l.categoryHint} />
            {l.specs.map((sp, i) => (
              <Detail key={`${sp.label}-${i}`} label={sp.label} value={sp.value} />
            ))}
            {l.description ? (
              <>
                <Divider />
                <T>{l.description}</T>
              </>
            ) : null}
          </Card>

          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            {canSubmit ? (
              <Button
                label="Send for check"
                icon="paper-plane-outline"
                onPress={() => act.mutate('submit')}
                loading={act.isPending && act.variables === 'submit'}
                disabled={act.isPending}
              />
            ) : null}
            {canEdit ? <Button label="Edit product" variant="outline" icon="create-outline" onPress={() => router.push({ pathname: '/listing/[id]/edit', params: { id } })} /> : null}
            {canWithdraw ? (
              <Button
                label={l.status === 'live' ? 'Take off sale' : 'Withdraw from check'}
                variant="danger"
                onPress={() => void withdraw()}
                loading={act.isPending && act.variables === 'withdraw'}
                disabled={act.isPending}
              />
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={styles.detail}>
      <T kind="small" style={{ width: 110 }}>
        {label}
      </T>
      <T style={{ flex: 1, color: colors.ink }}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  noPhoto: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.page, gap: 6 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' },
  detail: { flexDirection: 'row', paddingVertical: 6, borderRadius: radius.sm },
});
