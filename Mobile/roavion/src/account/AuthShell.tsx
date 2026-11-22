/**
 * Shared look for Sign in / Create account — Heritage Noir: carbon page, the
 * crest and a serif AUTOBACS wordmark, a serif title, a gold hairline, then a
 * square carbon-2 sheet holding the form. Look only — the screens own every
 * field, check and server call.
 */
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { font, noir, radius, spacing, type } from '../theme';
import { Crest, GoldRule, IconButton, PressScale, SerifTitle } from '../ui';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={[s.band, { paddingTop: insets.top + spacing.sm }]}>
            <View style={s.topRow}>
              <IconButton
                icon="chevron-back"
                label="Go back"
                tone="glass"
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              />
              <Text style={s.wordmark}>AUTOBACS</Text>
              <Crest ring="gold" />
            </View>
            <SerifTitle size="hero" italicLast style={s.title} accessibilityRole="header">
              {title}
            </SerifTitle>
            <Text style={s.subtitle}>{subtitle}</Text>
          </View>
          <GoldRule />
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

/** Labelled square input with a gold focus edge. */
export function Field({ label, icon, secureToggle, style, onFocus, onBlur, ...rest }: FieldProps) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.inputWrap, focus && s.inputFocus]}>
        {icon && <Ionicons name={icon} size={18} color={focus ? noir.gold : noir.textFaint} />}
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
          placeholderTextColor={noir.textFaint}
          selectionColor={noir.gold}
          keyboardAppearance="dark"
        />
        {secureToggle && (
          <PressScale onPress={secureToggle.onToggle} hitSlop={8} haptic="selection" accessibilityLabel={secureToggle.shown ? 'Hide password' : 'Show password'}>
            <Text style={s.show}>{secureToggle.shown ? 'HIDE' : 'SHOW'}</Text>
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
    <View style={[s.msg, { borderColor: err ? noir.sale : noir.greenText }]} accessibilityLiveRegion="polite">
      <Ionicons name={err ? 'alert-circle' : 'checkmark-circle'} size={16} color={err ? noir.sale : noir.greenText} />
      <Text style={s.msgText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: noir.page },
  band: { backgroundColor: noir.page, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { fontFamily: font.serif, fontSize: 16, letterSpacing: 4, color: noir.text },
  title: { marginTop: spacing.xxl },
  subtitle: { ...type.bodyNoir, color: noir.textMuted, marginTop: spacing.xs },
  sheet: { flex: 1, backgroundColor: noir.surface, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  label: { ...type.capsNoir, color: noir.textMuted, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 52, paddingHorizontal: spacing.lg,
    backgroundColor: noir.page, borderRadius: radius.square, borderWidth: 1, borderColor: noir.hairlineStrong,
  },
  inputFocus: { borderColor: noir.gold },
  input: { flex: 1, height: '100%', fontFamily: font.regular, fontSize: 15, color: noir.text },
  show: { fontFamily: font.heading, fontSize: 11, letterSpacing: 1.5, color: noir.gold },
  msg: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.square,
    borderWidth: 1, marginBottom: spacing.sm,
  },
  msgText: { flex: 1, fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: noir.text },
});
