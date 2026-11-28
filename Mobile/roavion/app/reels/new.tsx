/**
 * Post a reel: pick or record a video (max 60s), tag one product, write a
 * caption, upload straight to storage (a presigned R2 link from our API), then
 * register it with our API. It goes live only after the team approves it.
 *
 * Leaving mid-upload (back button, swipe, Android back) asks first.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useNavigation, useRouter, usePreventRemove } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { fetchProducts, type Product } from '../../src/api/catalogue';
import { createReel, reelVideoType, uploadReelVideo, REELS_MOCK, UNSUPPORTED_VIDEO_MESSAGE, type PickedVideo } from '../../src/api/reels';
import { pickerErrorText } from '../../src/reels/videoType';
import { reelKeys } from '../../src/reels/useReels';
import { ProgressRing } from '../../src/reels/ProgressRing';
import { useApp } from '../../src/store';
import { alpha, colors, elevation, font, palette, radius, spacing, type } from '../../src/theme';
import { GlassChip, Overline, PremiumButton, Price, PressScale, StripeLoader, Stripes, haptic } from '../../src/ui';

const MAX_SECONDS = 60;
/** Client-side guard only; the server's maxBytes (and its size check) is the real limit. */
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const CAPTION_MAX = 300;

type Picked = PickedVideo & { durationSec: number; fileSize: number | null };
type Phase = 'edit' | 'uploading' | 'done';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Preview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} surfaceType="textureView" />;
}

export default function NewReelScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { customer } = useApp();

  const [video, setVideo] = useState<Picked | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [query, setQuery] = useState('');
  const [caption, setCaption] = useState('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef<(() => void) | null>(null);

  const search = useDebounced(query.trim(), 300);
  const results = useQuery({
    queryKey: ['reel-tag-search', search],
    queryFn: ({ signal }) => fetchProducts({ search, limit: 8 }, signal),
    enabled: search.length >= 2 && !product,
  });

  // Signed out (e.g. session expired): send them to sign in, then back here.
  useEffect(() => {
    if (customer === null) router.replace('/login?next=/reels/new');
  }, [customer, router]);

  // Ask before abandoning an upload or a half-made reel.
  const dirty = phase === 'uploading' || (phase === 'edit' && (!!video || caption.length > 0));
  usePreventRemove(dirty, ({ data }) => {
    Alert.alert(
      phase === 'uploading' ? 'Cancel upload?' : 'Discard this reel?',
      phase === 'uploading' ? 'Your video is still uploading.' : 'Your video and caption will be lost.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            cancelRef.current?.();
            navigation.dispatch(data.action);
          },
        },
      ],
    );
  });

  const accept = (res: ImagePicker.ImagePickerResult) => {
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const durationSec = a.duration ? a.duration / 1000 : 0;
    if (durationSec > MAX_SECONDS + 0.5) {
      Alert.alert('Video too long', `Reels can be up to ${MAX_SECONDS} seconds. Please trim it and try again.`);
      return;
    }
    if (!reelVideoType(a)) {
      Alert.alert('Video not supported', UNSUPPORTED_VIDEO_MESSAGE);
      return;
    }
    if (a.fileSize && a.fileSize > DEFAULT_MAX_BYTES) {
      Alert.alert('Video too large', 'Please choose a video under 100 MB.');
      return;
    }
    haptic.selection();
    setVideo({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName, durationSec, fileSize: a.fileSize ?? null });
  };

  // Every picker/permission call can reject (export of an iCloud or HEVC clip fails,
  // the camera is busy, the OS kills the picker…). Catch it here and say so in plain
  // words: an un-awaited rejection from a button press is an uncaught error.
  const guarded = (run: () => Promise<void>) => async () => {
    try {
      await run();
    } catch (err) {
      haptic.error();
      Alert.alert("Couldn't use that video", pickerErrorText(err));
    }
  };

  const pick = guarded(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Allow access', 'Allow Autobacs to access your videos in Settings to post a reel.');
      return;
    }
    accept(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true, // iOS shows a trimmer
        videoMaxDuration: MAX_SECONDS,
        quality: 1,
        // The server only takes H.264 (plays on every phone without
        // transcoding). iOS hands back a compatible H.264 copy of an HEVC clip.
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1920x1080,
      }),
    );
  });

  const record = guarded(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Allow camera', 'Allow Autobacs to use the camera in Settings to record a reel.');
      return;
    }
    accept(
      await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: MAX_SECONDS,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1920x1080, // iOS: H.264, not HEVC
      }),
    );
  });

  const canPost = !!video && !!product && phase === 'edit';

  const post = async () => {
    if (!video || !product) return;
    setPhase('uploading');
    setProgress(0);
    try {
      // Asks our API for a presigned R2 link for this exact file, then sends the
      // video straight to storage. Length and codec are checked by the server.
      const up = uploadReelVideo(video, setProgress);
      cancelRef.current = up.cancel;
      const { publicId } = await up.promise;
      cancelRef.current = null;
      await createReel({ publicId, productId: product.id, caption: caption.trim() });
      qc.invalidateQueries({ queryKey: reelKeys.mine });
      // Success only once the server has the reel.
      haptic.success();
      setPhase('done');
    } catch (err) {
      cancelRef.current = null;
      setPhase('edit');
      const raw = (err as { message?: unknown } | null)?.message;
      const msg = typeof raw === 'string' && raw.trim() ? raw : 'Please try again.';
      // Cancelling on purpose needs no error dialog.
      if (msg === 'Upload cancelled.') return;
      haptic.error();
      Alert.alert('Upload failed', msg);
    }
  };

  // ── done ──────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <View style={[s.doneWrap, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Stack.Screen options={{ title: 'Reel posted', headerBackVisible: false, gestureEnabled: false }} />
        <ProgressRing progress={1} size={112} stroke={6}>
          <View style={s.doneDisc}>
            <Ionicons name="time-outline" size={38} color={colors.green} />
          </View>
        </ProgressRing>
        <Overline style={{ marginTop: spacing.xl }}>Submitted</Overline>
        <Text style={[type.display, s.centerText, { marginTop: spacing.xs }]}>Under review</Text>
        <Text style={[type.body, s.centerText, { marginTop: spacing.sm }]}>
          Thanks for sharing! Our team checks every reel before it goes live — usually within a day.
        </Text>

        <View style={s.timeline}>
          {[
            { label: 'Uploaded', state: 'done' as const },
            { label: 'Under review', state: 'now' as const },
            { label: 'Live in Reels', state: 'next' as const },
          ].map((step, i, all) => (
            <View key={step.label} style={s.tlItem}>
              <View style={s.tlTrack}>
                <View style={[s.tlDot, step.state === 'done' && s.tlDotDone, step.state === 'now' && s.tlDotNow]}>
                  {step.state === 'done' && <Ionicons name="checkmark" size={12} color={colors.white} />}
                </View>
                {i < all.length - 1 && <View style={[s.tlLine, step.state === 'done' && { backgroundColor: colors.green }]} />}
              </View>
              <Text style={[s.tlLabel, step.state === 'next' && { color: colors.muted }]}>{step.label}</Text>
            </View>
          ))}
        </View>

        <PremiumButton label="See my reels" iconRight="arrow-forward" onPress={() => router.replace('/reels/mine')} full style={{ marginTop: spacing.xl }} />
        <PremiumButton label="Back to reels" variant="ghost" onPress={() => router.back()} full style={{ marginTop: spacing.xs }} />
      </View>
    );
  }

  // ── uploading ─────────────────────────────────────────────────────────────
  if (phase === 'uploading') {
    const pct = Math.round(progress * 100);
    return (
      <View style={[s.doneWrap, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Stack.Screen options={{ title: 'Uploading', gestureEnabled: false }} />
        <ProgressRing progress={progress} size={168} stroke={8}>
          <View style={s.ringInner}>
            {video && <Preview uri={video.uri} />}
            <View style={s.ringShade} />
            <Text style={s.ringPct}>{pct}%</Text>
          </View>
        </ProgressRing>
        <Text style={[type.h1, s.centerText, { marginTop: spacing.xl }]}>
          {progress < 1 ? 'Uploading your reel' : 'Finishing up'}
        </Text>
        <Text style={[type.small, s.centerText, { marginTop: spacing.xs }]}>
          Keep the app open — this usually takes under a minute.
        </Text>
        {product && (
          <View style={[s.tagged, { marginTop: spacing.xl, alignSelf: 'stretch' }]}>
            <Image source={{ uri: product.image }} style={s.tagImg} contentFit="contain" />
            <View style={{ flex: 1 }}>
              <Text style={s.tagOver}>Tagged product</Text>
              <Text style={s.tagTitle} numberOfLines={1}>{product.name}</Text>
            </View>
          </View>
        )}
        <PremiumButton
          label="Cancel upload"
          variant="ghost"
          size="sm"
          onPress={() => cancelRef.current?.()}
          disabled={progress >= 1}
          style={{ marginTop: spacing.lg }}
        />
      </View>
    );
  }

  const steps = [!!video, !!product, caption.trim().length > 0];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
        {REELS_MOCK && (
          <View style={s.demoNote}>
            <Ionicons name="information-circle" size={16} color={colors.ink2} />
            <Text style={s.demoText}>Demo mode: nothing is uploaded. Your video stays on this phone.</Text>
          </View>
        )}

        {/* 1 — video */}
        <StepHead n={1} title="Your video" done={steps[0]} />
        {video ? (
          <View style={s.previewRow}>
            <View style={s.preview}>
              <Preview uri={video.uri} />
              <GlassChip icon="time-outline" label={`${Math.round(video.durationSec)}s`} style={s.duration} />
            </View>
            <View style={{ flex: 1, gap: spacing.md }}>
              <View style={s.tip}>
                <Ionicons name="sparkles-outline" size={16} color={colors.green} />
                <Text style={s.help}>Looks good! Vertical videos with the product clearly in view do best.</Text>
              </View>
              <PremiumButton label="Change video" variant="outline" size="sm" icon="swap-horizontal" onPress={pick} />
            </View>
          </View>
        ) : (
          <View style={s.pickHero}>
            <Stripes width={16} height={5} gap={4} onDark />
            <Text style={s.pickTitle}>Show off the gear on your car</Text>
            <Text style={s.pickBody}>Up to {MAX_SECONDS} seconds · under 100 MB · MP4, MOV or 3GP</Text>
            <View style={s.pickRow}>
              <PremiumButton label="Record" icon="videocam" variant="green" onPress={record} style={{ flex: 1 }} />
              <PremiumButton label="Gallery" icon="images-outline" variant="light" onPress={pick} style={{ flex: 1 }} />
            </View>
          </View>
        )}

        {/* 2 — product */}
        <StepHead n={2} title="Tag the product" done={steps[1]} />
        {product ? (
          <View style={s.tagged}>
            <Image source={{ uri: product.image }} style={s.tagImg} contentFit="contain" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.tagTitle} numberOfLines={2}>{product.name}</Text>
              <Price price={product.price} mrp={product.mrp} offPercent={product.discountPercent} size="sm" />
            </View>
            <PressScale onPress={() => setProduct(null)} hitSlop={10} haptic="selection" accessibilityLabel="Remove product">
              <Ionicons name="close-circle" size={24} color={colors.chrome} />
            </PressScale>
          </View>
        ) : (
          <>
            <View style={s.searchBox}>
              <Ionicons name="search" size={18} color={colors.steel} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search Autobacs products"
                placeholderTextColor={colors.steel}
                style={s.searchInput}
                returnKeyType="search"
                autoCorrect={false}
              />
              {results.isFetching && <StripeLoader size="sm" label="Searching" />}
            </View>
            {search.length < 2 && <Text style={s.hint}>Type at least 2 letters — e.g. “wiper” or “seat cover”.</Text>}
            {search.length >= 2 && results.data && results.data.products.length === 0 && (
              <Text style={s.hint}>No products match “{search}”.</Text>
            )}
            {results.isError && <Text style={[s.hint, { color: colors.red }]}>Search failed. Check your connection.</Text>}
            {(results.data?.products ?? []).length > 0 && (
              <View style={s.results}>
                {(results.data?.products ?? []).map((p, i) => (
                  <PressScale
                    key={p.id}
                    haptic="selection"
                    scaleTo={0.98}
                    style={[s.result, i > 0 && s.resultDivider]}
                    onPress={() => {
                      setProduct(p);
                      setQuery('');
                    }}
                    accessibilityLabel={`Tag ${p.name}`}
                  >
                    <Image source={{ uri: p.image }} style={s.resultImg} contentFit="contain" />
                    <Text style={s.resultTitle} numberOfLines={2}>{p.name}</Text>
                    <Price price={p.price} size="sm" hideOff />
                  </PressScale>
                ))}
              </View>
            )}
          </>
        )}

        {/* 3 — caption */}
        <StepHead n={3} title="Caption" done={steps[2]} optional />
        <TextInput
          value={caption}
          onChangeText={(t) => setCaption(t.slice(0, CAPTION_MAX))}
          placeholder="What do you love about it?"
          placeholderTextColor={colors.steel}
          style={s.caption}
          multiline
        />
        <Text style={[s.hint, { textAlign: 'right' }]}>{caption.length}/{CAPTION_MAX}</Text>
      </ScrollView>

      <View style={[s.bar, { paddingBottom: insets.bottom + spacing.md }]}>
        <PremiumButton
          label={!video ? 'Add a video to continue' : !product ? 'Tag a product to continue' : 'Post for review'}
          icon={canPost ? 'arrow-up-circle-outline' : undefined}
          onPress={post}
          disabled={!canPost}
          full
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function StepHead({ n, title, done, optional }: { n: number; title: string; done: boolean; optional?: boolean }) {
  return (
    <View style={s.stepHead}>
      <View style={[s.stepNum, done && s.stepNumDone]}>
        {done ? <Ionicons name="checkmark" size={14} color={colors.white} /> : <Text style={s.stepNumText}>{n}</Text>}
      </View>
      <View>
        <Overline>{`Step ${n} of 3${optional ? ' · optional' : ''}`}</Overline>
        <Text style={type.h2}>{title}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  demoNote: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.goldSoft, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm,
  },
  demoText: { flex: 1, fontFamily: font.medium, fontSize: 12.5, color: colors.ink2 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, marginBottom: spacing.md },
  stepNum: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.chrome,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white,
  },
  stepNumDone: { backgroundColor: colors.green, borderColor: colors.green },
  stepNumText: { fontFamily: font.heading, fontSize: 13, color: colors.ink2 },
  hint: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: spacing.sm },
  help: { flex: 1, fontFamily: font.regular, fontSize: 13, color: colors.ink2, lineHeight: 18 },
  tip: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.greenFaint, borderRadius: radius.md, padding: spacing.md },

  pickHero: {
    backgroundColor: colors.carbon, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.sm, overflow: 'hidden', ...elevation.e2,
  },
  pickTitle: { fontFamily: font.heading, fontSize: 20, lineHeight: 26, color: colors.white, marginTop: spacing.sm },
  pickBody: { fontFamily: font.regular, fontSize: 13, color: colors.onDarkMuted },
  pickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },

  previewRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  preview: { width: 124, height: 220, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.carbon, ...elevation.e2 },
  duration: { position: 'absolute', left: 8, bottom: 8 },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.lg, height: 50, ...elevation.e1,
  },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 15, color: colors.ink },
  results: { marginTop: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  result: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  resultDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  resultImg: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.white },
  resultTitle: { flex: 1, fontFamily: font.medium, fontSize: 13.5, lineHeight: 18, color: colors.ink },

  tagged: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, padding: spacing.md,
    borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.green, ...elevation.e1,
  },
  tagImg: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.white },
  tagOver: { fontFamily: font.medium, fontSize: 11.5, color: colors.muted },
  tagTitle: { fontFamily: font.semibold, fontSize: 14, lineHeight: 19, color: colors.ink },

  caption: {
    minHeight: 110, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line,
    padding: spacing.lg, fontFamily: font.regular, fontSize: 15, lineHeight: 21, color: colors.ink, textAlignVertical: 'top',
  },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingHorizontal: spacing.lg, paddingTop: spacing.md, ...elevation.e3,
  },

  doneWrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  doneDisc: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center', maxWidth: 320 },
  ringInner: { width: 144, height: 144, borderRadius: 72, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.carbon },
  ringShade: { ...StyleSheet.absoluteFill, backgroundColor: alpha(palette.ink, 0.45) },
  ringPct: { fontFamily: font.extrabold, fontSize: 30, color: colors.white },

  timeline: { flexDirection: 'row', marginTop: spacing.xl, alignSelf: 'stretch', justifyContent: 'space-between' },
  tlItem: { flex: 1, alignItems: 'center' },
  tlTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' },
  tlDot: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.chrome, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  tlDotDone: { backgroundColor: colors.green, borderColor: colors.green },
  tlDotNow: { borderColor: colors.green, borderWidth: 6 },
  tlLine: { position: 'absolute', left: '50%', right: '-50%', height: 2, backgroundColor: colors.line },
  tlLabel: { fontFamily: font.medium, fontSize: 12, color: colors.ink2, marginTop: spacing.sm, textAlign: 'center' },
});
