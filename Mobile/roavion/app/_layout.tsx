/**
 * App root: fonts, providers and the navigation stack.
 *
 * Nothing renders until both fonts are loaded, so text never flashes in the
 * system font and then jump when the brand font arrives.
 */
import { useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  Montserrat_800ExtraBold,
} from '@expo-google-fonts/montserrat';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { AppProvider } from '../src/store';
import { colors, font } from '../src/theme';
import { LaunchIntro, ToastProvider } from '../src/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Catalogue data changes slowly; one minute of freshness keeps screens instant
// when moving back and forth without serving anything stale enough to mislead.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, gcTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    // DM Sans for body text, Montserrat for headings — the website's exact
    // pairing. The app previously set Montserrat on everything, which is the
    // single biggest reason it did not read like the site: Montserrat is a
    // display face, and at 13-15px in a product card it looks heavier and more
    // cramped than the DM Sans the website actually ships.
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
  });

  // The native splash (void + AB badge) hides only once the animated intro has
  // laid out on top of it, so the hand-off has no flash of the app underneath.
  const hideSplash = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <ToastProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              // Design "A clean light": white bars, ink text, hairline-free.
              headerStyle: { backgroundColor: colors.card },
              headerTintColor: colors.ink,
              headerTitleStyle: { fontFamily: font.heading, fontSize: 17, color: colors.ink },
              headerBackButtonDisplayMode: 'minimal',
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="product/[slug]" options={{ title: '' }} />
            <Stack.Screen name="category/[slug]" options={{ title: 'Shop' }} />
            <Stack.Screen name="search" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ title: 'Sign in' }} />
            <Stack.Screen name="register" options={{ title: 'Create account' }} />
            <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
            <Stack.Screen name="orders" options={{ title: 'My orders' }} />
            <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
            <Stack.Screen name="garage" options={{ headerShown: false }} />
            <Stack.Screen name="reels/new" options={{ title: 'Post a reel', presentation: 'modal' }} />
            <Stack.Screen name="reels/mine" options={{ title: 'My reels' }} />
          </Stack>
          <LaunchIntro onReady={hideSplash} />
          </ToastProvider>
        </AppProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
