/**
 * One full-screen reel.
 *
 * Layers, back to front: carbon base → poster (fades in, blurred until the
 * video is ready on iOS) → video (cross-fades in over the poster) → tap layer
 * → scrims → top progress bar, product pin, state glyphs (play / mute /
 * buffering / failed), heart burst → creator, caption, action rail and the
 * frosted product card.
 *
 * Gestures: single tap pauses/resumes, double tap likes with a heart burst
 * where the finger landed (never unlikes — Instagram's convention).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useEvent } from 'expo';
import { VideoView, type VideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import type { Reel } from '../api/reels';
import type { SlotState } from './usePlayerPool';
import { ReelProductCard } from './ReelProductCard';
import { useFollowing, useSaved } from './localPrefs';
import { alpha, colors, font, palette, radius, spacing } from '../theme';
import { GlassChip, PressScale, StripeLoader, haptic, useReduceMotion } from '../ui';

const DOUBLE_TAP_MS = 260;
const BURST = 6;

function compact(n: number): string {
  if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(n >= 10_00_000 ? 0 : 1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

/**
 * Top progress bar, subscribed only on the active reel. Each 0.25s time update
 * glides (native driver) so it reads as continuous, not stepped.
 */
function Progress({ player, width }: { player: VideoPlayer; width: number }) {
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const [x] = useState(() => new Animated.Value(0));
  const pct = player.duration > 0 ? Math.min(1, currentTime / player.duration) : 0;
  const last = useRef(0);
  useEffect(() => {
    // Looping back to the start jumps instead of sliding backwards.
    if (pct < last.current) x.setValue(pct);
    else Animated.timing(x, { toValue: pct, duration: 250, easing: Easing.linear, useNativeDriver: true }).start();
    last.current = pct;
  }, [pct, x]);
  return (
    <View style={s.progressTrack}>
      <Animated.View
        style={[s.progressFill, { width, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] }]}
      />
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
    <PressScale onPress={onPress} hitSlop={8} scaleTo={0.86} haptic="selection" style={s.rail} accessibilityRole="button" accessibilityLabel={a11y}>
      <Ionicons name={icon} size={29} color={color} style={s.iconShadow} />
      {label != null && <Text style={s.railText}>{label}</Text>}
    </PressScale>
  );
}

/** A big heart + small hearts flying out, at the tap point. */
function HeartBurst({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const reduce = useReduceMotion();
  const [t] = useState(() => new Animated.Value(0));
  // Runs once per burst; the parent's onDone identity changes every render.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const anim = Animated.timing(t, { toValue: 1, duration: reduce ? 500 : 900, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start(() => done.current());
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const big = {
    opacity: t.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] }),
    transform: [
      { translateY: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, -6, -40] }) },
      { scale: reduce ? 1 : t.interpolate({ inputRange: [0, 0.18, 0.3, 1], outputRange: [0.3, 1.25, 1, 1] }) },
      { rotate: t.interpolate({ inputRange: [0, 0.18, 0.3], outputRange: ['-14deg', '6deg', '0deg'] }) },
    ],
  };
  return (
    <View pointerEvents="none" style={[s.burst, { left: x - 60, top: y - 60 }]}>
      {!reduce &&
        Array.from({ length: BURST }).map((_, i) => {
          const a = (i / BURST) * Math.PI * 2 - Math.PI / 2;
          const d = 70 + (i % 2) * 18;
          return (
            <Animated.View
              key={i}
              style={[
                s.burstCenter,
                {
                  opacity: t.interpolate({ inputRange: [0, 0.15, 0.6, 1], outputRange: [0, 1, 0.8, 0] }),
                  transform: [
                    { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * d] }) },
                    { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * d] }) },
                    { scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 1, 0.6] }) },
                  ],
                },
              ]}
            >
              <Ionicons name="heart" size={i % 2 ? 16 : 22} color={i % 3 === 0 ? colors.white : colors.red} />
            </Animated.View>
          );
        })}
      <Animated.View style={[s.burstCenter, big]}>
        <Ionicons name="heart" size={104} color={colors.red} style={s.iconShadow} />
      </Animated.View>
    </View>
  );
}

/** Team uploads (no named creator) wear the round Autobacs badge. */
const TEAM_BADGE = require('../../assets/icon.png');

function Avatar({ reel }: { reel: Reel }) {
  const team = reel.creator.id == null;
  return (
    <View style={s.avatarRing}>
      <View style={s.avatar}>
        {team && !reel.creator.avatarUrl ? (
          <Image source={TEAM_BADGE} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Autobacs India" />
        ) : reel.creator.avatarUrl ? (
          <Image source={{ uri: reel.creator.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <Text style={s.avatarText}>{reel.creator.name.slice(0, 1).toUpperCase() || 'A'}</Text>
        )}
      </View>
    </View>
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
  /** Safe-area top: the progress bar sits just under the status bar. */
  topInset: number;
  bottomInset: number;
  busy: 'add' | 'buy' | null;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onLike: (reel: Reel, forceOn?: boolean) => void;
  onSave: (reel: Reel) => void;
  onFollow: (reel: Reel) => void;
  onShare: (reel: Reel) => void;
  onReport: (reel: Reel) => void;
  onOpenProduct: (reel: Reel) => void;
  onAdd: (reel: Reel) => void;
  onBuy: (reel: Reel) => void;
  onRetry: () => void;
}

function ReelSlideImpl(props: ReelSlideProps) {
  const { reel, height, active, player, slot, paused, muted, topInset, bottomInset, busy } = props;
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const saved = useSaved(reel.id);
  const following = useFollowing(reel.creator.id);
  const [expanded, setExpanded] = useState(false);
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [pauseIcon] = useState(() => new Animated.Value(0));
  const [muteFlash] = useState(() => new Animated.Value(0));
  const [videoIn] = useState(() => new Animated.Value(0));
  const [pin] = useState(() => new Animated.Value(0));
  const lastTap = useRef(0);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstId = useRef(0);

  useEffect(() => () => {
    if (singleTimer.current) clearTimeout(singleTimer.current);
  }, []);

  const ready = !!slot?.ready && slot.reelId === reel.id;
  const failed = !!slot?.error && slot.reelId === reel.id;
  const showVideo = !!player && slot?.reelId === reel.id;
  const buffering = active && !paused && showVideo && !failed && (!ready || !slot?.playing);

  // Cross-fade the video over the poster once its first frame is ready.
  useEffect(() => {
    if (ready) Animated.timing(videoIn, { toValue: 1, duration: reduce ? 0 : 280, useNativeDriver: true }).start();
    else videoIn.setValue(0);
  }, [ready, videoIn, reduce]);

  // Big play glyph while paused.
  useEffect(() => {
    Animated.timing(pauseIcon, { toValue: active && paused ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [active, paused, pauseIcon]);

  // Brief mute/unmute glyph when sound is toggled on the visible reel.
  const firstMute = useRef(true);
  useEffect(() => {
    if (firstMute.current) {
      firstMute.current = false;
      return;
    }
    if (!active) return;
    muteFlash.setValue(1);
    Animated.timing(muteFlash, { toValue: 0, duration: 700, delay: 350, useNativeDriver: true }).start();
  }, [muted, active, muteFlash]);

  // Product pin slides in a moment after the reel becomes active.
  useEffect(() => {
    if (active) Animated.timing(pin, { toValue: 1, duration: reduce ? 0 : 380, delay: reduce ? 0 : 900, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
    else pin.setValue(0);
  }, [active, pin, reduce]);

  const onTap = (e: GestureResponderEvent) => {
    const now = Date.now();
    // The reel page fills the window from its top-left while it is on screen,
    // so window coordinates are page coordinates. Some platforms (web) leave
    // them out — then the burst plays in the middle.
    const ne = e.nativeEvent as { pageX?: number; pageY?: number; locationX?: number; locationY?: number };
    const num = (...v: (number | undefined)[]) => v.find((n): n is number => typeof n === 'number' && Number.isFinite(n));
    const locationX = num(ne.pageX, ne.locationX) ?? width / 2;
    const locationY = num(ne.pageY, ne.locationY) ?? height / 2;
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      if (singleTimer.current) clearTimeout(singleTimer.current);
      singleTimer.current = null;
      lastTap.current = 0;
      haptic.medium();
      props.onLike(reel, true);
      const id = ++burstId.current;
      setBursts((b) => [...b.slice(-2), { id, x: locationX, y: locationY }]);
      return;
    }
    lastTap.current = now;
    singleTimer.current = setTimeout(() => {
      singleTimer.current = null;
      props.onTogglePause();
    }, DOUBLE_TAP_MS);
  };

  const team = reel.creator.id == null;

  return (
    <View style={[s.page, { height }]}>
      {/* Poster first — what shows until the first video frame is ready. */}
      {reel.posterUrl ? (
        <Image
          source={{ uri: reel.posterUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={{ duration: 300, effect: 'cross-dissolve' }}
          cachePolicy="memory-disk"
          recyclingKey={reel.id}
        />
      ) : null}
      {/* Blur-up: the poster stays soft while the video buffers, then the video sharpens it away. */}
      {!ready && !failed && Platform.OS === 'ios' && (
        <BlurView pointerEvents="none" intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
      )}
      {showVideo && player && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: videoIn }]} pointerEvents="none">
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
            allowsPictureInPicture={false}
            // TextureView lets the video sit under RN views without z-order bugs on Android.
            surfaceType="textureView"
          />
        </Animated.View>
      )}

      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} accessibilityRole="button" accessibilityLabel={paused ? 'Play' : 'Pause'} accessibilityHint="Double tap to like" />

      {/* Scrims keep white text readable over any footage. */}
      <LinearGradient pointerEvents="none" colors={[alpha(palette.black, 0.5), alpha(palette.black, 0)]} style={s.scrimTop} />
      <LinearGradient
        pointerEvents="none"
        colors={[alpha(palette.black, 0), alpha(palette.black, 0.3), alpha(palette.black, 0.82)]}
        locations={[0, 0.35, 1]}
        style={s.scrimBottom}
      />

      {active && showVideo && player && (
        <View style={[s.progressWrap, { top: topInset + 2 }]} pointerEvents="none">
          <Progress player={player} width={width - spacing.lg * 2} />
        </View>
      )}

      {/* Product pin on the video. */}
      {reel.product && !expanded && (
        <Animated.View
          style={[
            s.pin,
            { top: Math.round(height * 0.36), opacity: pin, transform: [{ translateX: pin.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] },
          ]}
          pointerEvents={active ? 'box-none' : 'none'}
        >
          <View style={s.pinDot} />
          <GlassChip
            icon="pricetag"
            label={reel.product.title.length > 26 ? `${reel.product.title.slice(0, 25).trim()}…` : reel.product.title}
            action="Shop"
            onPress={() => props.onOpenProduct(reel)}
          />
        </Animated.View>
      )}

      {buffering && (
        <View pointerEvents="none" style={s.center}>
          <StripeLoader size="lg" onDark label="Loading video" />
        </View>
      )}

      {failed && (
        <View style={s.center} pointerEvents="box-none">
          <View style={s.failCard}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.white} />
            <Text style={s.failText}>This video couldn&apos;t load</Text>
            <PressScale onPress={props.onRetry} haptic="light" style={s.retry} accessibilityLabel="Try again">
              <Ionicons name="refresh" size={15} color={colors.ink} />
              <Text style={s.retryText}>Try again</Text>
            </PressScale>
          </View>
        </View>
      )}

      <Animated.View
        pointerEvents="none"
        style={[s.center, { opacity: pauseIcon, transform: [{ scale: pauseIcon.interpolate({ inputRange: [0, 1], outputRange: [1.35, 1] }) }] }]}
      >
        <View style={s.glyphDisc}>
          <Ionicons name="play" size={40} color={colors.white} style={{ marginLeft: 5 }} />
        </View>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[s.center, { opacity: muteFlash }]}>
        <View style={[s.glyphDisc, s.glyphSmall]}>
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={28} color={colors.white} />
        </View>
      </Animated.View>

      {bursts.map((b) => (
        <HeartBurst key={b.id} x={b.x} y={b.y} onDone={() => setBursts((all) => all.filter((x) => x.id !== b.id))} />
      ))}

      {/* Creator, caption, rail and product card. */}
      <View style={[s.bottom, { paddingBottom: bottomInset + spacing.md }]} pointerEvents="box-none">
        <View style={s.infoRow} pointerEvents="box-none">
          <View style={s.info} pointerEvents="box-none">
            <View style={s.creatorRow}>
              <Avatar reel={reel} />
              <Text style={s.creator} numberOfLines={1}>{reel.creator.name}</Text>
              {team ? (
                <Ionicons name="checkmark-circle" size={15} color={colors.greenOnDark} accessibilityLabel="Official Autobacs" />
              ) : (
                <PressScale
                  onPress={() => props.onFollow(reel)}
                  haptic="selection"
                  style={[s.follow, following && s.following]}
                  accessibilityLabel={following ? `Following ${reel.creator.name}` : `Follow ${reel.creator.name}`}
                  accessibilityState={{ selected: following }}
                >
                  <Text style={[s.followText, following && { color: colors.white }]}>{following ? 'Following' : 'Follow'}</Text>
                </PressScale>
              )}
            </View>
            {!!reel.caption && (
              <Pressable onPress={() => setExpanded((e) => !e)} accessibilityRole="button" accessibilityLabel={expanded ? 'Show less' : 'Show full caption'}>
                <Text style={s.caption} numberOfLines={expanded ? 6 : 2}>{reel.caption}</Text>
              </Pressable>
            )}
          </View>

          <View style={s.railCol}>
            <RailButton
              icon={reel.viewerLiked ? 'heart' : 'heart-outline'}
              color={reel.viewerLiked ? colors.red : colors.white}
              label={compact(reel.likeCount)}
              onPress={() => props.onLike(reel)}
              a11y={reel.viewerLiked ? 'Unlike' : 'Like'}
            />
            <RailButton
              icon={saved ? 'bookmark' : 'bookmark-outline'}
              color={saved ? colors.gold : colors.white}
              label={saved ? 'Saved' : 'Save'}
              onPress={() => props.onSave(reel)}
              a11y={saved ? 'Remove from saved' : 'Save'}
            />
            <RailButton icon="paper-plane-outline" label="Share" onPress={() => props.onShare(reel)} a11y="Share" />
            <RailButton
              icon={muted ? 'volume-mute' : 'volume-high-outline'}
              label={muted ? 'Muted' : 'Sound'}
              onPress={props.onToggleMute}
              a11y={muted ? 'Unmute' : 'Mute'}
            />
            <RailButton icon="ellipsis-horizontal" onPress={() => props.onReport(reel)} a11y="More: report this reel" />
          </View>
        </View>

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
    </View>
  );
}

export const ReelSlide = memo(ReelSlideImpl);

const textShadow = { textShadowColor: alpha(palette.black, 0.5), textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } } as const;

const s = StyleSheet.create({
  page: { width: '100%', backgroundColor: colors.carbon, overflow: 'hidden' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 150 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  glyphDisc: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: alpha(palette.ink, 0.42),
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.onDarkFaint,
    alignItems: 'center', justifyContent: 'center',
  },
  glyphSmall: { width: 64, height: 64, borderRadius: 32 },
  failCard: {
    alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
    borderRadius: radius.xl, backgroundColor: colors.glassDark, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.onDarkFaint,
  },
  failText: { fontFamily: font.medium, fontSize: 14, color: colors.white },
  retry: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs,
    paddingHorizontal: spacing.lg, height: 38, borderRadius: radius.pill, backgroundColor: colors.white,
  },
  retryText: { fontFamily: font.bold, fontSize: 13.5, color: colors.ink },
  iconShadow: textShadow,

  progressWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  progressTrack: { height: 2.5, borderRadius: 2, backgroundColor: colors.onDarkFaint, overflow: 'hidden' },
  progressFill: { height: 2.5, borderRadius: 2, backgroundColor: colors.white },

  pin: { position: 'absolute', left: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '78%' },
  pinDot: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: colors.white,
    borderWidth: 3, borderColor: alpha(palette.white, 0.35),
  },

  burst: { position: 'absolute', width: 120, height: 120 },
  burstCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  info: { flex: 1, minWidth: 0, gap: spacing.sm },
  railCol: { alignItems: 'center', gap: spacing.lg, paddingBottom: 2 },
  rail: { alignItems: 'center', minWidth: 48 },
  railText: { fontFamily: font.bold, fontSize: 11.5, color: colors.white, marginTop: 2, ...textShadow },

  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarRing: { padding: 2, borderRadius: 22, borderWidth: 1.5, borderColor: colors.greenOnDark },
  avatar: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarText: { fontFamily: font.heading, fontSize: 15, color: colors.white },
  creator: { fontFamily: font.bold, fontSize: 15, color: colors.white, flexShrink: 1, ...textShadow },
  follow: {
    height: 28, paddingHorizontal: spacing.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.white, backgroundColor: colors.white,
  },
  following: { backgroundColor: 'transparent', borderColor: colors.onDarkMuted },
  followText: { fontFamily: font.bold, fontSize: 12.5, color: colors.ink },
  caption: { fontFamily: font.regular, fontSize: 14, lineHeight: 19, color: alpha(palette.white, 0.94), ...textShadow },
});
