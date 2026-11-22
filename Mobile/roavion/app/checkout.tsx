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
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/api/client';
import { Photo } from '../src/components/ui';
import { colors, font, inr, noir, radius, spacing, type } from '../src/theme';
import { Card, EmptyState, GoldRule, Overline, PremiumButton, SerifTitle } from '../src/ui';
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
            action={{ label: 'View my orders', onPress: () => router.replace('/orders') }}
            onDark
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
            onDark
          />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 200 }} keyboardShouldPersistTaps="handled">
          {/* Where they are in the journey — purely visual. */}
          <View style={s.steps} accessibilityLabel="Step 2 of 3: delivery and payment">
            {['Cart', 'Delivery', 'Payment'].map((label, i) => (
              <View key={label} style={s.step}>
                <View style={[s.stepDot, i <= 1 && s.stepDotOn]}>
                  {i === 0 ? (
                    <Ionicons name="checkmark" size={12} color={noir.text} />
                  ) : (
                    <Text style={[s.stepNum, i <= 1 && { color: noir.text }]}>{i + 1}</Text>
                  )}
                </View>
                <Text style={[s.stepLabel, i <= 1 && { color: noir.text }]}>{label}</Text>
                {i < 2 && <View style={[s.stepLine, i === 0 && { backgroundColor: noir.greenText }]} />}
              </View>
            ))}
          </View>

          <Card tone="noir">
            <View style={s.cardHead}>
              <View style={s.cardIcon}>
                <Ionicons name="location-outline" size={18} color={noir.greenText} />
              </View>
              <View>
                <Overline noir>Step 2</Overline>
                <SerifTitle size="section" italicLast>Delivery address</SerifTitle>
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
                    placeholderTextColor={noir.textFaint}
                    selectionColor={noir.gold}
                    keyboardType={key === 'phone' || key === 'postalCode' ? 'number-pad' : 'default'}
                    maxLength={key === 'postalCode' ? 6 : key === 'phone' ? 16 : 120}
                    accessibilityLabel={label}
                  />
                </View>
              ))}
            </View>
          </Card>

          <Card tone="noir" style={{ marginTop: spacing.lg }}>
            <View style={s.cardHead}>
              <View style={s.cardIcon}>
                <Ionicons name="receipt-outline" size={18} color={noir.greenText} />
              </View>
              <View>
                <Overline noir>Review</Overline>
                <SerifTitle size="section" italicLast>Order summary</SerifTitle>
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
              <Ionicons name="lock-closed" size={13} color={noir.greenText} />
              <Text style={s.secureText}>
                Delivery and taxes are added by our server on the payment screen. You always pay the amount Razorpay shows.
              </Text>
            </View>
          </Card>

          {!!error && (
            <View style={s.errorBox} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={18} color={noir.sale} />
              <Text style={s.error}>{error}</Text>
            </View>
          )}
        </ScrollView>

        <View style={[s.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          <GoldRule style={s.barRule} />
          <View style={s.barRow}>
            <Text style={s.barLabel}>Subtotal</Text>
            <Text style={s.barTotal}>{inr(cart.totalPrice)}</Text>
          </View>
          <PremiumButton
            label={busy ? 'Please wait…' : 'Place order and pay'}
            onPress={placeOrder}
            loading={busy}
            disabled={missing.length > 0}
            icon="lock-closed"
            variant="noir"
            full
          />
          <View style={s.barTrust}>
            <Ionicons name="shield-checkmark-outline" size={12} color={noir.textFaint} />
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
  screen: { flex: 1, backgroundColor: noir.page },

  steps: { flexDirection: 'row', marginBottom: spacing.lg, paddingHorizontal: spacing.xs },
  step: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: noir.hairlineStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotOn: { backgroundColor: noir.green, borderColor: noir.gold },
  stepNum: { fontFamily: font.bold, fontSize: 11, color: noir.textFaint },
  stepLabel: { ...type.capsNoir, color: noir.textFaint },
  stepLine: { flex: 1, height: 1, backgroundColor: noir.hairlineStrong, marginHorizontal: 4 },

  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: noir.goldLine,
    alignItems: 'center', justifyContent: 'center',
  },

  label: { ...type.capsNoir, color: noir.textMuted, marginBottom: 6 },
  input: {
    backgroundColor: noir.page, borderRadius: radius.square, borderWidth: 1, borderColor: noir.hairlineStrong,
    paddingHorizontal: spacing.md, height: 50, fontFamily: font.regular, fontSize: 15,
    color: noir.text, marginBottom: spacing.md,
  },
  inputFocus: { borderColor: noir.gold },

  sumRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  sumImage: { width: 48, height: 48, borderRadius: radius.square },
  sumName: { fontFamily: font.serif, fontSize: 14, lineHeight: 18, color: noir.text },
  sumQty: { ...type.smallNoir, fontSize: 12, color: noir.textFaint },
  sumValue: { fontFamily: font.semibold, fontSize: 14, color: noir.text },
  sumTotal: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg,
    paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: noir.goldLine,
  },
  sumTotalLabel: { ...type.capsNoir, color: noir.textMuted },
  sumTotalValue: { fontFamily: font.heading, fontSize: 18, color: noir.text },
  secure: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.md,
    padding: spacing.md, borderRadius: radius.square, borderWidth: 1, borderColor: noir.hairline,
  },
  secureText: { ...type.smallNoir, fontSize: 12, flex: 1 },

  errorBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.lg,
    padding: spacing.md, borderRadius: radius.square, borderWidth: 1, borderColor: noir.sale,
  },
  error: { fontFamily: font.medium, fontSize: 13, color: noir.text, lineHeight: 19, flex: 1 },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: noir.glassStrong,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md,
  },
  barRule: { position: 'absolute', top: 0, left: 0, right: 0 },
  barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barLabel: { ...type.capsNoir, color: noir.textMuted },
  barTotal: { fontFamily: font.extrabold, fontSize: 20, color: noir.text },
  barTrust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  barTrustText: { fontFamily: font.medium, fontSize: 11, color: noir.textFaint },
});
