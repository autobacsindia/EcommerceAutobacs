import type { Metadata } from "next";
import { Barlow_Condensed, DM_Sans } from "next/font/google";
import Script from "next/script";
import { headers } from "next/headers";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { LocationProvider } from "@/context/LocationContext";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { RateLimitProvider } from "@/context/RateLimitContext";
import { LogRocketProvider } from "@/providers/LogRocketProvider";
import { PostHogProvider } from "@/providers/PostHogProvider";
import { Toaster } from "react-hot-toast";
import GlobalLoadingBar from "@/components/layout/GlobalLoadingBar";
import ConditionalHeader from "@/components/layout/ConditionalHeader";
import { getNavCategories } from "@/lib/navCategories";
import ConditionalFooter from "@/components/layout/ConditionalFooter";

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: {
    default: "Autobacs India | Premium Automotive Accessories",
    template: "%s | Autobacs India"
  },
  description: "Shop premium automotive accessories, body kits, and performance parts from India's trusted auto parts retailer",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  
  // Canonical URL
  alternates: {
    canonical: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    languages: {
      'en-IN': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'en': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    },
  },
  
  // Open Graph metadata for social sharing
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    siteName: "Autobacs India",
    title: "Autobacs India | Premium Automotive Accessories",
    description: "Shop premium automotive accessories, body kits, and performance parts from India's trusted auto parts retailer",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Autobacs India - Premium Automotive Accessories",
      },
    ],
  },
  
  // Twitter Card metadata
  twitter: {
    card: "summary_large_image",
    title: "Autobacs India | Premium Automotive Accessories",
    description: "Shop premium automotive accessories, body kits, and performance parts",
    images: ["/og-image.jpg"],
    creator: "@autobacsindia",
    site: "@autobacsindia",
  },
  
  // Additional metadata
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  
  // Verification
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || '',
  },
  
  // FAQ Schema for common automotive questions
  other: {
    'application/ld+json': JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': [
        {
          '@type': 'Question',
          'name': 'What types of automotive accessories do you sell?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'We sell premium automotive accessories including body kits, performance parts, lighting solutions, interior accessories, and vehicle-specific modifications for Indian vehicles.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Do you offer installation services for automotive accessories?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Yes, we offer professional installation services for most automotive accessories at our authorized service centers across India.'
          }
        },
        {
          '@type': 'Question',
          'name': 'What is your return policy for automotive accessories?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'We offer a 30-day return policy for unused and uninstalled automotive accessories. Items must be in original packaging with all components included.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Do you ship automotive accessories across India?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Yes, we provide nationwide shipping for automotive accessories with free shipping on orders over ₹2,500.'
          }
        },
        {
          '@type': 'Question',
          'name': 'How do I choose the right automotive accessories for my vehicle?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Our vehicle-specific product mapping ensures compatibility. You can filter products by your vehicle make, model, and year to find perfectly compatible accessories.'
          }
        }
      ]
    })
  }
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the nonce that middleware.ts generated for this request and forwarded
  // via the x-nonce request header. Pass it to <Script> so the Razorpay script
  // is trusted by the nonce-based CSP, and expose it in a <meta> tag so that
  // client-side code (useRazorpay) can read it when creating dynamic scripts.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  // Resolve the header category nav server-side (data-driven, cached) so it
  // stays in sync with admin-managed categories and renders in the SSR HTML.
  const navCategories = await getNavCategories();

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {nonce && <meta name="csp-nonce" content={nonce} />}
      </head>
      <body
        className={`${barlowCondensed.variable} ${dmSans.variable} antialiased`}
      >
        <LogRocketProvider>
          <PostHogProvider>
          <AuthProvider>
            <CartProvider>
              <WishlistProvider>
                <RateLimitProvider>
                  <LocationProvider>
                    <CurrencyProvider>
                      <GlobalLoadingBar />
                      <ConditionalHeader navCategories={navCategories} />
                      <main className="flex-1 flex flex-col min-h-screen">{children}</main>
                      <ConditionalFooter />
                      <Toaster position="top-right" />
                      <Script
                        id="razorpay-checkout"
                        src="https://checkout.razorpay.com/v1/checkout.js"
                        strategy="lazyOnload"
                        nonce={nonce}
                      />
                    </CurrencyProvider>
                  </LocationProvider>
                </RateLimitProvider>
              </WishlistProvider>
            </CartProvider>
          </AuthProvider>
          </PostHogProvider>
        </LogRocketProvider>
      </body>
    </html>
  );
}
