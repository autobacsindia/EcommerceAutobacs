/**
 * Premium foundation — import everything from here:
 *   import { PremiumButton, Price, Shimmer, StripeLoader, useToast } from '../src/ui';
 * Tokens stay in `src/theme.ts`.
 */
export { haptic, PressScale, usePressScale, useReduceMotion, type HapticKind, type PressScaleProps } from './motion';
export {
  Stripes,
  StripeLoader,
  Shimmer,
  ProductCardSkeleton,
  ProductGridSkeleton,
  RailSkeleton,
  ListSkeleton,
  ProductDetailSkeleton,
  HomeSkeleton,
} from './loaders';
export {
  Overline,
  PremiumButton,
  IconButton,
  CountBubble,
  GlassChip,
  Price,
  Rating,
  Badge,
  SectionHeader,
  Card,
  type ButtonVariant,
  type BadgeTone,
} from './primitives';
export { Sheet } from './Sheet';
export { ToastProvider, useToast, type ToastOptions } from './Toast';
export { EmptyState, ErrorState, OfflineState, LoadingState, StateLayout, isOfflineError } from './states';
export { LaunchIntro } from './LaunchIntro';
export { FloatingTabBar, TAB_BAR_HEIGHT, useTabBarSpace } from './FloatingTabBar';
