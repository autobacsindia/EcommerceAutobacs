'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Heart, Star, GitCompare } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCart } from '@/context/CartContext';
import ImageGallery from '@/components/products/ImageGallery';
import { Reviews } from '@/components/reviews';
import apiClient from '@/lib/api';

async function getProduct(id: string): Promise<any> {
  try {
    // Use the API client which has proper timeout handling
    const response: any = await apiClient.get(`/products/${id}`);
    return response?.product || null; // Changed from data.data to data.product to match backend response
  } catch (error: any) {
    // Handle invalid ID format gracefully (e.g. when a slug or invalid ID is passed that the backend rejects)
    const isInvalidId = error?.message?.includes('Invalid ID format') || error?.message?.includes('Cast to ObjectId failed');
    
    // If ID is invalid or not found (404), try to find by search (fallback mechanism)
    // This handles cases where search suggestions might pass a slug or name instead of an ObjectId
    if (isInvalidId || error?.status === 404) {
      try {
        console.log(`Product not found by ID (${id}), attempting fallback search...`);
        // Search for the product using the ID as a keyword
        let searchResponse: any = await apiClient.get(`/products?search=${encodeURIComponent(id)}&limit=1`);
        
        // If first attempt fails and the ID looks like a slug (has dashes), try replacing dashes with spaces
        if ((!searchResponse?.products || searchResponse.products.length === 0) && id.includes('-')) {
          const cleanName = id.replace(/-/g, ' ');
          console.log(`Fallback search attempt 2 with cleaned name: ${cleanName}`);
          searchResponse = await apiClient.get(`/products?search=${encodeURIComponent(cleanName)}&limit=1`);
        }

        if (searchResponse?.products && searchResponse.products.length > 0) {
          const foundProduct = searchResponse.products[0];
          console.log(`Fallback search found product: ${foundProduct.name} (${foundProduct._id})`);
          
          // If we found a product, fetch full details using the real ID
          if (foundProduct._id) {
             try {
               const fullProductResponse: any = await apiClient.get(`/products/${foundProduct._id}`);
               return fullProductResponse?.product || foundProduct;
             } catch (detailError) {
               // If fetching details fails, return the search result (better than nothing)
               return foundProduct;
             }
          }
          return foundProduct;
        }
      } catch (fallbackError) {
        // Fallback failed, proceed to return null
      }
    }

    if (!isInvalidId) {
      console.error('Error fetching product:', error);
    }
    return null;
  }
}

function ProductDetailPageClient({ product }: { product: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuth();
  const { addToWishlist, removeFromWishlist, isInWishlist } = useWishlist();
  const { addToCart } = useCart();
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);
  const [selectedSpecOption, setSelectedSpecOption] = useState<{ key: string; label: string; price: number } | null>(null);

  // Get currently compared products from URL
  const comparedProductIds = searchParams.get('compare')?.split(',') || [];
  const isCompared = product ? comparedProductIds.includes(product._id) : false;

  useEffect(() => {
    if (product) {
      setIsWishlisted(isInWishlist(product._id));
    }
  }, [product, isInWishlist]);

  // Separate effect for initializing specs to avoid conflicts with other dependencies
  useEffect(() => {
    if (product) {
      const vs = Array.isArray(product.variableSpecs) ? product.variableSpecs : [];
      if (vs.length > 0 && Array.isArray(vs[0].options) && vs[0].options.length > 0) {
        setSelectedSpecOption({
          key: vs[0].key,
          label: vs[0].options[0].label,
          price: vs[0].options[0].price
        });
      } else {
        setSelectedSpecOption(null);
      }
    }
  }, [product?._id]); // Only re-run when product ID changes

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
      } else {
        await addToWishlist(product._id);
      }
      setIsWishlisted(!isWishlisted);
    } catch (error: any) {
      alert(error.message || 'Failed to update wishlist');
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
      alert('Added to cart!');
    } catch (error: any) {
      alert(error.message || 'Failed to add to cart');
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
        alert('You can only compare up to 4 products at a time.');
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
    <div className="min-h-screen bg-gray-50 py-8">
      {/* Compare Bar */}
      {comparedProductIds.length > 0 && (
        <div className="bg-blue-50 border-b border-blue-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center">
                <GitCompare className="h-5 w-5 text-blue-600 mr-2" />
                <span className="text-blue-800 font-medium">
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
                  className="text-blue-600 hover:text-blue-800 font-medium"
                >
                  Clear
                </button>
                <button
                  onClick={viewComparison}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                >
                  Compare Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="w-full px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-gray-600">
          <Link href="/" className="hover:text-blue-600">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/products" className="hover:text-blue-600">Products</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900">{product.name}</span>
        </nav>

        {/* Info Banner for Sample Data */}
        {hasPlaceholderImage && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg mb-6">
            <div className="p-4">
              <div className="flex items-center">
                <svg className="h-5 w-5 text-yellow-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <p className="text-yellow-800 text-sm">
                  <span className="font-medium">Sample Product:</span> This is a sample product with a placeholder image. 
                  Real product data will be imported from WordPress.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="py-4">
          <div className="lg:grid lg:grid-cols-2 lg:gap-12">
            {/* Product Images */}
            <div>
              <ImageGallery
                images={product.images && product.images.length > 0 
                  ? product.images.map((img: any, index: number) => ({
                      id: img._id || index,
                      src: img.url,
                      alt: img.alt || `${product.name} image ${index + 1}`,
                      name: img.alt
                    }))
                  : []
                }
                className="mb-4"
              />
            </div>

            {/* Product Info */}
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">{product.name}</h1>
              
              {/* Rating */}
              <div className="flex items-center gap-2 mb-4">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`h-5 w-5 ${
                        star <= (product.averageRating || 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-gray-600">({product.averageRating || 0} rating)</span>
              </div>

              {/* Price */}
              <div className="mb-6">
                <p className="text-4xl font-bold text-blue-600">
                  ₹{(selectedSpecOption?.price ?? product.price ?? 0).toLocaleString()}
                </p>
                {product.originalPrice && product.originalPrice > product.price && (
                  <p className="text-lg text-gray-500 line-through">
                    ₹{product.originalPrice?.toLocaleString()}
                  </p>
                )}
              </div>

              {/* Stock Status */}
              <div className="mb-6">
                {product.stock > 0 ? (
                  <p className="text-green-600 font-semibold">In Stock ({product.stock} available)</p>
                ) : (
                  <p className="text-red-600 font-semibold">Out of Stock</p>
                )}
              </div>

              {/* Description */}
              <div className="mb-6">
                <h2 className="font-semibold text-gray-900 mb-2">Description</h2>
                <p className="text-gray-700">{product.description || 'No description available.'}</p>
              </div>

              {/* Category */}
              {product.category && (
                <div className="mb-6">
                  <h2 className="font-semibold text-gray-900 mb-2">Category</h2>
                  <p className="text-gray-700">{product.category.name === 'Suspension' ? 'SUSPENSION' : product.category.name}</p>
                </div>
              )}

              {/* Brand */}
              {product.brand && (
                <div className="mb-6">
                  <h2 className="font-semibold text-gray-900 mb-2">Brand</h2>
                  <p className="text-gray-700">{product.brand}</p>
                </div>
              )}

              {/* SKU */}
              {product.sku && (
                <div className="mb-6">
                  <h2 className="font-semibold text-gray-900 mb-2">SKU</h2>
                  <p className="text-gray-700">{product.sku}</p>
                </div>
              )}

              {/* Specifications */}
              {Array.isArray(product.variableSpecs) && product.variableSpecs.length > 0 ? (
                <div className="mb-6">
                  <h2 className="font-semibold text-gray-900 mb-2">Specifications</h2>
                  {product.variableSpecs.map((specGroup: any, gi: number) => (
                    <div key={gi} className="mb-4">
                      <div className="text-gray-700 mb-2">{specGroup.key}:</div>
                      <div className="flex flex-wrap gap-2">
                        {specGroup.options.map((opt: any, oi: number) => {
                          const selected = selectedSpecOption && selectedSpecOption.key === specGroup.key && selectedSpecOption.label === opt.label;
                          return (
                            <button
                              key={oi}
                              type="button"
                              onClick={() => setSelectedSpecOption({ key: specGroup.key, label: opt.label, price: opt.price })}
                              className={`px-3 py-2 rounded-md border text-sm ${selected ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 hover:bg-gray-50 text-gray-700'}`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                product.specifications && product.specifications.length > 0 && (
                  <div className="mb-6">
                    <h2 className="font-semibold text-gray-900 mb-2">Specifications</h2>
                    <div className="grid grid-cols-2 gap-2">
                      {product.specifications.map((spec: any, index: number) => (
                        <div key={index} className="flex justify-between border-b border-gray-100 py-1">
                          <span className="text-gray-600">{spec.key}:</span>
                          <span className="text-gray-900 font-medium">{spec.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}

              {/* Add to Cart and Compare */}
              <div className="flex flex-col sm:flex-row gap-4">
                <button 
                  onClick={handleAddToCart}
                  disabled={cartLoading || product.stock === 0}
                  className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <ShoppingCart className="h-5 w-5" />
                  {cartLoading ? 'Adding...' : 'Add to Cart'}
                </button>
                
                <button 
                  onClick={toggleCompare}
                  className={`px-6 py-3 border rounded-md transition-colors flex items-center justify-center gap-2 ${
                    isCompared 
                      ? 'border-blue-500 bg-blue-50 text-blue-500' 
                      : 'border-gray-300 hover:bg-gray-50 text-gray-600'
                  }`}
                >
                  <GitCompare className="h-5 w-5" />
                  {isCompared ? 'Added to Compare' : 'Compare'}
                </button>
                
                <button 
                  onClick={handleWishlistToggle}
                  disabled={wishlistLoading}
                  className={`p-3 border rounded-md transition-colors flex items-center justify-center ${
                    isWishlisted 
                      ? 'border-red-500 bg-red-50 text-red-500' 
                      : 'border-gray-300 hover:bg-gray-50 text-gray-600 hover:text-red-500'
                  }`}
                >
                  <Heart className={`h-6 w-6 ${isWishlisted ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>
          </div>
          
          {/* Reviews Section */}
          <div className="mt-12">
            <Reviews 
              productId={product._id} 
              isAuthenticated={isAuthenticated} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  // Use React.use() to unwrap the Promise if it's a Promise
  // @ts-ignore
  const unwrappedParams = use(params);
  const productId = unwrappedParams.id;
  
  // Use state and effect to handle async data fetching
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProduct() {
      setLoading(true);
      const fetchedProduct = await getProduct(productId);
      setProduct(fetchedProduct);
      setLoading(false);
    }
    
    fetchProduct();
  }, [productId]);

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

  return <ProductDetailPageClient product={product} />;
}
