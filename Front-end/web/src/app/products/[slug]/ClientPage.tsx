'use client';

import type { StockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import QuestionForm from '@/components/products/QuestionForm';
import QuestionList from '@/components/products/QuestionList';
import { Reviews } from '@/components/reviews';
import apiClient from '@/lib/api';
import { trackProductView } from '@/lib/analytics';
import SimilarProductsSection from '@/components/products/SimilarProductsSection';
import ComplementaryProductsSection from '@/components/products/ComplementaryProductsSection';
import StickyCartBar from '@/components/products/StickyCartBar';
import HeroSection from '@/components/products/HeroSection';
import FloatingCTACard from '@/components/products/FloatingCTACard';
import PremiumGallery from '@/components/products/PremiumGallery';
import VehicleCards from '@/components/products/VehicleCards';
import ThemeToggle from '@/components/products/ThemeToggle';

async function getProduct(slugOrId: string): Promise<any> {
  // Resolve exclusively via slug endpoint (canonical SEO URL)
  try {
    const response: any = await apiClient.get(`/products/slug/${encodeURIComponent(slugOrId)}`);
    if (response?.product) return response.product;
  } catch (slugError: any) {
    if (slugError?.status !== 404) {
      console.error('Slug lookup error:', slugError);
    }
  }
  return null;
}

interface Product {
  _id: string;
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  category?: { 
    _id: string;
    name: string;
    slug: string;
  } | string;
  brand?: string;
  images?: Array<{ url: string; alt?: string }>
  stock: StockStatus;
  sku?: string;
  specifications?: Array<{ key: string; value: string }>;
  features?: string[];
  whyChoose?: string[];
  compatibleVehicles?: Array<{
    make: string;
    model: string;
  }>;
  qna?: any;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  __v?: number;
  slug?: string;
}

export function ProductDetailPageClient({ product }: { product: Product | null }) {
  // Theme state
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('product-page-theme');
      return saved !== 'light'; // Default to dark
    }
    return true;
  });

  const { isAuthenticated, user } = useAuth();
  const [showQuestionForm, setShowQuestionForm] = useState(false);

  // Save theme preference
  useEffect(() => {
    localStorage.setItem('product-page-theme', isDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);

  const toggleTheme = () => setIsDark(!isDark);

  // Strip any residual HTML tags from the (now intro-only) description.
  const stripHtml = (html: string) => (html ? html.replace(/<[^>]*>/g, '') : '');

  // Save to recently viewed
  useEffect(() => {
    if (product) {
      try {
        const storageKey = user ? `recentlyViewed_${user._id}` : 'recentlyViewed_guest';
        const recent = JSON.parse(localStorage.getItem(storageKey) || '[]');
        // Remove duplicate if exists
        const filtered = recent.filter((p: any) => p._id !== product._id);
        // Add to front
        const newRecent = [{
          _id: product._id,
          name: product.name,
          price: product.price,
          originalPrice: product.originalPrice,
          image: product.images?.[0]?.url,
          slug: product.slug || ''
        }, ...filtered].slice(0, 10); // Keep last 10

        localStorage.setItem(storageKey, JSON.stringify(newRecent));
      } catch (e) {
        console.error('Failed to save recently viewed', e);
      }
    }
  }, [product, user]);

  // Analytics: product_view (once per product) — ADR-005
  useEffect(() => {
    if (product?._id) {
      trackProductView({ id: product._id, name: product.name, price: product.price, brand: (product as any).brand });
    }
  }, [product?._id]);

  // Null guard — placed after all hooks so hook order stays stable (rules-of-hooks).
  if (!product) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#3B9EE8] mx-auto"></div>
          <p className="mt-4 text-[#C4C4C4] font-body">Loading product...</p>
        </div>
      </div>
    );
  }

  const displayImages = (product.images && product.images.length > 0)
    ? product.images.map((img: any, index: number) => ({
        id: img._id || index,
        src: img.url,
        alt: img.alt || `${product.name} image ${index + 1}`,
        name: img.alt,
      }))
    : [];

  const cleanDescription = stripHtml(product.description);
  const features = product.features ?? [];
  const whyChoose = product.whyChoose ?? [];
  const specifications = product.specifications ?? [];

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDark ? 'bg-zinc-950' : 'bg-gray-50'}`}>
      {/* Theme Toggle */}
      <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
      
      {/* Premium Gallery - Moved to Top */}
      <section className="pt-24 pb-16">
        <PremiumGallery
          images={displayImages}
          productName={product.name}
          isDark={isDark}
        />
      </section>

      {/* Hero Section */}
      <HeroSection product={product} />

      {/* Mobile purchase panel — FloatingCTACard is desktop-only inside the hero
          (hidden lg:block), so on mobile we render it here below the hero image. */}
      <div className="lg:hidden bg-zinc-950 px-4 pt-6 pb-8">
        <FloatingCTACard product={product} />
      </div>

      <div className="w-full px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Vehicle Compatibility — only when the product has real fitment data */}
        {product.compatibleVehicles && product.compatibleVehicles.length > 0 && (
          <section className="py-16">
            <h2 className={`text-4xl lg:text-5xl font-black mb-8 text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Vehicle Compatibility
            </h2>
            <VehicleCards vehicles={product.compatibleVehicles} isDark={isDark} />
          </section>
        )}

        {/* Product Description (intro) */}
        {cleanDescription && (
          <section className={`py-16 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
            <div className="max-w-4xl mx-auto">
              <h2 className={`text-3xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>Product Description</h2>
              <div className={`prose prose-lg max-w-none leading-relaxed whitespace-pre-line ${isDark ? 'prose-invert text-zinc-300' : 'text-gray-700'}`}>
                {cleanDescription}
              </div>
            </div>
          </section>
        )}

        {/* Key Features */}
        {features.length > 0 && (
          <section className={`py-16 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
            <div className="max-w-4xl mx-auto">
              <h2 className={`text-3xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>Key Features</h2>
              <ul className={`list-disc space-y-2 pl-5 marker:text-orange-500 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                {features.map((feature: string, index: number) => (
                  <li key={index} className="leading-relaxed pl-1">{feature}</li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Why Choose */}
        {whyChoose.length > 0 && (
          <section className={`py-16 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
            <div className="max-w-4xl mx-auto">
              <h2 className={`text-3xl font-bold mb-8 ${isDark ? 'text-white' : 'text-gray-900'}`}>Why Choose {product.name}?</h2>
              <div className="space-y-4">
                {whyChoose.map((item: string, index: number) => {
                  const separator = item.includes(' – ') ? ' – ' : (item.includes(' - ') ? ' - ' : null);

                  if (separator) {
                    const [title, ...rest] = item.split(separator);
                    const description = rest.join(separator);
                    return (
                      <div key={index} className={`leading-relaxed ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                        <span className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{title}</span>
                        <span>{separator}{description}</span>
                      </div>
                    );
                  }

                  return (
                    <p key={index} className={`leading-relaxed ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                      {item}
                    </p>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Technical Specifications */}
        {specifications.length > 0 && (
          <section className={`py-16 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
            <div className="max-w-4xl mx-auto">
              <h2 className={`text-3xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>Technical Specifications</h2>
              <div className={`rounded-2xl p-6 sm:p-8 ${isDark ? 'bg-zinc-800/50 border border-zinc-700' : 'bg-gray-100 border border-gray-300'}`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-4">
                  {specifications.map((spec: any, index: number) => (
                    <div key={index} className={`flex justify-between border-b py-3 last:border-0 ${isDark ? 'border-zinc-700' : 'border-gray-300'}`}>
                      <span className={`font-medium ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>{spec.key}</span>
                      <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{spec.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Questions & Answers */}
        <section id="qa" className={`py-16 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Questions & Answers</h2>
              {!showQuestionForm && (
                <button
                  onClick={() => setShowQuestionForm(true)}
                  className="text-orange-500 font-medium hover:text-orange-400"
                >
                  Ask a Question
                </button>
              )}
            </div>

            {showQuestionForm && (
              <div className="mb-8">
                <QuestionForm productId={product._id} onSuccess={() => { /* keep success message visible */ }} />
              </div>
            )}

            <QuestionList productId={product._id} />
          </div>
        </section>

        {/* Customer Reviews */}
        <section className="py-16" id="reviews">
          <h2 className={`text-4xl lg:text-5xl font-black mb-8 text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Customer Reviews
          </h2>
          <Reviews
            productId={product._id}
            isAuthenticated={isAuthenticated}
          />
        </section>

        {/* Similar Products Section */}
        <section className="py-16">
          <SimilarProductsSection productId={product._id} isDark={isDark} />
        </section>

        {/* Complementary Products Section */}
        <section className="py-16">
          <ComplementaryProductsSection productId={product._id} isDark={isDark} />
        </section>
      </div>

      {/* Sticky Cart Bar for Mobile */}
      <StickyCartBar product={product} isDark={isDark} />
    </div>
  );
}

export default function ClientPage({
  slug,
}: {
  slug: string;
}) {
  const router = useRouter();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProduct() {
      setLoading(true);
      const fetchedProduct = await getProduct(slug);
      setProduct(fetchedProduct);
      setLoading(false);

      // Client-side canonical redirect: if the URL segment looks like a MongoDB ObjectId
      // but the product resolved to a real slug, replace URL to preserve back-button UX
      // (backend already issues HTTP 301 for direct hits; this handles in-app navigation)
      if (fetchedProduct?.slug && fetchedProduct.slug !== slug) {
        router.replace(`/products/${fetchedProduct.slug}`, { scroll: false });
      }
    }

    fetchProduct();
  }, [slug, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#3B9EE8] mx-auto"></div>
          <p className="mt-4 text-[#C4C4C4] font-body">Loading product...</p>
        </div>
      </div>
    );
  }

  // Product not found
  if (!product) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="text-6xl mb-4">🔍</div>
          <h2 className="text-2xl font-condensed font-bold text-white uppercase tracking-wide mb-2">Product Not Found</h2>
          <p className="text-[#C4C4C4] font-body mb-6">
            The product you&apos;re looking for doesn&apos;t exist or has been removed.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/products"
              className="inline-flex items-center px-6 py-3 bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest rounded-sm transition-colors"
            >
              Browse Products
            </Link>
            <Link
              href="/"
              className="inline-flex items-center px-6 py-3 bg-[#161616] border border-[#252525] text-[#C4C4C4] hover:text-white font-condensed font-bold uppercase tracking-widest rounded-sm transition-colors"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <ProductDetailPageClient product={product} />;
}
