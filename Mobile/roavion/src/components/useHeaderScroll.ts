/**
 * Scroll behaviour shared by every screen with a collapsing header.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * The header used to be a sibling ABOVE the scroll view, so all four of its
 * rows were pinned for the whole session. On a 360dp phone that is roughly a
 * quarter of the screen spent on chrome the customer has already read, and the
 * products — the only reason they opened the app — start below the fold.
 *
 * So the bulky rows now scroll away and come back the moment the customer
 * reaches upward, which is exactly when they want the search field again.
 *
 * ── diffClamp, not a threshold ──────────────────────────────────────────────
 * `diffClamp` tracks the DISTANCE scrolled since the last direction change,
 * bounded to [0, distance]. That gives reveal-on-scroll-up for free, and
 * proportionally: a short flick up brings part of the header back rather than
 * snapping the whole thing in. A hand-rolled "hide below Y, show above Y"
 * cannot do that and jitters whenever a finger wobbles across the threshold.
 *
 * ── Why the native driver matters here ──────────────────────────────────────
 * The transform runs on the UI thread, so the header keeps moving while
 * JavaScript is busy rendering the next page of products. Driven from JS it
 * would stutter on exactly the mid-range Android phones most of our customers
 * use. That is also why the back-to-top button is a separate piece of state:
 * a native-driven value cannot be read in render, so its visibility comes from
 * a listener instead — one setState per crossing, not one per frame.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';

/** How far down the customer must be before offering a way back to the top. */
const SHOW_TOP_AFTER = 700;

export interface HeaderScroll {
  /** Attach to an Animated.ScrollView / Animated.FlatList. */
  onScroll: ReturnType<typeof Animated.event>;
  /** Transform for the collapsing block. */
  translateY: Animated.AnimatedInterpolation<number>;
  /** True once the customer is far enough down to want the top again. */
  showTop: boolean;
  /** Raw offset, for anything else that needs it. */
  scrollY: Animated.Value;
}

/**
 * @param collapseHeight height of the block that scrolls away, in dp. Zero
 *        disables the collapse (a screen whose header is only the pinned bar).
 */
export function useHeaderScroll(collapseHeight: number): HeaderScroll {
  const scrollY = useRef(new Animated.Value(0)).current;
  const [showTop, setShowTop] = useState(false);

  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );

  const translateY = useMemo(() => {
    // A zero-height clamp range would divide by zero in the interpolation.
    if (collapseHeight <= 0) return new Animated.Value(0).interpolate({ inputRange: [0, 1], outputRange: [0, 0] });
    return Animated.diffClamp(scrollY, 0, collapseHeight).interpolate({
      inputRange: [0, collapseHeight],
      outputRange: [0, -collapseHeight],
      extrapolate: 'clamp',
    });
  }, [scrollY, collapseHeight]);

  useEffect(() => {
    // Only flips state when the threshold is actually crossed; the listener
    // itself fires every frame, and setState every frame would defeat the
    // point of driving the header natively.
    let visible = false;
    const id = scrollY.addListener(({ value }) => {
      const next = value > SHOW_TOP_AFTER;
      if (next !== visible) {
        visible = next;
        setShowTop(next);
      }
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  return { onScroll, translateY, showTop, scrollY };
}

/** Scroll any ref with a scrollTo/scrollToOffset back to the top, animated. */
export function useScrollToTop(ref: React.RefObject<{
  scrollTo?: (o: { y: number; animated: boolean }) => void;
  scrollToOffset?: (o: { offset: number; animated: boolean }) => void;
} | null>) {
  return useCallback(() => {
    const node = ref.current;
    if (!node) return;
    if (node.scrollTo) node.scrollTo({ y: 0, animated: true });
    else if (node.scrollToOffset) node.scrollToOffset({ offset: 0, animated: true });
  }, [ref]);
}
