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
  Pressable,
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
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { fetchProducts, type Product } from '../../src/api/catalogue';
import { createReel, reelVideoType, uploadReelVideo, REELS_MOCK, type PickedVideo } from '../../src/api/reels';
import { reelKeys } from '../../src/reels/useReels';
import { Button } from '../../src/components/ui';
import { useApp } from '../../src/store';
import { colors, font, inr, radius, shadow, spacing } from '../../src/theme';
import { StripeLoader } from '../../src/ui';

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
      Alert.alert('Video type not supported', 'Please choose an MP4 or MOV video.');
      return;
    }
    if (a.fileSize && a.fileSize > DEFAULT_MAX_BYTES) {
      Alert.alert('Video too large', 'Please choose a video under 100 MB.');
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setVideo({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName, durationSec, fileSize: a.fileSize ?? null });
  };

  const pick = async () => {
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
  };

  const record = async () => {
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
  };

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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPhase('done');
    } catch (err) {
      cancelRef.current = null;
      setPhase('edit');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert('Upload failed', (err as Error)?.message || 'Please try again.');
    }
  };

  // ── done ──────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <View style={[s.doneWrap, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Stack.Screen options={{ title: 'Reel posted', headerBackVisible: false, gestureEnabled: false }} />
        <View style={s.doneBadge}>
          <Ionicons name="time-outline" size={40} color={colors.green} />
        </View>
        <Text style={s.doneTitle}>Under review</Text>
        <Text style={s.doneBody}>
          Thanks for sharing! Our team checks every reel before it goes live — usually within a day. You can see its
          status any time in Account → My reels.
        </Text>
        <Button label="See my reels" onPress={() => router.replace('/reels/mine')} full style={{ marginTop: spacing.xl }} />
        <Button label="Back to reels" variant="outline" onPress={() => router.back()} full style={{ marginTop: spacing.md }} />
      </View>
    );
  }

  const uploading = phase === 'uploading';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
        {REELS_MOCK && (
          <Text style={s.demoNote}>Demo mode: nothing is uploaded. Your video stays on this phone.</Text>
        )}

        {/* 1 — video */}
        <Text style={s.step}>1 · Your video</Text>
        {video ? (
          <View style={s.previewRow}>
            <View style={s.preview}>
              <Preview uri={video.uri} />
              <View style={s.duration}>
                <Text style={s.durationText}>{Math.round(video.durationSec)}s</Text>
              </View>
            </View>
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Text style={s.help}>Looks good! Vertical videos with the product clearly in view do best.</Text>
              <Button label="Change video" variant="outline" icon="swap-horizontal" onPress={pick} disabled={uploading} />
            </View>
          </View>
        ) : (
          <View style={s.pickRow}>
            <Pressable style={s.pickTile} onPress={record} accessibilityRole="button">
              <Ionicons name="videocam" size={28} color={colors.green} />
              <Text style={s.pickText}>Record</Text>
            </Pressable>
            <Pressable style={s.pickTile} onPress={pick} accessibilityRole="button">
              <Ionicons name="images" size={28} color={colors.green} />
              <Text style={s.pickText}>From gallery</Text>
            </Pressable>
          </View>
        )}
        <Text style={s.hint}>Up to {MAX_SECONDS} seconds, under 100 MB.</Text>

        {/* 2 — product */}
        <Text style={[s.step, { marginTop: spacing.xl }]}>2 · Tag the product</Text>
        {product ? (
          <View style={s.tagged}>
            <Image source={{ uri: product.image }} style={s.tagImg} contentFit="contain" />
            <View style={{ flex: 1 }}>
              <Text style={s.tagTitle} numberOfLines={2}>{product.name}</Text>
              <Text style={s.tagPrice}>{inr(product.price)}</Text>
            </View>
            {!uploading && (
              <Pressable onPress={() => setProduct(null)} hitSlop={10} accessibilityLabel="Remove product">
                <Ionicons name="close-circle" size={22} color={colors.muted} />
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View style={s.searchBox}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search Autobacs products"
                placeholderTextColor={colors.muted}
                style={s.searchInput}
                returnKeyType="search"
                autoCorrect={false}
              />
              {results.isFetching && <StripeLoader size="sm" />}
            </View>
            {search.length >= 2 && results.data && results.data.products.length === 0 && (
              <Text style={s.hint}>No products match “{search}”.</Text>
            )}
            {results.isError && <Text style={[s.hint, { color: colors.red }]}>Search failed. Check your connection.</Text>}
            {(results.data?.products ?? []).map((p) => (
              <Pressable
                key={p.id}
                style={({ pressed }) => [s.result, pressed && { backgroundColor: colors.greenFaint }]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setProduct(p);
                  setQuery('');
                }}
              >
                <Image source={{ uri: p.image }} style={s.resultImg} contentFit="contain" />
                <Text style={s.resultTitle} numberOfLines={2}>{p.name}</Text>
                <Text style={s.resultPrice}>{inr(p.price)}</Text>
              </Pressable>
            ))}
          </>
        )}

        {/* 3 — caption */}
        <Text style={[s.step, { marginTop: spacing.xl }]}>3 · Caption</Text>
        <TextInput
          value={caption}
          onChangeText={(t) => setCaption(t.slice(0, CAPTION_MAX))}
          placeholder="What do you love about it?"
          placeholderTextColor={colors.muted}
          style={s.caption}
          multiline
          editable={!uploading}
        />
        <Text style={[s.hint, { textAlign: 'right' }]}>{caption.length}/{CAPTION_MAX}</Text>
      </ScrollView>

      <View style={[s.bar, { paddingBottom: insets.bottom + spacing.md }]}>
        {uploading ? (
          <View>
            <View style={s.progressRow}>
              <Text style={s.progressLabel}>{progress < 1 ? 'Uploading your reel…' : 'Finishing up…'}</Text>
              <Text style={s.progressPct}>{Math.round(progress * 100)}%</Text>
            </View>
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.max(3, progress * 100)}%` }]} />
            </View>
          </View>
        ) : (
          <Button
            label={!video ? 'Add a video to continue' : !product ? 'Tag a product to continue' : 'Post for review'}
            icon="cloud-upload-outline"
            onPress={post}
            disabled={!canPost}
            full
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  demoNote: {
    fontFamily: font.medium, fontSize: 12.5, color: colors.ink2, backgroundColor: colors.goldSoft,
    padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.lg,
  },
  step: { fontFamily: font.semibold, fontSize: 15, color: colors.ink, marginBottom: spacing.sm },
  hint: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 6 },
  help: { fontFamily: font.regular, fontSize: 13, color: colors.ink2, lineHeight: 18 },

  pickRow: { flexDirection: 'row', gap: spacing.md },
  pickTile: {
    flex: 1, height: 120, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.green,
    backgroundColor: colors.greenFaint, alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  pickText: { fontFamily: font.bold, fontSize: 14, color: colors.green },

  previewRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  preview: { width: 110, height: 196, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.black },
  duration: { position: 'absolute', right: 6, bottom: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  durationText: { fontFamily: font.bold, fontSize: 11, color: colors.white },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.md, height: 46,
  },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 15, color: colors.ink },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  resultImg: { width: 44, height: 44, borderRadius: 6, backgroundColor: colors.white },
  resultTitle: { flex: 1, fontFamily: font.medium, fontSize: 13.5, color: colors.ink },
  resultPrice: { fontFamily: font.bold, fontSize: 13.5, color: colors.ink },

  tagged: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, padding: spacing.md,
    borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.green, ...shadow.card,
  },
  tagImg: { width: 52, height: 52, borderRadius: 8, backgroundColor: colors.white },
  tagTitle: { fontFamily: font.medium, fontSize: 14, color: colors.ink },
  tagPrice: { fontFamily: font.bold, fontSize: 14, color: colors.green, marginTop: 2 },

  caption: {
    minHeight: 96, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    padding: spacing.md, fontFamily: font.regular, fontSize: 15, color: colors.ink, textAlignVertical: 'top',
  },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card,
    borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: spacing.lg, paddingTop: spacing.md,
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  progressLabel: { fontFamily: font.medium, fontSize: 14, color: colors.ink },
  progressPct: { fontFamily: font.bold, fontSize: 14, color: colors.green },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.greenSoft, overflow: 'hidden', marginBottom: spacing.sm },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.green },

  doneWrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  doneBadge: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontFamily: font.heading, fontSize: 24, color: colors.ink, marginTop: spacing.lg },
  doneBody: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: colors.ink2, textAlign: 'center', marginTop: spacing.sm },
});
