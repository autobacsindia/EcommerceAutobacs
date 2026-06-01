import type { Metadata } from "next";
import { Barlow_Condensed, DM_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { LocationProvider } from "@/contexts/LocationContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { RateLimitProvider } from "@/contexts/RateLimitContext";
import { LogRocketProvider } from "@/providers/LogRocketProvider";
import { Toaster } from "react-hot-toast";
import GlobalLoadingBar from "@/components/layout/GlobalLoadingBar";
import ConditionalHeader from "@/components/layout/ConditionalHeader";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        className={`${barlowCondensed.variable} ${dmSans.variable} antialiased`}
      >
        <LogRocketProvider>
          <AuthProvider>
            <CartProvider>
              <WishlistProvider>
                <RateLimitProvider>
                  <LocationProvider>
                    <CurrencyProvider>
                      <GlobalLoadingBar />
                      <ConditionalHeader />
                      <main className="flex-1 flex flex-col min-h-screen">{children}</main>
                      <ConditionalFooter />
                      <Toaster position="top-right" />
                      <Script
                        id="razorpay-checkout"
                        src="https://checkout.razorpay.com/v1/checkout.js"
                        strategy="lazyOnload"
                      />
                    </CurrencyProvider>
                  </LocationProvider>
                </RateLimitProvider>
              </WishlistProvider>
            </CartProvider>
          </AuthProvider>
        </LogRocketProvider>
      </body>
    </html>
  );
}
