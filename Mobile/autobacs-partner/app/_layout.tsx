/**
 * App root: fonts, providers, and WHICH screens exist for the current supplier.
 *
 * Access is decided only from the server's account status (GET /partner/me):
 *   signed out                          → welcome / sign-up / sign-in / forgot
 *   email_unverified (signed in)        → email code
 *   draft · changes_requested · in_review · rejected · suspended → onboarding (form or status)
 *   approved                            → products, profile, add/edit product
 * `Stack.Protected` removes the other screens entirely, so a deep link cannot
 * reach a screen the supplier's status does not allow.
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
import { errorMessage, IS_MOCK } from '../src/api';
import { colors, font } from '../src/theme';
import { Button, ErrorState, Logo, Screen } from '../src/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    // Supplier data is the supplier's own and changes when procurement acts:
    // short freshness, refetch on focus so a status change shows up promptly.
    queries: { staleTime: 15_000, gcTime: 5 * 60_000, retry: 1 },
    // Never retry a write automatically — the user decides to try again.
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
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const ONBOARDING = new Set(['draft', 'changes_requested', 'in_review', 'rejected', 'suspended']);

function Gate() {
  const { phase, account, accountError, retryAccount, signOut } = useSession();

  useEffect(() => {
    if (phase !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [phase]);

  if (phase === 'loading') return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  // Token present but /me failed (offline, server down): say so, offer retry.
  if (phase === 'signedIn' && !account) {
    return (
      <Screen edges={['top', 'bottom']} scroll={false} contentStyle={{ padding: 16 }}>
        <Logo size={36} style={{ marginTop: 8 }} />
        <ErrorState message={errorMessage(accountError)} onRetry={retryAccount} />
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </Screen>
    );
  }

  const signedOut = phase === 'signedOut';
  const status = account?.status;
  const unverified = status === 'email_unverified';
  const onboarding = !!status && ONBOARDING.has(status);
  const approved = status === 'approved';

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: font.heading, fontSize: 17, color: colors.ink },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Protected guard={signedOut}>
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="sign-up" options={{ title: 'Create your account' }} />
          <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
          <Stack.Screen name="forgot" options={{ title: 'Reset password' }} />
        </Stack.Protected>
        <Stack.Protected guard={unverified}>
          <Stack.Screen name="verify" options={{ title: 'Check your email', headerBackVisible: false }} />
        </Stack.Protected>
        <Stack.Protected guard={onboarding}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={approved}>
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="listing/new" options={{ title: 'Add a product', presentation: 'modal' }} />
          <Stack.Screen name="listing/[id]/index" options={{ title: 'Product' }} />
          <Stack.Screen name="listing/[id]/edit" options={{ title: 'Edit product', presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
      {IS_MOCK ? <MockRibbon /> : null}
    </>
  );
}

/** Makes it impossible to mistake the dev mock for the real server. */
function MockRibbon() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 54, right: 10, backgroundColor: colors.goldSoft, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ fontFamily: font.bold, fontSize: 10, color: colors.gold }}>DEMO DATA</Text>
    </View>
  );
}
