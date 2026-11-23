/**
 * Add / edit a product. Shared by /listing/new and /listing/[id]/edit.
 *
 * Money: the supplier types their cost in rupees ex-GST; it is converted to
 * integer paise by digits (lib/money). The only figure shown back is what THEY
 * get — cost + GST on it. There is no selling price, margin or customer price
 * anywhere in this app, by design (docs/ADR-supplier-portal.md).
 *
 * Save order: words + money first (create, or update naming the rev we loaded
 * → the server refuses a stale edit), then removed photos, then each new photo,
 * then "send for check" if asked. If a photo fails, the product is already
 * saved; unsent photos stay on screen and a retry sends only what is missing.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { confirm } from '../lib/dialog';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage, type Availability, type Listing, type ListingInput, type LocalFile, type Spec } from '../api';
import { choosePhotoSource, pickPhoto } from '../lib/pickPhoto';
import { formatPaise, GST_RATES, paiseToInput, rupeesToPaise, supplierPayout } from '../lib/money';
import { colors, radius, spacing } from '../theme';
import { Banner, Button, Card, Chips, Field, Screen, Section, T } from '../ui';
import { AVAILABILITY } from './status';
import { refreshLists, storeListing } from './listingCache';

export const MAX_PHOTOS = 6;
const EDITABLE: Listing['status'][] = ['draft', 'changes_requested', 'live', 'withdrawn', 'rejected'];

type Photo = { kind: 'saved'; key: string; url: string | null } | { kind: 'local'; id: string; file: LocalFile };

type FormErrors = Partial<Record<'title' | 'cost' | 'dispatchDays' | 'photos' | 'fits', string>>;

export function ListingEditor({ initial }: { initial?: Listing }) {
  const qc = useQueryClient();
  const [listing, setListing] = useState<Listing | undefined>(initial);
  const [photos, setPhotos] = useState<Photo[]>(() => (initial?.images ?? []).map((i) => ({ kind: 'saved' as const, key: i.key, url: i.url })));
  const [title, setTitle] = useState(initial?.title ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [partNumber, setPartNumber] = useState(initial?.partNumber ?? '');
  const [fits, setFits] = useState(initial?.fits ?? '');
  const [categoryHint, setCategoryHint] = useState(initial?.categoryHint ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [specs, setSpecs] = useState<Spec[]>(initial?.specs?.length ? initial.specs : [{ label: '', value: '' }]);
  const [cost, setCost] = useState(initial ? paiseToInput(initial.costPaise) : '');
  const [gstPct, setGstPct] = useState<number>(initial?.gstPct ?? 18);
  const [dispatchDays, setDispatchDays] = useState(String(initial?.dispatchDays ?? 2));
  const [availability, setAvailability] = useState<Availability>(initial?.availability ?? 'in');
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState<null | 'save' | 'submit'>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const parsed = rupeesToPaise(cost);
  const payout = parsed.ok ? supplierPayout(parsed.paise, gstPct) : null;
  const status = listing?.status ?? 'draft';
  const isLive = status === 'live';
  const canEdit = EDITABLE.includes(status);

  const addPhotos = async () => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    const source = await choosePhotoSource();
    if (!source) return;
    const files = await pickPhoto(source, { multiple: room });
    setPhotos((p) => [...p, ...files.slice(0, room).map((file, i) => ({ kind: 'local' as const, id: `${Date.now()}-${i}`, file }))]);
  };

  const removePhoto = (idx: number) => setPhotos((p) => p.filter((_, i) => i !== idx));

  const validate = (forSubmit: boolean): ListingInput | null => {
    const e: FormErrors = {};
    if (title.trim().length < 3) e.title = 'Give the product a clear name';
    if (!parsed.ok) e.cost = parsed.error;
    const days = Number(dispatchDays);
    if (!/^\d{1,2}$/.test(dispatchDays) || days > 60) e.dispatchDays = 'Whole days, 0 to 60';
    if (forSubmit && photos.length === 0) e.photos = 'Add at least one photo before sending for check';
    if (forSubmit && fits.trim().length < 2) e.fits = 'Say which cars it fits (or "Universal")';
    setErrors(e);
    if (Object.keys(e).length || !parsed.ok) return null;
    return {
      title: title.trim(),
      brand: brand.trim(),
      partNumber: partNumber.trim(),
      description: description.trim(),
      fits: fits.trim(),
      categoryHint: categoryHint.trim(),
      specs: specs.map((s) => ({ label: s.label.trim(), value: s.value.trim() })).filter((s) => s.label && s.value),
      costPaise: parsed.paise,
      gstPct,
      availability,
      dispatchDays: days,
    };
  };

  const save = async (submit: boolean) => {
    const input = validate(submit);
    if (!input) return;
    setBusy(submit ? 'submit' : 'save');
    setFailure(null);
    try {
      // 1. Words + money. Update names the rev we loaded → a stale edit is refused (409 STALE).
      let current: Listing = listing ? await api.updateListing(listing.id, listing.rev, input) : await api.createListing(input);
      setListing(current);
      storeListing(qc, current);

      // 2. Photos the supplier removed.
      const keep = new Set(photos.flatMap((p) => (p.kind === 'saved' ? [p.key] : [])));
      for (const img of current.images) {
        if (!keep.has(img.key)) {
          current = await api.deleteListingPhoto(current.id, img.key);
          setListing(current);
        }
      }

      // 3. New photos, one by one; each success becomes a saved photo, so a
      //    retry after a failure sends only what is still missing.
      for (const p of photos) {
        if (p.kind !== 'local') continue;
        try {
          const before = new Set(current.images.map((i) => i.key));
          current = await api.uploadListingPhoto(current.id, p.file);
          setListing(current);
          const added = current.images.find((i) => !before.has(i.key));
          if (added) setPhotos((list) => list.map((x) => (x.kind === 'local' && x.id === p.id ? { kind: 'saved', key: added.key, url: added.url } : x)));
        } catch (err) {
          storeListing(qc, current);
          await refreshLists(qc);
          throw new ApiError(`Product saved, but a photo did not upload: ${errorMessage(err)} Tap save again to retry.`, err instanceof ApiError ? err.status : 0);
        }
      }

      // 4. Send for check, if asked.
      if (submit) current = await api.submitListing(current.id);
      storeListing(qc, current);
      await refreshLists(qc);
      router.dismissTo({ pathname: '/listing/[id]', params: { id: current.id } });
    } catch (err) {
      setFailure(
        err instanceof ApiError && err.code === 'STALE'
          ? 'This product was changed somewhere else. Close this screen and open it again to get the latest copy.'
          : errorMessage(err),
      );
    } finally {
      setBusy(null);
    }
  };

  if (!canEdit) {
    return (
      <Screen>
        <Banner tone="info" title="With procurement now">
          This product is waiting for a check, so it cannot change. Withdraw it on the product page if you need to edit.
        </Banner>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        isLive ? (
          <Button label="Save changes" icon="checkmark" onPress={() => void save(false)} loading={busy === 'save'} disabled={!!busy} />
        ) : (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Save draft" variant="outline" style={{ flex: 1 }} onPress={() => void save(false)} loading={busy === 'save'} disabled={!!busy} />
            <Button label="Send for check" style={{ flex: 1.3 }} onPress={() => void save(true)} loading={busy === 'submit'} disabled={!!busy} />
          </View>
        )
      }
    >
      {status === 'changes_requested' && listing?.reviewNote ? (
        <Banner tone="warn" title="Procurement asked for a fix">
          {listing.reviewNote}
        </Banner>
      ) : null}
      {isLive ? (
        <Banner tone="info" title="This product is live">
          A new cost goes to procurement for a check first. Until they approve it, the current listing stays as it is.
        </Banner>
      ) : null}
      {failure ? <Banner tone="error">{failure}</Banner> : null}

      <Section title="Photos" hint={`Up to ${MAX_PHOTOS}. First photo is the main one. Plain background, whole part visible.`}>
        <View style={styles.photos}>
          {photos.map((p, i) => (
            <View key={p.kind === 'saved' ? p.key : p.id} style={styles.photo}>
              {(p.kind === 'saved' ? p.url : p.file.uri) ? (
                <Image source={{ uri: p.kind === 'saved' ? p.url! : p.file.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Ionicons name="image-outline" size={22} color={colors.chrome} />
              )}
              {p.kind === 'local' ? (
                <View style={styles.pendingTag}>
                  <T kind="caption" style={{ color: colors.white, fontSize: 10 }}>
                    NEW
                  </T>
                </View>
              ) : null}
              <Pressable
                style={styles.remove}
                onPress={() =>
                  void confirm({ title: 'Remove this photo?', ok: 'Remove', destructive: true }).then((yes) => yes && removePhoto(i))
                }
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${i + 1}`}
              >
                <Ionicons name="close" size={14} color={colors.white} />
              </Pressable>
            </View>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <Pressable style={[styles.photo, styles.addPhoto]} onPress={() => void addPhotos()} accessibilityRole="button" accessibilityLabel="Add photos">
              <Ionicons name="camera-outline" size={24} color={colors.green} />
              <T kind="caption" style={{ color: colors.green, marginTop: 2 }}>
                Add
              </T>
            </Pressable>
          ) : null}
        </View>
        {errors.photos ? (
          <T kind="caption" style={{ color: colors.red, marginTop: spacing.sm }}>
            {errors.photos}
          </T>
        ) : null}
      </Section>

      <Section title="Product">
        <Field label="Product name" value={title} onChangeText={setTitle} error={errors.title} placeholder="LED headlamp bulb H4, 6000K (pair)" maxLength={200} />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Field label="Brand" value={brand} onChangeText={setBrand} containerStyle={{ flex: 1 }} maxLength={80} />
          <Field label="Part number" value={partNumber} onChangeText={setPartNumber} containerStyle={{ flex: 1 }} autoCapitalize="characters" maxLength={80} />
        </View>
        <Field label="Fits which cars" value={fits} onChangeText={setFits} error={errors.fits} placeholder="Creta 2020+, Seltos, or Universal" maxLength={500} />
        <Field label="Category (your best guess)" value={categoryHint} onChangeText={setCategoryHint} placeholder="Lighting, Brakes, Interior…" maxLength={80} />
        <Field label="Description" value={description} onChangeText={setDescription} multiline maxLength={4000} containerStyle={{ marginBottom: 0 }} />
      </Section>

      <Section title="Specs" hint="Size, colour, material, what is in the box…">
        {specs.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
            <Field label={i === 0 ? 'Name' : ' '} value={s.label} onChangeText={(v) => setSpecs((x) => x.map((y, j) => (j === i ? { ...y, label: v } : y)))} placeholder="Colour" containerStyle={{ flex: 1 }} maxLength={60} />
            <Field label={i === 0 ? 'Value' : ' '} value={s.value} onChangeText={(v) => setSpecs((x) => x.map((y, j) => (j === i ? { ...y, value: v } : y)))} placeholder="6000K white" containerStyle={{ flex: 1.4 }} maxLength={200} />
            <Pressable
              onPress={() => setSpecs((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : [{ label: '', value: '' }]))}
              style={{ marginTop: i === 0 ? 34 : 34, padding: 4 }}
              accessibilityLabel="Remove spec"
              hitSlop={6}
            >
              <Ionicons name="remove-circle-outline" size={22} color={colors.muted} />
            </Pressable>
          </View>
        ))}
        {specs.length < 30 ? <Button small variant="ghost" icon="add" label="Add a spec" onPress={() => setSpecs((x) => [...x, { label: '', value: '' }])} style={{ alignSelf: 'flex-start' }} /> : null}
      </Section>

      <Section title="Your cost" hint="What you want for ONE unit, before GST. This is what Autobacs pays you.">
        <Field label="Cost per unit (without GST)" value={cost} onChangeText={setCost} error={errors.cost} keyboardType="decimal-pad" prefix="₹" placeholder="1800" />
        <T kind="label" style={{ marginBottom: 8 }}>
          GST rate on this product
        </T>
        <Chips options={GST_RATES.map((r) => ({ value: r, label: `${r}%` }))} value={gstPct as (typeof GST_RATES)[number]} onChange={setGstPct} />
        <Card style={styles.payout}>
          {payout ? (
            <>
              <T kind="small">You get, per unit</T>
              <T kind="h1" style={{ color: colors.green }}>
                {formatPaise(payout.cost)} + GST
              </T>
              <T kind="small">
                GST {gstPct}% = {formatPaise(payout.gst)} · invoice total {formatPaise(payout.total)}
              </T>
            </>
          ) : (
            <T kind="small">Enter your cost to see what you get.</T>
          )}
        </Card>
      </Section>

      <Section title="Stock and dispatch">
        <T kind="label" style={{ marginBottom: 8 }}>
          Stock now
        </T>
        <Chips options={(['in', 'low', 'out'] as const).map((a) => ({ value: a, label: AVAILABILITY[a].label }))} value={availability} onChange={setAvailability} />
        <View style={{ height: spacing.lg }} />
        <Field
          label="Days to dispatch after an order"
          value={dispatchDays}
          onChangeText={(v) => setDispatchDays(v.replace(/\D/g, '').slice(0, 2))}
          error={errors.dispatchDays}
          keyboardType="number-pad"
          containerStyle={{ marginBottom: 0 }}
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photo: { width: 92, height: 92, borderRadius: radius.md, backgroundColor: colors.page, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  addPhoto: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.green, backgroundColor: colors.greenFaint },
  remove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center' },
  pendingTag: { position: 'absolute', left: 4, bottom: 4, backgroundColor: colors.green, borderRadius: 6, paddingHorizontal: 5 },
  payout: { marginTop: spacing.lg, backgroundColor: colors.greenFaint, borderColor: colors.greenSoft, gap: 2, padding: spacing.md },
});
