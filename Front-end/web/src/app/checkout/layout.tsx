import { Metadata } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';

// SEO: Prevent indexing but allow following links (preserves link equity)
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
};

export default async function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Same nonce contract as the root layout: middleware.ts mints it per request
  // and forwards it as x-nonce, and the strict CSP (lib/csp.ts) blocks any
  // script without it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <>
      {children}
      {/*
        Razorpay checkout lives HERE, not in the root layout.

        It used to be mounted globally, so every route paid for it: measured on
        the live home page it pulled 175 requests / 1.36 MB — on a page where
        nobody can pay. Scoping it to /checkout keeps the pre-warm exactly where
        the money path needs it.

        Removing it outright would also have worked — hooks/useRazorpay.ts has
        its own idempotent, nonce-aware loader and awaits it before opening the
        modal, and that is what now covers the rarer retry-payment path on
        /orders/[id]. But this is the hot path, and making a customer wait on a
        cold script fetch at the moment they click Pay trades reliability for
        bytes on a page whose bytes are not the problem. Pre-warm here, load on
        demand everywhere else.
      */}
      <Script
        id="razorpay-checkout"
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
        nonce={nonce}
      />
    </>
  );
}
