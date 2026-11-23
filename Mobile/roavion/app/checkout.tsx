/**
 * Checkout — address, the server's totals, then payment.
 *
 * THE MONEY RULE. The app sends a delivery address and the items it wants; the
 * SERVER prices the order, creates the Razorpay order and verifies the payment
 * signature. Nothing on this screen can change what is charged.
 *
 * Payment runs inside a WebView loading Razorpay's own checkout, which is what
 * lets this work in Expo Go for testing. The page is built locally and the only
 * thing it ever posts back is Razorpay's payment id and signature, which the
 * server then verifies. A native SDK can replace this later without any change
 * to the backend.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ScrollViewInstance } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/api/client';
import { Photo } from '../src/components/ui';
import { colors, elevation, font, inr, radius, spacing, type } from '../src/theme';
import { Card, EmptyState, Overline, PremiumButton } from '../src/ui';
import { useApp } from '../src/store';

interface Address {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
}

/** Autofill hints per field (look/UX only — the values are sent exactly as typed). */
const AUTOFILL: Record<keyof Address, Pick<TextInputProps, 'autoComplete' | 'textContentType' | 'autoCapitalize'>> = {
  fullName: { autoComplete: 'name', textContentType: 'name', autoCapitalize: 'words' },
  phone: { autoComplete: 'tel', textContentType: 'telephoneNumber', autoCapitalize: 'none' },
  addressLine1: { autoComplete: 'address-line1', textContentType: 'streetAddressLine1', autoCapitalize: 'words' },
  addressLine2: { autoComplete: 'address-line2', textContentType: 'streetAddressLine2', autoCapitalize: 'words' },
  city: { autoComplete: 'postal-address-locality', textContentType: 'addressCity', autoCapitalize: 'words' },
  state: { autoComplete: 'postal-address-region', textContentType: 'addressState', autoCapitalize: 'words' },
  postalCode: { autoComplete: 'postal-code', textContentType: 'postalCode', autoCapitalize: 'none' },
};

const EMPTY: Address = {
  fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '',
};

/** Razorpay's own checkout page, built here so no third-party page is loaded. */
function razorpayPage(opts: { key: string; orderId: string; amount: number; name: string; email: string; phone: string }) {
  const json = JSON.stringify(opts).replace(/</g, '\\u003c');
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#eef1f0;font-family:-apple-system,Roboto,sans-serif}
.w{display:flex;height:100%;align-items:center;justify-content:center;color:#5f6363}</style>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script></head>
<body><div class="w">Opening secure payment…</div>
<script>
  var o = ${json};
  var post = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  try {
    var rzp = new Razorpay({
      key: o.key,
      order_id: o.orderId,
      amount: o.amount,
      currency: 'INR',
      name: 'Autobacs',
      description: 'Order payment',
      prefill: { name: o.name, email: o.email, contact: o.phone },
      theme: { color: '#0a5c33' },
      modal: { ondismiss: function () { post({ type: 'cancelled' }); } },
      handler: function (r) { post({ type: 'paid', response: r }); }
    });
    rzp.on('payment.failed', function (e) {
      post({ type: 'failed', message: (e && e.error && e.error.description) || 'Payment failed' });
    });
    rzp.open();
  } catch (e) { post({ type: 'failed', message: String(e && e.message || e) }); }
</script></body></html>`;
}

export default function CheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart, customer, refreshCart } = useApp();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollViewInstance>(null);

  const [address, setAddress] = useState<Address>({
    ...EMPTY,
    fullName: customer?.name ?? '',
    phone: customer?.phone ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pay, setPay] = useState<{ html: string; orderId: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Purely visual: which address field has focus (green outline). */
  const [focused, setFocused] = useState<keyof Address | null>(null);

  // An error is shown at the end of the form — bring it into view.
  useEffect(() => {
    if (error) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [error]);

  const set = (key: keyof Address) => (value: string) => setAddress((a) => ({ ...a, [key]: value }));

  const missing = useMemo(() => {
    const required: (keyof Address)[] = ['fullName', 'phone', 'addressLine1', 'city', 'state', 'postalCode'];
    return required.filter((k) => !address[k].trim());
  }, [address]);

  /**
   * 1. create the order (server prices it) → 2. create the Razorpay order →
   * 3. pay → 4. server verifies the signature. Fulfilment itself is driven by
   * Razorpay's webhook, exactly as on the website.
   */
  const placeOrder = async () => {
    setError('');
    if (missing.length) return setError('Please fill in every delivery field.');
    if (!/^\d{10}$/.test(address.phone.replace(/\D/g, '').slice(-10))) {
      return setError('Enter a valid 10-digit mobile number.');
    }

    setBusy(true);
    try {
      const created = await api.post<{ order?: { _id: string; totalAmount: number } }>('/orders', {
        items: cart.items.map((i) => ({ product: i.productId, quantity: i.quantity, ...(i.variantId ? { variantId: i.variantId } : {}) })),
        shippingAddress: {
          fullName: address.fullName.trim(),
          phone: address.phone.trim(),
          addressLine1: address.addressLine1.trim(),
          addressLine2: address.addressLine2.trim(),
          city: address.city.trim(),
          state: address.state.trim(),
          postalCode: address.postalCode.trim(),
          country: 'India',
        },
        acceptTerms: true,
      });

      const orderId = created.order?._id;
      if (!orderId) throw new Error('We could not create your order. Please try again.');

      const rp = await api.post<{ data?: { orderId: string; amount: number; keyId: string } }>('/razorpay/create-order', {
        orderId,
        currency: 'INR',
      });
      const d = rp.data;
      if (!d?.orderId || !d?.keyId) throw new Error('Payment could not be started. Please try again.');

      setPay({
        orderId,
        html: razorpayPage({
          key: d.keyId,
          orderId: d.orderId,
          amount: d.amount,
          name: address.fullName,
          email: customer?.email ?? '',
          phone: address.phone,
        }),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onPaymentMessage = async (raw: string) => {
    let msg: { type: string; response?: Record<string, string>; message?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const orderId = pay?.orderId;
    setPay(null);

    if (msg.type === 'cancelled') return setError('Payment was cancelled. Your order is saved and unpaid.');
    if (msg.type === 'failed') return setError(msg.message || 'Payment failed. Nothing was charged.');

    if (msg.type === 'paid' && msg.response && orderId) {
      setBusy(true);
      try {
        await api.post('/razorpay/verify-payment', { ...msg.response, orderId });
        await refreshCart();
        setDone(orderId);
      } catch (err) {
        // The webhook is the real source of truth, so a failure here is a
        // reporting problem, not a lost payment — say so plainly.
        setError(
          `Your payment went through, but we could not confirm it on screen (${(err as Error).message}). ` +
            'Check "My orders" in a minute, or contact support with your payment id.',
        );
      } finally {
        setBusy(false);
      }
    }
  };

  if (done) {
    return (
      <>
        <Stack.Screen options={{ title: 'Order placed', headerBackVisible: false }} />
        <View style={s.screen}>
          <EmptyState
            icon="checkmark-circle-outline"
            title="Thank you — your order is placed"
            body="We have emailed your confirmation. You can follow it in My orders."
            action={{
              label: 'View my orders',
              onPress: () => {
                // The orders list may be cached from before this purchase.
                queryClient.invalidateQueries({ queryKey: ['orders'] });
                router.replace('/orders');
              },
            }}
            secondary={{ label: 'Continue shopping', onPress: () => router.replace('/(tabs)') }}
          />
        </View>
      </>
    );
  }

  if (!cart.items.length) {
    return (
      <>
        <Stack.Screen options={{ title: 'Checkout' }} />
        <View style={s.screen}>
          <EmptyState
            icon="bag-handle-outline"
            title="Your cart is empty"
            action={{ label: 'Start shopping', onPress: () => router.replace('/(tabs)/shop') }}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }} keyboardShouldPersistTaps="handled">
          {/* Where they are in the journey — purely visual. */}
          <View style={s.steps} accessibilityLabel="Step 2 of 3: delivery and payment">
            {['Cart', 'Delivery', 'Payment'].map((label, i) => (
              <View key={label} style={s.step}>
                <View style={[s.stepDot, i <= 1 && s.stepDotOn]}>
                  {i === 0 ? (
                    <Ionicons name="checkmark" size={12} color={colors.white} />
                  ) : (
                    <Text style={[s.stepNum, i <= 1 && { color: colors.white }]}>{i + 1}</Text>
                  )}
                </View>
                <Text style={[s.stepLabel, i <= 1 && { color: colors.ink }]}>{label}</Text>
                {i < 2 && <View style={[s.stepLine, i === 0 && { backgroundColor: colors.green }]} />}
              </View>
            ))}
          </View>

          <Card>
            <View style={s.cardHead}>
              <View style={s.cardIcon}>
                <Ionicons name="location-outline" size={18} color={colors.green} />
              </View>
              <View>
                <Overline>Step 2</Overline>
                <Text style={type.h3}>Delivery address</Text>
              </View>
            </View>
            <View style={{ marginTop: spacing.lg }}>
              {([
                ['fullName', 'Full name', 'e.g. Rahul Sharma'],
                ['phone', 'Mobile number', '10-digit mobile number'],
                ['addressLine1', 'Address', 'House / street'],
                ['addressLine2', 'Landmark (optional)', 'Area, landmark'],
                ['city', 'City', 'e.g. Kochi'],
                ['state', 'State', 'e.g. Kerala'],
                ['postalCode', 'PIN code', '6-digit PIN'],
              ] as [keyof Address, string, string][]).map(([key, label, placeholder]) => (
                <View key={key}>
                  <Text style={s.label}>{label}</Text>
                  <TextInput
                    value={address[key]}
                    onChangeText={set(key)}
                    onFocus={() => setFocused(key)}
                    onBlur={() => setFocused((f) => (f === key ? null : f))}
                    style={[s.input, focused === key && s.inputFocus]}
                    placeholder={placeholder}
                    placeholderTextColor={colors.steel}
                    selectionColor={colors.green}
                    keyboardType={key === 'phone' || key === 'postalCode' ? 'number-pad' : 'default'}
                    maxLength={key === 'postalCode' ? 6 : key === 'phone' ? 16 : 120}
                    accessibilityLabel={label}
                    {...AUTOFILL[key]}
                    returnKeyType={key === 'postalCode' ? 'done' : 'next'}
                  />
                </View>
              ))}
            </View>
          </Card>

          <Card style={{ marginTop: spacing.lg }}>
            <View style={s.cardHead}>
              <View style={s.cardIcon}>
                <Ionicons name="receipt-outline" size={18} color={colors.green} />
              </View>
              <View>
                <Overline>Review</Overline>
                <Text style={type.h3}>Order summary</Text>
              </View>
            </View>
            {cart.items.map((i) => (
              <View key={`${i.productId}-${i.variantId ?? 'base'}`} style={s.sumRow}>
                <Photo uri={i.image} style={s.sumImage} />
                <View style={{ flex: 1 }}>
                  <Text style={s.sumName} numberOfLines={2}>{i.name}</Text>
                  <Text style={s.sumQty}>Qty {i.quantity}</Text>
                </View>
                <Text style={s.sumValue}>{inr(i.price * i.quantity)}</Text>
              </View>
            ))}
            <View style={s.sumTotal}>
              <Text style={s.sumTotalLabel}>Subtotal</Text>
              <Text style={s.sumTotalValue}>{inr(cart.totalPrice)}</Text>
            </View>
            <View style={s.secure}>
              <Ionicons name="lock-closed" size={13} color={colors.green} />
              <Text style={s.secureText}>
                Our server works out the final amount, including any delivery charge. You always pay exactly the amount Razorpay shows.
              </Text>
            </View>
          </Card>

          {!!error && (
            <View style={s.errorBox} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={18} color={colors.red} />
              <Text style={s.error}>{error}</Text>
            </View>
          )}
        </ScrollView>

        <View style={[s.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={s.barRow}>
            <View>
              <Text style={s.barLabel}>Subtotal</Text>
              <Text style={s.barHint}>Final amount confirmed on the payment screen</Text>
            </View>
            <Text style={s.barTotal}>{inr(cart.totalPrice)}</Text>
          </View>
          {missing.length > 0 && (
            <Text style={s.barMissing} accessibilityLiveRegion="polite">
              {missing.length === 1 ? 'Fill in 1 more delivery field to continue' : `Fill in ${missing.length} more delivery fields to continue`}
            </Text>
          )}
          <PremiumButton
            label={busy ? 'Please wait…' : 'Place order and pay'}
            onPress={placeOrder}
            loading={busy}
            disabled={missing.length > 0}
            icon="lock-closed"
            variant="green"
            full
          />
          <View style={s.barTrust}>
            <Ionicons name="shield-checkmark-outline" size={12} color={colors.muted} />
            <Text style={s.barTrustText}>Secured by Razorpay · UPI, cards, netbanking</Text>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Razorpay runs full-screen; dismissing it cancels the payment. */}
      <Modal visible={!!pay} animationType="slide" onRequestClose={() => setPay(null)}>
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.bg }}>
          {pay && (
            <WebView
              originWhitelist={['*']}
              source={{ html: pay.html, baseUrl: 'https://www.autobacsindia.com' }}
              onMessage={(e) => onPaymentMessage(e.nativeEvent.data)}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  steps: { flexDirection: 'row', marginBottom: spacing.lg, paddingHorizontal: spacing.xs },
  step: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.chrome,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotOn: { backgroundColor: colors.green, borderColor: colors.green },
  stepNum: { fontFamily: font.bold, fontSize: 11, color: colors.muted },
  stepLabel: { fontFamily: font.semibold, fontSize: 12, color: colors.muted },
  stepLine: { flex: 1, height: 2, borderRadius: 1, backgroundColor: colors.line, marginHorizontal: 4 },

  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: {
    width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  label: { fontFamily: font.semibold, fontSize: 12.5, color: colors.ink2, marginBottom: 6 },
  input: {
    backgroundColor: colors.page, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: spacing.md, height: 50, fontFamily: font.regular, fontSize: 15,
    color: colors.ink, marginBottom: spacing.md,
  },
  inputFocus: { backgroundColor: colors.white, borderColor: colors.green, borderWidth: 1.5 },

  sumRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  sumImage: { width: 48, height: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line },
  sumName: { fontFamily: font.medium, fontSize: 13.5, lineHeight: 18, color: colors.ink },
  sumQty: { ...type.caption, color: colors.muted },
  sumValue: { fontFamily: font.semibold, fontSize: 14, color: colors.ink },
  sumTotal: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg,
    paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line,
  },
  sumTotalLabel: { fontFamily: font.semibold, fontSize: 15, color: colors.ink },
  sumTotalValue: { fontFamily: font.heading, fontSize: 18, color: colors.ink },
  secure: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.md,
    padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.greenFaint,
  },
  secureText: { ...type.caption, color: colors.ink2, flex: 1 },

  errorBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.lg,
    padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.redSoft,
  },
  error: { fontFamily: font.medium, fontSize: 13, color: colors.red, lineHeight: 19, flex: 1 },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md, ...elevation.e3,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barLabel: { fontFamily: font.semibold, fontSize: 14, color: colors.ink2 },
  barTotal: { fontFamily: font.extrabold, fontSize: 20, color: colors.ink },
  barHint: { ...type.caption, color: colors.muted },
  barMissing: { fontFamily: font.medium, fontSize: 12.5, color: colors.ink2, textAlign: 'center' },
  barTrust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  barTrustText: { ...type.tiny, color: colors.muted },
});
