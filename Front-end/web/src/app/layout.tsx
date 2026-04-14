import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Suspense } from "react";
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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
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
