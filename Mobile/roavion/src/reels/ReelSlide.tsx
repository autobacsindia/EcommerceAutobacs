/**
 * One full-screen reel: video (or its poster while loading), gradient scrims so
 * white text stays readable over any footage, the right-hand action rail, the
 * caption and the shoppable product card.
 *
 * Gestures: single tap pauses/resumes, double tap likes (with a heart burst).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEvent } from 'expo';
import { VideoView, type VideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import type { Reel } from '../api/reels';
import type { SlotState } from './usePlayerPool';
import { ReelProductCard } from './ReelProductCard';
import { colors, font, spacing } from '../theme';

const DOUBLE_TAP_MS = 260;

function compact(n: number): string {
  if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(n >= 10_00_000 ? 0 : 1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

/** Thin progress line, subscribed only on the active reel. */
function Progress({ player }: { player: VideoPlayer }) {
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const pct = player.duration > 0 ? Math.min(1, currentTime / player.duration) : 0;
  return (
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

function RailButton({
  icon,
  label,
  onPress,
  color = colors.white,
  a11y,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  color?: string;
  a11y: string;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [s.rail, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel={a11y}>
      <Ionicons name={icon} size={30} color={color} style={s.iconShadow} />
      {label != null && <Text style={s.railText}>{label}</Text>}
    </Pressable>
  );
}

export interface ReelSlideProps {
  reel: Reel;
  height: number;
  active: boolean;
  /** The player for this reel's slot — null when its slot holds another reel. */
  player: VideoPlayer | null;
  slot: SlotState | null;
  paused: boolean;
  muted: boolean;
  bottomInset: number;
  busy: 'add' | 'buy' | null;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onLike: (reel: Reel, forceOn?: boolean) => void;
  onShare: (reel: Reel) => void;
  onReport: (reel: Reel) => void;
  onOpenProduct: (reel: Reel) => void;
  onAdd: (reel: Reel) => void;
  onBuy: (reel: Reel) => void;
  onRetry: () => void;
}

function ReelSlideImpl(props: ReelSlideProps) {
  const { reel, height, active, player, slot, paused, muted, bottomInset, busy } = props;
  const [expanded, setExpanded] = useState(false);
  const [heart] = useState(() => new Animated.Value(0));
  const [pauseIcon] = useState(() => new Animated.Value(0));
  const lastTap = useRef(0);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (singleTimer.current) clearTimeout(singleTimer.current);
  }, []);

  // Fade the big play icon in when paused, out when playing.
  useEffect(() => {
    Animated.timing(pauseIcon, { toValue: active && paused ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [active, paused, pauseIcon]);

  const ready = !!slot?.ready && slot.reelId === reel.id;
  const failed = !!slot?.error && slot.reelId === reel.id;
  const showVideo = !!player && slot?.reelId === reel.id;
  const buffering = active && !paused && showVideo && !failed && (!ready || !slot?.playing);

  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      // Double tap → like, never unlike (Instagram's convention).
      if (singleTimer.current) clearTimeout(singleTimer.current);
      singleTimer.current = null;
      lastTap.current = 0;
      props.onLike(reel, true);
      heart.setValue(0);
      Animated.sequence([
        Animated.spring(heart, { toValue: 1, useNativeDriver: true, friction: 4, tension: 120 }),
        Animated.timing(heart, { toValue: 0, duration: 260, delay: 260, useNativeDriver: true }),
      ]).start();
      return;
    }
    lastTap.current = now;
    singleTimer.current = setTimeout(() => {
      singleTimer.current = null;
      props.onTogglePause();
    }, DOUBLE_TAP_MS);
  };

  return (
    <View style={[s.page, { height }]}>
      {/* Poster first: it's what shows until the first video frame is ready. */}
      {reel.posterUrl ? (
        <Image source={{ uri: reel.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} cachePolicy="memory-disk" />
      ) : null}
      {showVideo && player && (
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
          // TextureView lets the video sit under RN views without z-order bugs on Android.
          surfaceType="textureView"
        />
      )}

      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} accessibilityRole="button" accessibilityLabel={paused ? 'Play' : 'Pause'} />

      {/* Scrims: keep captions readable over bright footage. */}
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={s.scrimTop} />
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.85)']} locations={[0, 0.35, 1]} style={s.scrimBottom} />

      {buffering && (
        <View pointerEvents="none" style={s.center}>
          <ActivityIndicator color={colors.white} size="large" />
        </View>
      )}

      {failed && (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.white} />
          <Text style={s.failText}>This video couldn&apos;t load</Text>
          <Pressable onPress={props.onRetry} style={s.retry} accessibilityRole="button">
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      <Animated.View pointerEvents="none" style={[s.center, { opacity: pauseIcon, transform: [{ scale: pauseIcon.interpolate({ inputRange: [0, 1], outputRange: [1.3, 1] }) }] }]}>
        <View style={s.playDisc}>
          <Ionicons name="play" size={38} color={colors.white} style={{ marginLeft: 4 }} />
        </View>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[s.center, { opacity: heart, transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}
      >
        <Ionicons name="heart" size={110} color="#ff3b5c" style={s.iconShadow} />
      </Animated.View>

      {/* Right rail */}
      <View style={[s.railCol, { bottom: bottomInset + 214 }]}>
        <View style={s.avatar}>
          {reel.creator.avatarUrl ? (
            <Image source={{ uri: reel.creator.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Text style={s.avatarText}>{reel.creator.name.slice(0, 1).toUpperCase() || 'R'}</Text>
          )}
        </View>
        <RailButton
          icon={reel.viewerLiked ? 'heart' : 'heart-outline'}
          color={reel.viewerLiked ? '#ff3b5c' : colors.white}
          label={compact(reel.likeCount)}
          onPress={() => props.onLike(reel)}
          a11y={reel.viewerLiked ? 'Unlike' : 'Like'}
        />
        <RailButton icon="paper-plane-outline" label="Share" onPress={() => props.onShare(reel)} a11y="Share" />
        <RailButton icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Muted' : 'Sound'} onPress={props.onToggleMute} a11y={muted ? 'Unmute' : 'Mute'} />
        <RailButton icon="flag-outline" onPress={() => props.onReport(reel)} a11y="Report this reel" />
      </View>

      {/* Caption + product */}
      <View style={[s.bottom, { paddingBottom: bottomInset + spacing.md }]}>
        <View style={s.creatorRow}>
          <Text style={s.creator} numberOfLines={1}>@{reel.creator.name}</Text>
        </View>
        {!!reel.caption && (
          <Pressable onPress={() => setExpanded((e) => !e)} style={{ marginRight: 64 }}>
            <Text style={s.caption} numberOfLines={expanded ? 6 : 2}>{reel.caption}</Text>
          </Pressable>
        )}
        {reel.product && (
          <View style={{ marginTop: spacing.md }}>
            <ReelProductCard
              product={reel.product}
              busy={busy}
              onOpen={() => props.onOpenProduct(reel)}
              onAdd={() => props.onAdd(reel)}
              onBuy={() => props.onBuy(reel)}
            />
          </View>
        )}
      </View>

      {active && showVideo && player && (
        <View style={[s.progressWrap, { bottom: bottomInset }]} pointerEvents="none">
          <Progress player={player} />
        </View>
      )}
    </View>
  );
}

export const ReelSlide = memo(ReelSlideImpl);

const s = StyleSheet.create({
  page: { width: '100%', backgroundColor: colors.black, overflow: 'hidden' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playDisc: {
    width: 78, height: 78, borderRadius: 39, backgroundColor: 'rgba(0,0,0,0.38)',
    alignItems: 'center', justifyContent: 'center',
  },
  failText: { fontFamily: font.medium, fontSize: 14, color: colors.white, marginTop: spacing.sm },
  retry: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)' },
  retryText: { fontFamily: font.bold, fontSize: 14, color: colors.white },
  iconShadow: { textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },

  railCol: { position: 'absolute', right: spacing.sm, alignItems: 'center', gap: spacing.lg },
  rail: { alignItems: 'center', minWidth: 52 },
  railText: { fontFamily: font.bold, fontSize: 12, color: colors.white, marginTop: 2, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.white, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarText: { fontFamily: font.heading, fontSize: 18, color: colors.white },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md },
  creatorRow: { flexDirection: 'row', alignItems: 'center', marginRight: 64 },
  creator: { fontFamily: font.bold, fontSize: 15, color: colors.white, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  caption: { fontFamily: font.regular, fontSize: 14, lineHeight: 19, color: 'rgba(255,255,255,0.92)', marginTop: 4 },

  progressWrap: { position: 'absolute', left: 0, right: 0 },
  progressTrack: { height: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  progressFill: { height: 2, backgroundColor: colors.white },
});
