/**
 * Shared look for Sign in / Create account: a light band with the Autobacs
 * logo (black wordmark, so it needs a light ground) and faint brand stripes,
 * then a soft sheet holding the form. Look only — the
 * screens own every field, check and server call.
 */
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { colors, font, radius, spacing, type } from '../theme';
import { IconButton, PressScale, Stripes } from '../ui';

const LOGO = require('../../assets/autobacs-logo.png');

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={[s.band, { paddingTop: insets.top + spacing.sm }]}>
            <View style={s.bigStripes} pointerEvents="none">
              <Stripes width={56} height={190} gap={14} />
            </View>
            <IconButton
              icon="chevron-back"
              label="Go back"
              tone="plain"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            />
            <View style={s.brandRow}>
              {/* The real logo, as in the website header — never plain text. */}
              <Image source={LOGO} style={s.logo} contentFit="contain" accessibilityLabel="Autobacs India" />
            </View>
            <Text style={s.title} accessibilityRole="header">{title}</Text>
            <Text style={s.subtitle}>{subtitle}</Text>
          </View>
          <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Adds a Show/Hide toggle for passwords. */
  secureToggle?: { shown: boolean; onToggle: () => void };
};

/** Labelled input with a green focus ring. */
export function Field({ label, icon, secureToggle, style, onFocus, onBlur, ...rest }: FieldProps) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.inputWrap, focus && s.inputFocus]}>
        {icon && <Ionicons name={icon} size={18} color={focus ? colors.green : colors.steel} />}
        <TextInput
          {...rest}
          onFocus={(e) => {
            setFocus(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            onBlur?.(e);
          }}
          style={[s.input, style]}
          placeholderTextColor={colors.steel}
          selectionColor={colors.green}
        />
        {secureToggle && (
          <PressScale onPress={secureToggle.onToggle} hitSlop={8} haptic="selection" accessibilityLabel={secureToggle.shown ? 'Hide password' : 'Show password'}>
            <Text style={s.show}>{secureToggle.shown ? 'Hide' : 'Show'}</Text>
          </PressScale>
        )}
      </View>
    </View>
  );
}

/** Error / notice line under the form. */
export function FormMessage({ text, tone }: { text: string; tone: 'error' | 'notice' }) {
  if (!text) return null;
  const err = tone === 'error';
  return (
    <View style={[s.msg, { backgroundColor: err ? colors.redSoft : colors.greenSoft }]} accessibilityLiveRegion="polite">
      <Ionicons name={err ? 'alert-circle' : 'checkmark-circle'} size={16} color={err ? colors.red : colors.green} />
      <Text style={[s.msgText, { color: err ? colors.red : colors.green }]}>{text}</Text>
    </View>
  );
}


const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  band: { backgroundColor: colors.white, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl + spacing.lg, overflow: 'hidden' },
  bigStripes: { position: 'absolute', right: -10, top: 30, opacity: 0.1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  logo: { width: 150, height: 35 },
  title: { ...type.display, color: colors.ink, marginTop: spacing.lg },
  subtitle: { ...type.body, color: colors.muted, marginTop: spacing.xs },
  sheet: {
    flex: 1, backgroundColor: colors.bg, marginTop: -spacing.xl, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl,
  },
  label: { fontFamily: font.semibold, fontSize: 13, color: colors.ink2, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 52, paddingHorizontal: spacing.lg,
    backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
  },
  inputFocus: { borderColor: colors.green, borderWidth: 1.5 },
  input: { flex: 1, height: '100%', fontFamily: font.regular, fontSize: 15, color: colors.ink },
  show: { fontFamily: font.semibold, fontSize: 13, color: colors.green },
  msg: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  msgText: { flex: 1, fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
});
