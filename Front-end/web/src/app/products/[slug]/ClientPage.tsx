'use client';

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
  stock: number;
  sku?: string;
  specifications?: Array<{ key: string; value: string }>;
  features?: string[];
  whyChoose?: string[];
  variableSpecs?: Array<{
    key: string;
    options: Array<{
      label: string;
      price: number;
      image?: string;
      images?: string[];
    }>;
  }>;
  compatibleVehicles?: Array<{
    make: string;
    model: string;
    year: string;
    variant: string;
  }>;
  packageContents?: string[];
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

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Heart, Star, GitCompare } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/context/CurrencyContext';
import ImageGallery from '@/components/products/ImageGallery';
import QuestionForm from '@/components/products/QuestionForm';
import QuestionList from '@/components/products/QuestionList';
import TrustBadges from '@/components/products/TrustBadges';
import RecentlyViewed from '@/components/products/RecentlyViewed';
import ShareButton from '@/components/products/ShareButton';
import { Reviews } from '@/components/reviews';
import apiClient from '@/lib/api';
import { toast } from 'react-hot-toast';
import SimilarProductsSection from '@/components/products/SimilarProductsSection';
import ComplementaryProductsSection from '@/components/products/ComplementaryProductsSection';
import ProductGallery from '@/components/products/ProductGallery';
import ProductInfo from '@/components/products/ProductInfo';
import BundleSection from '@/components/products/BundleSection';
import FeatureGrid from '@/components/products/FeatureGrid';
import CompatibilityList from '@/components/products/CompatibilityList';
import ProductFAQ from '@/components/products/ProductFAQ';
import StickyCartBar from '@/components/products/StickyCartBar';
import WhyChooseSection from '@/components/products/WhyChooseSection';
// New premium components
import HeroSection from '@/components/products/HeroSection';
import ActionStrip from '@/components/products/ActionStrip';
import FloatingCTACard from '@/components/products/FloatingCTACard';
import PremiumGallery from '@/components/products/PremiumGallery';
import FeatureAlternating from '@/components/products/FeatureAlternating';
import VehicleCards from '@/components/products/VehicleCards';
import ProductStory from '@/components/products/ProductStory';
import InstallationSteps from '@/components/products/InstallationSteps';
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
  stock: number;
  sku?: string;
  specifications?: Array<{ key: string; value: string }>;
  features?: string[];
  whyChoose?: string[];
  variableSpecs?: Array<{
    key: string;
    options: Array<{
      label: string;
      price: number;
      image?: string;
      images?: string[];
    }>;
  }>;
  compatibleVehicles?: Array<{
    make: string;
    model: string;
    year: string;
    variant: string;
  }>;
  packageContents?: string[];
  qna?: any;
  productStoryText?: string;
  productStoryCards?: Array<{ title: string; description: string }>;
  installationSteps?: Array<{ title: string; description: string }>;
  indianRoadsText?: string;
  indianRoadsCards?: Array<{ title: string; description: string }>;
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

  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, user } = useAuth();
  const { addToWishlist, removeFromWishlist, isInWishlist } = useWishlist();
  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);
  const [selectedSpecOption, setSelectedSpecOption] = useState<{ key: string; label: string; price: number; image?: string; images?: string[] } | null>(null);
  const [showQuestionForm, setShowQuestionForm] = useState(false);

  // Save theme preference
  useEffect(() => {
    localStorage.setItem('product-page-theme', isDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);

  const toggleTheme = () => setIsDark(!isDark);

  // Helper function to strip HTML tags
  const stripHtml = (html: string) => {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '');
  };

  // Helper function to parse description and extract "Why Choose" section
  const parseDescription = (description: string) => {
    if (!description) return { description: '', whyChoose: [] };
    
    const cleanDesc = stripHtml(description);
    
    // Check if "Why Choose" section exists in the description
    const whyChooseMatch = cleanDesc.match(/Why Choose[\s\S]*?$/i);
    
    if (whyChooseMatch) {
      const whyChooseSection = whyChooseMatch[0];
      const mainDescription = cleanDesc.substring(0, cleanDesc.indexOf(whyChooseSection)).trim();
      
      // Parse the why choose items (lines starting with bullet points or dashes)
      const whyChooseLines = whyChooseSection
        .split('\n')
        .filter(line => line.trim() && !line.trim().startsWith('Why Choose'))
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      return {
        description: mainDescription,
        whyChoose: whyChooseLines
      };
    }
    
    return {
      description: cleanDesc,
      whyChoose: []
    };
  };

  const { description: parsedDescription, whyChoose: extractedWhyChoose } = parseDescription(product?.description ?? '');
  
  // Use extracted whyChoose if product.whyChoose doesn't exist
  const displayWhyChoose = product?.whyChoose && product.whyChoose.length > 0
    ? product.whyChoose
    : extractedWhyChoose;

  // Get currently compared products from URL
  const comparedProductIds = searchParams.get('compare')?.split(',') || [];
  const isCompared = product ? comparedProductIds.includes(product._id) : false;

  useEffect(() => {
    if (product) {
      setIsWishlisted(isInWishlist(product._id));
    }
  }, [product, isInWishlist]);

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

  // Separate effect for initializing specs to avoid conflicts with other dependencies
  useEffect(() => {
    if (product) {
      const vs = Array.isArray(product.variableSpecs) ? product.variableSpecs : [];
      if (vs.length > 0 && Array.isArray(vs[0].options) && vs[0].options.length > 0) {
        setSelectedSpecOption({
          key: vs[0].key,
          label: vs[0].options[0].label,
          price: vs[0].options[0].price,
          image: vs[0].options[0].image,
          images: vs[0].options[0].images
        });
      } else {
        setSelectedSpecOption(null);
      }
    }
  }, [product?._id]); // Only re-run when product ID changes

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

  const displayImages = (() => {
    // If multiple images are assigned to the variant, use ONLY those (or prioritize them)
    // The user requirement "images related to that specific product will display" implies showing relevant images.
    // If we have variant images, we should show them.
    // If we want to show ONLY variant images, we return them.
    // If we want to show variant images FIRST, then others, we merge.
    // Let's assume "Prioritize" for now, as usually users still want to see general product shots.
    // Actually, "images related to that specific product" (singular product context, plural images) might mean "Show ONLY these".
    // But let's stick to "Prioritize" to be safe, or maybe filtered?
    // If I have a Red Shirt, I probably only want to see Red Shirt images.
    // Let's try to Prioritize first.
    
    let baseImages = product.images && product.images.length > 0 
      ? product.images.map((img: any, index: number) => ({
          id: img._id || index,
          src: img.url,
          alt: img.alt || `${product.name} image ${index + 1}`,
          name: img.alt
        }))
      : [];

    if (selectedSpecOption?.images && selectedSpecOption.images.length > 0) {
      // We have specific images for this variant.
      // Filter baseImages to find matches and move them to top, OR create new entries if they are not in baseImages.
      // Actually, if we have specific images, maybe we should just show those?
      // "when each variant is selected the images related to that specific product will display"
      // Let's go with: Show Variant Images + Remaining Base Images (sorted to bottom)
      
      const variantImageUrls = selectedSpecOption.images;
      const variantImages: any[] = [];
      const otherImages: any[] = [];
      
      // Split base images into variant-matching and others
      baseImages.forEach((img: any) => {
        if (variantImageUrls.includes(img.src)) {
          variantImages.push(img);
        } else {
          otherImages.push(img);
        }
      });
      
      // Also check if there are any URLs in variantImageUrls that were NOT in baseImages (unlikely if selected from existing, but possible)
      variantImageUrls.forEach((url: string) => {
        if (!variantImages.find(img => img.src === url)) {
           variantImages.push({
             id: url,
             src: url,
             alt: selectedSpecOption.label,
             name: selectedSpecOption.label
           });
        }
      });
      
      // Sort variant images based on the order in selectedSpecOption.images
      variantImages.sort((a, b) => {
        return variantImageUrls.indexOf(a.src) - variantImageUrls.indexOf(b.src);
      });
      
      return [...variantImages, ...otherImages];
    }

    // Fallback for single image legacy support
    if (selectedSpecOption?.image) {
      const existingIndex = baseImages.findIndex((img: any) => img.src === selectedSpecOption.image);
      if (existingIndex !== -1) {
        const [item] = baseImages.splice(existingIndex, 1);
        baseImages.unshift(item);
      } else {
        baseImages.unshift({
          id: 'variant-image',
          src: selectedSpecOption.image,
          alt: selectedSpecOption.label,
          name: selectedSpecOption.label
        });
      }
    }
    
    return baseImages;
  })();

  const handleWishlistToggle = async () => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    if (!product) return;

    setWishlistLoading(true);
    try {
      if (isWishlisted) {
        await removeFromWishlist(product._id);
        toast.success('Removed from wishlist');
      } else {
        await addToWishlist(product._id);
        toast.success('Added to wishlist');
      }
      setIsWishlisted(!isWishlisted);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update wishlist');
    } finally {
      setWishlistLoading(false);
    }
  };

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    if (!product) return;

    setCartLoading(true);
    try {
      await addToCart(product._id, 1);
      toast.success('Added to cart!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to add to cart');
    } finally {
      setCartLoading(false);
    }
  };

  const toggleCompare = () => {
    if (!product) return;
    
    const currentParams = new URLSearchParams(searchParams.toString());
    const compareList = [...comparedProductIds];
    
    if (compareList.includes(product._id)) {
      // Remove from comparison
      const index = compareList.indexOf(product._id);
      compareList.splice(index, 1);
    } else {
      // Add to comparison (limit to 4 products)
      if (compareList.length >= 4) {
        toast.error('You can only compare up to 4 products at a time.');
        return;
      }
      compareList.push(product._id);
    }
    
    if (compareList.length > 0) {
      currentParams.set('compare', compareList.join(','));
    } else {
      currentParams.delete('compare');
    }
    
    // Update URL without reloading the page
    const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
    router.replace(newUrl, { scroll: false });
  };

  const viewComparison = () => {
    if (comparedProductIds.length < 2) {
      alert('Please select at least 2 products to compare.');
      return;
    }
    router.push(`/compare?ids=${comparedProductIds.join(',')}`);
  };

  if (!product) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Product Not Found</h1>
          <Link href="/products" className="text-[#3B9EE8] hover:text-white font-condensed font-bold uppercase tracking-widest transition-colors">
            Back to Products
          </Link>
        </div>
      </div>
    );
  }

  // Check if this is a sample product with placeholder image
  const hasPlaceholderImage = product.images && product.images.length > 0 && 
    product.images[0].url && product.images[0].url.includes('example.com');

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

      {/* Action Strip */}
      <ActionStrip isDark={isDark} />

      <div className="w-full px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Product Story Section */}
        <ProductStory productName={product.name} storyText={product.productStoryText} storyCards={product.productStoryCards} isDark={isDark} />

        {/* Vehicle Compatibility */}
        <section className="py-16">
          <h2 className={`text-4xl lg:text-5xl font-black mb-8 text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Vehicle Compatibility
          </h2>
          <VehicleCards vehicles={product.compatibleVehicles} isDark={isDark} />
        </section>

        {/* Bundle Section */}
        <section className="py-16">
          <BundleSection 
            productId={product._id}
            mainProductName={product.name}
            mainProductPrice={product.price}
            isDark={isDark}
          />
        </section>

        {/* Installation Steps */}
        <InstallationSteps steps={product.installationSteps} isDark={isDark} />

        {/* Product Description */}
        <section className={`py-16 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
          <div className="max-w-4xl mx-auto">
            <h2 className={`text-3xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>Product Description</h2>
            <div className={`prose prose-lg max-w-none leading-relaxed whitespace-pre-line ${isDark ? 'prose-invert text-zinc-300' : 'text-gray-700'}`}>
              {parsedDescription}
            </div>
          </div>
        </section>

        {/* Why Choose Section */}
        {displayWhyChoose && displayWhyChoose.length > 0 && (
          <section className={`py-16 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
            <div className="max-w-4xl mx-auto">
              <h2 className={`text-3xl font-bold mb-8 ${isDark ? 'text-white' : 'text-gray-900'}`}>Why Choose {product.name}?</h2>
              <div className="space-y-4">
                {displayWhyChoose.map((item: string, index: number) => {
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

        {/* Product Details - Indian Use Cases, Features, Specs */}
        <section className={`py-16 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-12">

              {/* Indian Roads & Climate Section */}
              <section>
                <h2 className={`text-3xl font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>Perfect for Indian Roads &amp; Climate</h2>
                <p className={`text-lg mb-8 leading-relaxed ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                  {product.indianRoadsText || `This ${product.name} is specifically designed to handle the unique challenges of Indian roads and climate conditions.`}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(product.indianRoadsCards && product.indianRoadsCards.length > 0
                    ? product.indianRoadsCards
                    : [
                        { title: 'Monsoon Ready',            description: 'Water-resistant construction ensures reliable performance during heavy rains and flooding' },
                        { title: 'Summer Heat Resistant',    description: "High-temperature materials withstand India's intense summer heat up to 45°C" },
                        { title: 'Road Condition Optimized', description: 'Engineered for Indian road surfaces including potholes, speed breakers, and uneven terrain' },
                        { title: 'Local Support',            description: 'Professional installation available at all Autobacs service centers across India' },
                      ]
                  ).map((card: { title: string; description: string }, i: number) => (
                    <div
                      key={i}
                      className={`rounded-xl p-5 border ${isDark ? 'bg-white/10 border-white/20' : 'bg-gray-50 border-gray-200'}`}
                    >
                      <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center mb-3">
                        <div className="w-3 h-3 rounded-full bg-orange-500" />
                      </div>
                      <h3 className={`font-bold mb-2 text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{card.title}</h3>
                      <p className={`text-xs leading-relaxed ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>{card.description}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Key Features */}
              {product.features && product.features.length > 0 && (
                <section>
                  <h2 className={`text-3xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>Key Features</h2>
                  <ul className={`list-disc space-y-2 pl-5 marker:text-orange-500 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                    {product.features.map((feature: string, index: number) => (
                      <li key={index} className="leading-relaxed pl-1">
                        {feature}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              
              {/* Technical Specifications */}
              {product.specifications && product.specifications.length > 0 && (
                <section>
                  <h2 className={`text-3xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>Technical Specifications</h2>
                  <div className={`rounded-2xl p-6 sm:p-8 ${isDark ? 'bg-zinc-800/50 border border-zinc-700' : 'bg-gray-100 border border-gray-300'}`}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-4">
                      {product.specifications.map((spec: any, index: number) => (
                        <div key={index} className={`flex justify-between border-b py-3 last:border-0 ${isDark ? 'border-zinc-700' : 'border-gray-300'}`}>
                          <span className={`font-medium ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>{spec.key}</span>
                          <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{spec.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </div>

            {/* Sidebar - What's in the Box & Q&A */}
            <div className="lg:col-span-1 space-y-8">
              {/* What's in the Box */}
              {product.packageContents && product.packageContents.length > 0 && (
                <section>
                  <h2 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>What's in the Box</h2>
                  <div className={`rounded-xl p-6 ${isDark ? 'bg-zinc-800/50 border border-zinc-700' : 'bg-white border border-gray-200'}`}>
                    <ul className="space-y-3">
                      {product.packageContents.map((item: string, index: number) => (
                        <li key={index} className={`flex items-center gap-3 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                          <span className="h-5 w-5 rounded-full border border-orange-500 flex items-center justify-center text-orange-500 text-xs">✓</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              {/* Questions & Answers */}
              <section id="qa">
                <div className="flex items-center justify-between mb-6">
                  <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Questions & Answers</h2>
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
                    <QuestionForm 
                      productId={product._id} 
                      onSuccess={() => {
                        // Keep the success message visible
                      }} 
                    />
                  </div>
                )}

                <QuestionList productId={product._id} legacyQna={product.qna} />
              </section>
            </div>
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

        {/* FAQ Section */}
        <section className="py-16">
          <ProductFAQ isDark={isDark} />
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
