/**
 * App root: fonts, providers, and which screens exist right now.
 *   signed out                     → Login only
 *   signed in, HR profile loaded   → tabs + face check + forms
 *   signed in, /hr/me failed       → a plain message (no profile yet / offline) with retry + sign out
 * `Stack.Protected` removes screens the current state does not allow, so a deep
 * link cannot open them.
 */
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts, Montserrat_700Bold, Montserrat_800ExtraBold } from '@expo-google-fonts/montserrat';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { SessionProvider, useSession } from '../src/auth/session';
import { ApiError, errorMessage, IS_MOCK } from '../src/api';
import { PunchProvider } from '../src/punch/PunchProvider';
import { registerForPush, setForegroundHandler, usePushTaps } from '../src/push/push';
import { useOtaUpdate } from '../src/updates/useOtaUpdate';
import { colors, font, spacing } from '../src/theme';
import { Button, Card, Logo, Screen, T } from '../src/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});
setForegroundHandler();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 1 },
    // Writes are never retried automatically; punches retry through the queue.
    mutations: { retry: 0 },
  },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_700Bold, Montserrat_700Bold, Montserrat_800ExtraBold });
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <Gate />
          <UpdateBanner />
          {IS_MOCK ? <DemoRibbon /> : null}
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const header = {
  headerStyle: { backgroundColor: colors.card },
  headerTintColor: colors.ink,
  headerTitleStyle: { fontFamily: font.heading, fontSize: 17, color: colors.ink },
  headerBackButtonDisplayMode: 'minimal' as const,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

function Gate() {
  const { phase, employee, employeeError, retry, signOut } = useSession();

  useEffect(() => {
    if (phase !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [phase]);

  // Phone notifications: (re-)register on every signed-in launch — the token
  // can change, and the server moves it if someone else used this phone.
  const ready = phase === 'signedIn' && !!employee;
  useEffect(() => {
    if (ready && !IS_MOCK) void registerForPush();
  }, [ready, employee?.id]);
  usePushTaps(ready);

  if (phase === 'loading') return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  if (phase === 'signedIn' && !employee) {
    const noProfile = employeeError instanceof ApiError && employeeError.status === 404 && !employeeError.notAvailable;
    return (
      <Screen edges={['top', 'bottom']}>
        <Logo />
        <Card style={{ gap: spacing.md, marginTop: spacing.xl }}>
          <T kind="h2">{noProfile ? 'Your HR profile is not ready' : 'Could not load your details'}</T>
          <T>
            {noProfile
              ? 'You are signed in, but HR has not set up your employee profile yet. Ask HR, then tap Try again.'
              : errorMessage(employeeError)}
          </T>
          <Button label="Try again" variant="primary" onPress={retry} />
          <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
        </Card>
      </Screen>
    );
  }

  const signedIn = phase === 'signedIn' && !!employee;
  const stack = (
    <Stack screenOptions={header}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="face/consent" options={{ title: 'Set up face check' }} />
        <Stack.Screen name="face/check" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="fix-day" options={{ title: 'Ask HR to fix a day', presentation: 'modal' }} />
        <Stack.Screen name="payslip/[month]" options={{ title: 'Payslip' }} />
        <Stack.Screen name="marks" options={{ title: 'Marks and overtime' }} />
        <Stack.Screen name="documents" options={{ title: 'My documents' }} />
        <Stack.Screen name="holidays" options={{ title: 'Holidays' }} />
      </Stack.Protected>
    </Stack>
  );
  return signedIn ? <PunchProvider employeeId={employee!.id}>{stack}</PunchProvider> : stack;
}

/** A new version was downloaded over the air: one tap to use it now. */
function UpdateBanner() {
  const { ready, restart } = useOtaUpdate();
  if (!ready) return null;
  return (
    <View
      style={{
        position: 'absolute', left: 12, right: 12, bottom: 96, backgroundColor: colors.ink, borderRadius: 14,
        padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}
    >
      <Text style={{ fontFamily: font.medium, fontSize: 14, color: colors.white, flex: 1 }}>A new version of the app is ready.</Text>
      <Text onPress={restart} accessibilityRole="button" style={{ fontFamily: font.bold, fontSize: 14, color: colors.greenOnDark }}>
        Restart now
      </Text>
    </View>
  );
}

/** Makes it impossible to mistake demo data for the real thing. */
function DemoRibbon() {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', bottom: 92, right: 12, backgroundColor: colors.warnSoft, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 2 }}
    >
      <Text style={{ fontFamily: font.bold, fontSize: 10, color: colors.warn, letterSpacing: 1 }}>DEMO DATA</Text>
    </View>
  );
}
