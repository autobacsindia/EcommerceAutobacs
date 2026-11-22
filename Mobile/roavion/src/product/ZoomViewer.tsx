/**
 * Mount it only while open (`{open && <ZoomViewer … />}`) so it starts on
 * the tapped photo at 1x every time.
 *
 * Full-screen photo viewer with pinch-to-zoom, drag while zoomed and
 * double-tap to zoom in/out. Opened by tapping the product gallery.
 *
 * Uses react-native-gesture-handler + reanimated (both run in Expo Go). The
 * Modal gets its own GestureHandlerRootView because Android renders modals
 * outside the app's root view.
 */
import { useCallback, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors, font, motion, spacing } from '../theme';
import { IconButton } from '../ui';

const MAX = 4;

function ZoomableImage({ uri, width, height, onZoomChange }: { uri: string; width: number; height: number; onZoomChange: (z: boolean) => void }) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);

  const clamp = (v: number, s: number, size: number) => {
    'worklet';
    const max = ((s - 1) * size) / 2;
    return Math.min(max, Math.max(-max, v));
  };

  const reset = () => {
    'worklet';
    scale.value = withSpring(1, motion.spring);
    saved.value = 1;
    tx.value = withSpring(0, motion.spring);
    ty.value = withSpring(0, motion.spring);
    scheduleOnRN(onZoomChange, false);
  };

  const pinch = Gesture.Pinch()
    .runOnJS(false)
    .onUpdate((e) => {
      scale.value = Math.min(MAX, Math.max(1, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
      if (scale.value <= 1.02) reset();
      else scheduleOnRN(onZoomChange, true);
      tx.value = withTiming(clamp(tx.value, scale.value, width));
      ty.value = withTiming(clamp(ty.value, scale.value, height));
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .averageTouches(true)
    // Only claim the drag when zoomed, so the pager still swipes at 1x.
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (saved.value > 1.02) state.activate();
      else state.fail();
    })
    .onStart(() => {
      sx.value = tx.value;
      sy.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = clamp(sx.value + e.translationX, scale.value, width);
      ty.value = clamp(sy.value + e.translationY, scale.value, height);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (saved.value > 1.02) {
        reset();
      } else {
        scale.value = withSpring(2.5, motion.spring);
        saved.value = 2.5;
        scheduleOnRN(onZoomChange, true);
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={[{ width, height }, style]}>
        <Image source={{ uri }} style={{ width, height }} contentFit="contain" transition={150} />
      </Animated.View>
    </GestureDetector>
  );
}

export function ZoomViewer({
  photos,
  index,
  visible,
  onClose,
}: {
  photos: string[];
  index: number;
  visible: boolean;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  const onZoomChange = useCallback((z: boolean) => setZoomed(z), []);


  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={s.root}>
        <ScrollView
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: index * width, y: 0 }}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {photos.map((uri, i) => (
            <View key={`${uri}-${i}`} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              <ZoomableImage uri={uri} width={width} height={height * 0.8} onZoomChange={onZoomChange} />
            </View>
          ))}
        </ScrollView>

        <View style={[s.top, { top: insets.top + spacing.sm }]}>
          <Text style={s.count}>
            {page + 1} / {photos.length}
          </Text>
          <IconButton icon="close" label="Close photos" tone="glass" onPress={onClose} />
        </View>
        <Text style={[s.hint, { bottom: insets.bottom + spacing.xl }]}>Pinch or double-tap to zoom</Text>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  top: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  count: { fontFamily: font.semibold, fontSize: 14, color: colors.white },
  hint: { position: 'absolute', alignSelf: 'center', fontFamily: font.regular, fontSize: 12, color: colors.onDarkMuted },
});
