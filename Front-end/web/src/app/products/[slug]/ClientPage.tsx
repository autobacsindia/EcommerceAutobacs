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
import { useCurrency } from '@/contexts/CurrencyContext';
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
import PremiumGallery from '@/components/products/PremiumGallery';
import FeatureAlternating from '@/components/products/FeatureAlternating';
import VehicleCards from '@/components/products/VehicleCards';
import ProductStory from '@/components/products/ProductStory';
import InstallationSteps from '@/components/products/InstallationSteps';

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
  // Defensive null safety check
  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading product...</p>
        </div>
      </div>
    );
  }
  
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

  // Helper function to strip HTML tags
  const stripHtml = (html: string) => {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '');
  };

  // Show loading state if product is null
  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading product...</p>
        </div>
      </div>
    );
  }

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Product Not Found</h1>
          <Link href="/products" className="text-blue-600 hover:text-blue-700">
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
    <div className="min-h-screen bg-zinc-950">
      {/* Hero Section */}
      <HeroSection product={product} />

      {/* Action Strip */}
      <ActionStrip />

      <div className="w-full px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Premium Gallery */}
        <section className="py-16">
          <PremiumGallery
            images={displayImages}
            productName={product.name}
          />
        </section>

        {/* Product Story Section */}
        <ProductStory productName={product.name} />

        {/* Features - Alternating Layout */}
        <FeatureAlternating />

        {/* Vehicle Compatibility */}
        <section className="py-16">
          <h2 className="text-4xl lg:text-5xl font-black text-white mb-8 text-center">
            Vehicle Compatibility
          </h2>
          <VehicleCards vehicles={product.compatibleVehicles} />
        </section>

        {/* Bundle Section */}
        <section className="py-16">
          <BundleSection 
            productId={product._id}
            mainProductName={product.name}
            mainProductPrice={product.price}
          />
        </section>

        {/* Installation Steps */}
        <InstallationSteps />

        {/* Customer Reviews */}
        <section className="py-16" id="reviews">
          <h2 className="text-4xl lg:text-5xl font-black text-white mb-8 text-center">
            Customer Reviews
          </h2>
          <Reviews 
            productId={product._id} 
            isAuthenticated={isAuthenticated} 
          />
        </section>
        
        {/* Similar Products Section */}
        <section className="py-16">
          <SimilarProductsSection productId={product._id} />
        </section>
        
        {/* Complementary Products Section */}
        <section className="py-16">
          <ComplementaryProductsSection productId={product._id} />
        </section>

        {/* FAQ Section */}
        <section className="py-16">
          <ProductFAQ />
        </section>
      </div>

      {/* Sticky Cart Bar for Mobile */}
      <StickyCartBar product={product} />
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading product...</p>
        </div>
      </div>
    );
  }

  // Product not found
  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">🔍</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Product Not Found</h2>
          <p className="text-gray-600 mb-6">
            The product you're looking for doesn't exist or has been removed.
          </p>
          <div className="space-x-4">
            <Link 
              href="/products" 
              className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Browse Products
            </Link>
            <Link 
              href="/" 
              className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
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
