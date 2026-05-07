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
    <div className="min-h-screen bg-white py-8">
      {/* Compare Bar */}
      {comparedProductIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg p-4">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center">
              <GitCompare className="h-5 w-5 text-blue-600 mr-2" />
              <span className="text-gray-900 font-medium">
                {comparedProductIds.length} product{comparedProductIds.length !== 1 ? 's' : ''} selected for comparison
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const currentParams = new URLSearchParams(searchParams.toString());
                  currentParams.delete('compare');
                  const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
                  router.replace(newUrl, { scroll: false });
                }}
                className="text-gray-600 hover:text-gray-900 font-medium px-4 py-2"
              >
                Clear
              </button>
              <button
                onClick={viewComparison}
                className="bg-blue-600 text-white px-6 py-2 rounded-full hover:bg-blue-700 transition-colors font-medium"
              >
                Compare Now
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="w-full px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-8 text-sm text-gray-500" aria-label="Breadcrumb">
          <ol className="inline-flex items-center space-x-2">
            <li>
              <Link href="/" className="hover:text-blue-600 transition-colors">Home</Link>
            </li>
            <li><span className="mx-2">/</span></li>
            <li>
              <Link href="/products" className="hover:text-blue-600 transition-colors">Products</Link>
            </li>
            {product.category && (
              <>
                <li><span className="mx-2">/</span></li>
                <li>
                  <Link 
                    href={`/categories/${typeof product.category === 'string' ? product.category : product.category.slug || ''}`} 
                    className="hover:text-blue-600 transition-colors"
                  >
                    {typeof product.category === 'string' ? product.category : product.category.name || 'Category'}
                  </Link>
                </li>
              </>
            )}
            <li><span className="mx-2">/</span></li>
            <li>
              <span className="text-gray-900 font-medium" aria-current="page">{product.name}</span>
            </li>
          </ol>
        </nav>

        {/* Top Section: Title, Price, Images, Purchase Options */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
          {/* Left: Images */}
          <div>
            <ImageGallery
              images={displayImages}
              className="sticky top-8"
            />
          </div>

          {/* Right: Product Details & Purchase */}
          <div className="flex flex-col">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">{product.name}</h1>
            
            {/* Rating & Reviews Link */}
            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center gap-1">
                <div className="flex text-yellow-400">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`h-5 w-5 ${star <= (product.averageRating || 0) ? 'fill-current' : 'text-gray-200'}`}
                    />
                  ))}
                </div>
                <span className="text-sm font-medium text-gray-900 ml-2">{product.averageRating || 0}</span>
              </div>
              <span className="text-gray-300">|</span>
              <a href="#reviews" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                {product.totalReviews || 0} Reviews
              </a>
              <span className="text-gray-300">|</span>
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  setShowQuestionForm(true);
                  document.getElementById('qa')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Ask a Question
              </button>
            </div>

            {/* Price */}
            <div className="mb-8">
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-gray-900">
                  {formatPrice(selectedSpecOption?.price ?? product.price ?? 0)}
                </span>
                {product.originalPrice && product.originalPrice > product.price && (
                  <span className="text-xl text-gray-400 line-through">
                    {formatPrice(product.originalPrice)}
                  </span>
                )}
                {product.originalPrice && product.originalPrice > product.price && (
                  <span className="text-sm font-bold text-green-600 bg-green-50 px-2 py-1 rounded">
                    {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% OFF
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-2">Inclusive of all taxes</p>
            </div>

            {/* Short Description */}
            {product.shortDescription && (
              <p className="text-gray-600 mb-8 leading-relaxed">
                {product.shortDescription}
              </p>
            )}

            {/* Variable Specifications */}
            {Array.isArray(product.variableSpecs) && product.variableSpecs.length > 0 && (
              <div className="mb-8 border-t border-b border-gray-100 py-6">
                {product.variableSpecs.map((specGroup: any, gi: number) => (
                  <div key={gi}>
                    <label className="block text-sm font-medium text-gray-900 mb-3">
                      {specGroup.key}
                    </label>
                    <div className="flex flex-wrap gap-3">
                      {specGroup.options.map((opt: any, oi: number) => {
                        const selected = selectedSpecOption && selectedSpecOption.key === specGroup.key && selectedSpecOption.label === opt.label;
                        return (
                          <button
                            key={oi}
                            type="button"
                            onClick={() => setSelectedSpecOption({ 
                              key: specGroup.key, 
                              label: opt.label, 
                              price: opt.price,
                              image: opt.image,
                              images: opt.images 
                            })}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                              selected 
                                ? 'bg-blue-600 text-white shadow-md' 
                                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <button 
                onClick={handleAddToCart}
                disabled={cartLoading || product.stock === 0}
                className="flex-1 bg-blue-600 text-white px-8 py-4 rounded-xl hover:bg-blue-700 transition-all font-semibold text-lg shadow-blue-200 shadow-lg disabled:bg-gray-300 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
              >
                <ShoppingCart className="h-5 w-5" />
                {cartLoading ? 'Adding...' : 'Add to Cart'}
              </button>
              
              <button 
                onClick={handleWishlistToggle}
                disabled={wishlistLoading}
                className={`px-4 py-4 border rounded-xl transition-all flex items-center justify-center ${
                  isWishlisted 
                    ? 'border-red-200 bg-red-50 text-red-500' 
                    : 'border-gray-200 hover:bg-gray-50 text-gray-400 hover:text-red-500'
                }`}
              >
                <Heart className={`h-6 w-6 ${isWishlisted ? 'fill-current' : ''}`} />
              </button>

              <button 
                onClick={toggleCompare}
                className={`px-4 py-4 border rounded-xl transition-all flex items-center justify-center ${
                  isCompared 
                    ? 'border-blue-200 bg-blue-50 text-blue-600' 
                    : 'border-gray-200 hover:bg-gray-50 text-gray-400 hover:text-blue-600'
                }`}
              >
                <GitCompare className="h-6 w-6" />
              </button>

              <ShareButton
                productName={product.name}
                price={selectedSpecOption?.price ?? product.price}
              />
            </div>

            <div className="mb-8 space-y-3 text-sm text-gray-600 border-t pt-4">
              <div className="flex items-center gap-2">
                <span className="text-blue-600">🚚</span>
                <span>Shipping Extra & Exchanges*</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-blue-600">💳</span>
                <span>Flexible and secure payment</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-blue-600">😊</span>
                <span>600,000 happy customers</span>
              </div>
            </div>

            {/* Trust Badges */}
            <TrustBadges />

            {/* Meta Info */}
            <div className="space-y-3 text-sm text-gray-500">
              {product.sku && (
                <div className="flex gap-2">
                  <span className="font-medium text-gray-900 w-24">SKU:</span>
                  <span>{product.sku}</span>
                </div>
              )}
              {product.category && (
                <div className="flex gap-2">
                  <span className="font-medium text-gray-900 w-24">Category:</span>
                  <span className="uppercase">{typeof product.category === 'string' ? product.category : product.category.name || 'Category'}</span>
                </div>
              )}
              {product.brand && (
                <div className="flex gap-2">
                  <span className="font-medium text-gray-900 w-24">Brand:</span>
                  <span>{product.brand}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="font-medium text-gray-900 w-24">Availability:</span>
                <span className={product.stock > 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                  {product.stock > 0 ? 'In Stock' : 'Out of Stock'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Middle Section: Details, Features, Compatibility */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 mb-16 border-t border-gray-100 pt-16">
          {/* Description & Features */}
          <div className="lg:col-span-2 space-y-12">
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Product Description</h2>
              <div className="prose prose-blue max-w-none text-gray-600 leading-relaxed whitespace-pre-line">
                {stripHtml(product.description)}
              </div>
            </section>

            {/* Why Choose Section */}
            {product.whyChoose && product.whyChoose.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Why Choose {product.name}?</h2>
                <div className="space-y-4">
                  {product.whyChoose.map((item: string, index: number) => {
                    // Check for separator
                    const separator = item.includes(' – ') ? ' – ' : (item.includes(' - ') ? ' - ' : null);
                    
                    if (separator) {
                      const [title, ...rest] = item.split(separator);
                      const description = rest.join(separator);
                      return (
                        <div key={index} className="leading-relaxed text-gray-700">
                          <span className="font-bold text-gray-900">{title}</span>
                          <span>{separator}{description}</span>
                        </div>
                      );
                    }
                    
                    return (
                      <p key={index} className="text-gray-700 leading-relaxed">
                        {item}
                      </p>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Indian Use Cases Section */}
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Perfect for Indian Roads & Climate</h2>
              <div className="prose prose-blue max-w-none text-gray-600 leading-relaxed">
                <p>This {product.name} is specifically designed to handle the unique challenges of Indian roads and climate conditions:</p>
                <ul className="list-disc space-y-2 pl-5 text-gray-700 marker:text-blue-600">
                  <li><strong>Monsoon Ready:</strong> Water-resistant construction ensures reliable performance during heavy rains and flooding</li>
                  <li><strong>Summer Heat Resistant:</strong> High-temperature materials withstand India's intense summer heat up to 45°C</li>
                  <li><strong>Road Condition Optimized:</strong> Engineered for Indian road surfaces including potholes, speed breakers, and uneven terrain</li>
                  <li><strong>Fuel Efficiency Focused:</strong> Designed to minimize drag and maximize fuel economy on Indian highways</li>
                  <li><strong>Local Installation Support:</strong> Professional installation available at all Autobacs service centers across India</li>
                </ul>
                <p>Whether you're driving in Mumbai's monsoons, Delhi's smog, or Bangalore's traffic, this {product.name} delivers superior performance and reliability.</p>
              </div>
            </section>

            {/* Product-Specific FAQs Section */}
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
              <div className="space-y-4">
                <div className="border-b border-gray-200 pb-4">
                  <h3 className="font-semibold text-gray-900 mb-2">Is this {product.name} compatible with my vehicle?</h3>
                  <p className="text-gray-600">Yes! This {product.name} is compatible with {product.compatibleVehicles?.length ? product.compatibleVehicles.map(v => `${v.make} ${v.model}`).join(', ') : 'most Indian vehicles'}. Check our vehicle compatibility tool above for exact fitment.</p>
                </div>
                <div className="border-b border-gray-200 pb-4">
                  <h3 className="font-semibold text-gray-900 mb-2">What warranty does this {product.name} come with?</h3>
                  <p className="text-gray-600">All Autobacs automotive accessories come with a comprehensive 2-year warranty covering manufacturing defects and workmanship.</p>
                </div>
                <div className="border-b border-gray-200 pb-4">
                  <h3 className="font-semibold text-gray-900 mb-2">Do you offer professional installation services?</h3>
                  <p className="text-gray-600">Yes! We offer professional installation services at all our authorized service centers across India. Book your installation online or visit your nearest Autobacs store.</p>
                </div>
                <div className="border-b border-gray-200 pb-4">
                  <h3 className="font-semibold text-gray-900 mb-2">How long does shipping take to my location?</h3>
                  <p className="text-gray-600">We offer free shipping across India. Delivery typically takes 3-7 business days depending on your location. Express shipping options are available at checkout.</p>
                </div>
                <div className="border-b border-gray-200 pb-4">
                  <h3 className="font-semibold text-gray-900 mb-2">Can I return this {product.name} if it doesn't meet my expectations?</h3>
                  <p className="text-gray-600">Yes! We offer a 30-day no-questions-asked return policy for unused and uninstalled accessories. Items must be in original packaging with all components included.</p>
                </div>
              </div>
            </section>

            {product.features && product.features.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Key Features</h2>
                <ul className="list-disc space-y-2 pl-5 text-gray-700 marker:text-blue-600">
                  {product.features.map((feature: string, index: number) => (
                    <li key={index} className="leading-relaxed pl-1">
                      {feature}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            
            {/* Technical Specifications (Existing Schema) */}
            {product.specifications && product.specifications.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Technical Specifications</h2>
                <div className="bg-gray-50 rounded-2xl p-6 sm:p-8">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-4">
                    {product.specifications.map((spec: any, index: number) => (
                      <div key={index} className="flex justify-between border-b border-gray-200 py-3 last:border-0">
                        <span className="text-gray-500">{spec.key}</span>
                        <span className="font-medium text-gray-900">{spec.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* Compatibility Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 sticky top-8">
              <h3 className="text-xl font-bold text-gray-900 mb-6">Vehicle Compatibility</h3>
              {product.compatibleVehicles?.length ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500 mb-4">
                    This part is compatible with the following vehicles:
                  </p>
                  {product.compatibleVehicles.map((vehicle: any, index: number) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                        {vehicle.make?.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{vehicle.make} {vehicle.model}</p>
                        <p className="text-xs text-gray-500">{vehicle.year} • {vehicle.variant}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-500">Universal fitment or specific compatibility data not available.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Section: Package Details, Reviews, Q&A */}
        <div className="border-t border-gray-100 pt-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            {/* Left Column: Package Details & Q&A */}
            <div className="lg:col-span-4 space-y-12">
              {product.packageContents && product.packageContents.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold text-gray-900 mb-6">What's in the Box</h2>
                  <div className="bg-gray-50 rounded-xl p-6">
                    <ul className="space-y-3">
                      {product.packageContents.map((item: string, index: number) => (
                        <li key={index} className="flex items-center gap-3 text-gray-700">
                          <span className="h-5 w-5 rounded-full border border-green-500 flex items-center justify-center text-green-500 text-xs">✓</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              <section id="qa">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">Questions & Answers</h2>
                  {!showQuestionForm && (
                    <button 
                      onClick={() => setShowQuestionForm(true)}
                      className="text-blue-600 font-medium hover:underline"
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

            {/* Right Column: Reviews & Related Products */}
            <div className="lg:col-span-8" id="reviews">
              {/* Bundle Section - Frequently Bought Together */}
              <section className="mb-16">
                <BundleSection 
                  productId={product._id}
                  mainProductName={product.name}
                  mainProductPrice={product.price}
                />
              </section>

              {/* Features Grid */}
              <section className="mb-16">
                <FeatureGrid features={product.features} />
              </section>

              {/* Vehicle Compatibility */}
              <section className="mb-16">
                <CompatibilityList vehicles={product.compatibleVehicles} />
              </section>

              {/* Why Choose This Product - Indian Conditions */}
              <section className="mb-16">
                <WhyChooseSection whyChoose={product.whyChoose} />
              </section>

              {/* FAQ Section */}
              <section className="mb-16">
                <ProductFAQ />
              </section>

              {/* Customer Reviews */}
              <h2 className="text-2xl font-bold text-gray-900 mb-8">Customer Reviews</h2>
              <Reviews 
                productId={product._id} 
                isAuthenticated={isAuthenticated} 
              />
              
              {/* Similar Products Section */}
              <section className="mt-16">
                <SimilarProductsSection productId={product._id} />
              </section>
              
              {/* Complementary Products Section */}
              <section className="mt-16">
                <ComplementaryProductsSection productId={product._id} />
              </section>
            </div>
          </div>
        </div>
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
