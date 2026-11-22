/**
 * Toast — a short carbon message (square, gold hairline, Heritage Noir) that drops in under the status bar.
 *
 *   const toast = useToast();
 *   toast.show('Added to cart');                                   // after the server confirms
 *   toast.show({ message: 'Saved', icon: 'heart' });
 *   toast.show({ message: 'Could not add', tone: 'error', action: { label: 'Retry', onPress: retry } });
 *
 * `<ToastProvider>` is mounted once in app/_layout.tsx. One toast at a time;
 * a new one replaces the old. Announced to screen readers.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInUp, SlideOutUp, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, font, noir, radius, spacing } from '../theme';
import { haptic } from './motion';

type ToastTone = 'default' | 'success' | 'error';
export type ToastOptions = {
  message: string;
  tone?: ToastTone;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: { label: string; onPress: () => void };
  /** ms, default 2600 (4500 with an action). */
  duration?: number;
};

type Ctx = { show: (o: ToastOptions | string) => void; hide: () => void };
const ToastCtx = createContext<Ctx>({ show: () => {}, hide: () => {} });

export function useToast(): Ctx {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [toast, setToast] = useState<(ToastOptions & { key: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback(
    (o: ToastOptions | string) => {
      const opts: ToastOptions = typeof o === 'string' ? { message: o } : o;
      if (timer.current) clearTimeout(timer.current);
      seq.current += 1;
      setToast({ ...opts, key: seq.current });
      if (opts.tone === 'success') haptic.success();
      else if (opts.tone === 'error') haptic.error();
      AccessibilityInfo.announceForAccessibility(opts.message);
      timer.current = setTimeout(hide, opts.duration ?? (opts.action ? 4500 : 2600));
    },
    [hide],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ show, hide }), [show, hide]);
  const icon = toast?.icon ?? (toast?.tone === 'success' ? 'checkmark-circle' : toast?.tone === 'error' ? 'alert-circle' : undefined);
  const iconColor = toast?.tone === 'error' ? colors.red : toast?.tone === 'success' ? noir.greenText : noir.gold;

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {toast && (
        <View pointerEvents="box-none" style={[s.host, { top: insets.top + spacing.sm }]}>
          <Animated.View
            key={toast.key}
            entering={reduce ? FadeIn : SlideInUp.springify().damping(18)}
            exiting={reduce ? FadeOut : SlideOutUp.duration(200)}
            style={s.toast}
            accessibilityLiveRegion="polite"
          >
            {icon && <Ionicons name={icon} size={18} color={iconColor} />}
            <Text style={s.msg} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.action && (
              <Pressable
                onPress={() => {
                  toast.action!.onPress();
                  hide();
                }}
                hitSlop={10}
                accessibilityRole="button"
              >
                <Text style={s.action}>{toast.action.label}</Text>
              </Pressable>
            )}
          </Animated.View>
        </View>
      )}
    </ToastCtx.Provider>
  );
}

const s = StyleSheet.create({
  host: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center', zIndex: 1000 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 520,
    alignSelf: 'stretch',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.square,
    backgroundColor: noir.surface,
    borderWidth: 1,
    borderColor: noir.goldLine,
    ...elevation.e3,
  },
  msg: { flex: 1, fontFamily: font.medium, fontSize: 14, lineHeight: 19, color: noir.text },
  action: { fontFamily: font.heading, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: noir.gold },
});
