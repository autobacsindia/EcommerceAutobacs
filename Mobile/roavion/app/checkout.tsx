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
import { Button, Card, Screenful, T } from '../src/components/ui';
import { colors, font, inr, radius, spacing } from '../src/theme';
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
      name: 'Roavion',
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
        <Screenful
          emptyIcon="checkmark-circle-outline"
          emptyTitle="Thank you — your order is placed"
          emptyBody="We have emailed your confirmation. You can follow it in My orders."
          action={{ label: 'View my orders', onPress: () => router.replace('/orders') }}
        />
      </>
    );
  }

  if (!cart.items.length) {
    return (
      <>
        <Stack.Screen options={{ title: 'Checkout' }} />
        <Screenful
          emptyIcon="cart-outline"
          emptyTitle="Your cart is empty"
          action={{ label: 'Start shopping', onPress: () => router.replace('/(tabs)/shop') }}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 200 }} keyboardShouldPersistTaps="handled">
          <Card>
            <T kind="h3">Delivery address</T>
            <View style={{ marginTop: spacing.md }}>
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
                    style={s.input}
                    placeholder={placeholder}
                    placeholderTextColor={colors.muted}
                    keyboardType={key === 'phone' || key === 'postalCode' ? 'number-pad' : 'default'}
                    maxLength={key === 'postalCode' ? 6 : key === 'phone' ? 16 : 120}
                    accessibilityLabel={label}
                  />
                </View>
              ))}
            </View>
          </Card>

          <Card style={{ marginTop: spacing.lg }}>
            <T kind="h3">Order summary</T>
            {cart.items.map((i) => (
              <View key={`${i.productId}-${i.variantId ?? 'base'}`} style={s.sumRow}>
                <Text style={s.sumName} numberOfLines={1}>{i.quantity} × {i.name}</Text>
                <Text style={s.sumValue}>{inr(i.price * i.quantity)}</Text>
              </View>
            ))}
            <View style={s.sumTotal}>
              <Text style={s.sumTotalLabel}>Subtotal</Text>
              <Text style={s.sumTotalValue}>{inr(cart.totalPrice)}</Text>
            </View>
            <View style={s.secure}>
              <Ionicons name="lock-closed" size={13} color={colors.green} />
              <T kind="tiny">
                Delivery and taxes are added by our server on the payment screen. You always pay the amount Razorpay shows.
              </T>
            </View>
          </Card>

          {!!error && <Text style={s.error}>{error}</Text>}
        </ScrollView>

        <View style={[s.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button
            label={busy ? 'Please wait…' : 'Place order and pay'}
            onPress={placeOrder}
            loading={busy}
            disabled={missing.length > 0}
            icon="lock-closed"
            full
          />
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
  label: { fontFamily: font.semibold, fontSize: 12.5, color: colors.ink2, marginBottom: 5 },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: spacing.md, height: 46, fontFamily: font.regular, fontSize: 14.5,
    color: colors.ink, marginBottom: spacing.md,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.sm },
  sumName: { flex: 1, fontFamily: font.regular, fontSize: 13.5, color: colors.ink2 },
  sumValue: { fontFamily: font.medium, fontSize: 13.5, color: colors.ink },
  sumTotal: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md,
    paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line,
  },
  sumTotalLabel: { fontFamily: font.semibold, fontSize: 15, color: colors.ink },
  sumTotalValue: { fontFamily: font.bold, fontSize: 17, color: colors.ink },
  secure: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: spacing.md },
  error: { fontFamily: font.medium, fontSize: 13, color: colors.red, marginTop: spacing.lg, lineHeight: 19 },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card,
    borderTopWidth: 1, borderTopColor: colors.line, padding: spacing.lg,
  },
});
