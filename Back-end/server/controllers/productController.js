/**
 * Product Controller - HTTP LAYER ONLY
 * 
 * This layer is responsible for:
 * - Handling HTTP requests/responses
 * - Request validation (via middleware)
 * - Calling service layer
 * - Formatting API responses
 * 
 * NO business logic!
 * NO direct database calls!
 */

import productService from "../services/productService.js";
import SearchService from "../services/searchService.js";
import cacheService, { TTL, CACHE_VERSION } from "../services/cacheService.js";
import { buildResponseKey, isCacheDisabled } from "../middleware/httpCache.js";
import { CACHE_PROFILES, resolveTags } from "../config/cacheProfiles.js";

const PRODUCT_LIST_PROFILE = CACHE_PROFILES.PRODUCT_LIST;

// Public product list. Cached here (not in httpCache) because the list is a
// 'lock' profile — CacheService.getWithLock gives single-flight stampede
// protection so a cold cache under load fires ONE search, not N. The key is
// built by the shared buildResponseKey so it's regional and consistent with the
// rest of the unified cache; tags come from the profile so a product write
// invalidates it via invalidateTags('products'). Replaces the old bespoke
// SET-NX lock + 30×100ms poll and the un-invalidatable v2:products:list key.
export const getProducts = async (req, res) => {
  const fetchList = async () => {
    const searchResults = await SearchService.searchProducts(req.query);
    return {
      success: true,
      count: searchResults.products.length,
      ...searchResults.pagination,
      products: searchResults.products,
      facets: searchResults.facets,
    };
  };

  try {
    if (isCacheDisabled()) {
      return res.json(await fetchList());
    }

    const cacheKey = buildResponseKey(req, PRODUCT_LIST_PROFILE);
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    res.setHeader('X-Cache', 'MISS');
    const tags = resolveTags(PRODUCT_LIST_PROFILE, req);
    const responseData = await cacheService.getWithLock(
      cacheKey,
      fetchList,
      PRODUCT_LIST_PROFILE.ttl,
      tags,
    );
    res.json(responseData);
  } catch (error) {
    console.error('[ProductController] Error in getProducts:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// GET /products/admin/list — admin product management list (route is protect+admin).
// Differs from the public getProducts on purpose:
//   • includes INACTIVE products (disabled/draft items the admin must still manage);
//   • honours an optional `status=active|inactive` filter;
//   • NEVER cached — an admin who just edited a product must see the change now, not
//     up to 5 minutes later off the shared public list cache.
// `includeInactive` is passed by the server here, never read from the query, so a
// public caller of /products can't use it to surface hidden products.
export const getAdminProducts = async (req, res) => {
  try {
    const searchResults = await SearchService.searchProducts(req.query, { includeInactive: true });
    // The list table only needs the variant COUNT, not every embedded variant
    // (up to ~15 subdocs each). Replace the heavy array with a count so a page of
    // variable products doesn't ship hundreds of unused variant subdocs.
    const products = searchResults.products.map(({ variants, ...p }) => ({
      ...p,
      variantCount: Array.isArray(variants) ? variants.length : 0,
    }));
    res.json({
      success: true,
      count: products.length,
      ...searchResults.pagination,
      products,
    });
  } catch (error) {
    console.error('[ProductController] Error in getAdminProducts:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// GET /products/facets — per-brand and per-category counts for the filter sidebar.
export const getProductFacets = async (req, res) => {
  const cacheKey = `${CACHE_VERSION}:products:facets:${JSON.stringify(req.query)}`;
  try {
    const cached = await cacheService.get(cacheKey);
    if (cached) return res.json(cached);
  } catch (cacheError) {
    console.warn('[ProductController] Facet cache read failed:', cacheError.message);
  }

  try {
    const facets = await SearchService.getFacets(req.query);
    const responseData = { success: true, facets };
    try {
      await cacheService.set(cacheKey, responseData, TTL.PRODUCT_LIST, ['products']);
    } catch (cacheError) {
      console.warn('[ProductController] Facet cache write failed:', cacheError.message);
    }
    res.json(responseData);
  } catch (error) {
    console.error('[ProductController] Error in getProductFacets:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getSearchSuggestions = async (req, res) => {
  const { q, limit = 10 } = req.query;
  
  // Query length guard: Prevent empty/short queries
  if (!q || q.trim().length < 2) {
    return res.json({
      success: true,
      suggestions: [],
      corrections: [],
      history: []
    });
  }
  
  const result = await SearchService.getSearchSuggestions(q, parseInt(limit));
  
  console.log('[ProductController] Search suggestions result:', JSON.stringify(result.suggestions?.slice(0, 2), null, 2));
  
  const history = []; // Placeholder
  
  res.json({
    success: true,
    suggestions: result.suggestions || [],
    corrections: result.corrections || [],
    total: result.total ?? 0,
    history
  });
};

export const getSearchAnalytics = async (req, res) => {
  const { startDate, endDate } = req.query;
  
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const analytics = await SearchService.getSearchAnalytics(start, end);
  
  res.json({
    success: true,
    analytics
  });
};

export const getSearchHistory = async (req, res) => {
  const { limit = 10 } = req.query;
  const history = await SearchService.getSearchHistory(null, parseInt(limit));
  
  res.json({
    success: true,
    history
  });
};

export const clearSearchHistory = async (req, res) => {
  await SearchService.clearSearchHistory();
  
  res.json({
    success: true,
    message: 'Search history cleared successfully'
  });
};

export const removeSearchHistoryTerm = async (req, res) => {
  // In a more advanced implementation, we would remove the specific term
  res.json({
    success: true,
    message: 'Term removed from search history'
  });
};

export const getFeaturedProducts = async (req, res, next) => {
  try {
    const { limit = 6 } = req.query;

    const products = await productService.getFeaturedProducts(Number(limit));

    res.json({
      success: true,
      count: products.length,
      products
    });
  } catch (error) {
    next(error);
  }
};

export const getOfferProducts = async (req, res, next) => {
  try {
    const { limit = 24 } = req.query;

    const products = await productService.getOfferProducts(Number(limit));

    res.json({
      success: true,
      count: products.length,
      products
    });
  } catch (error) {
    next(error);
  }
};

export const getProductsByVehicle = async (req, res, next) => {
  try {
    const { vehicleId } = req.params;

    const result = await productService.getProductsByVehicle(vehicleId, req.query);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    res.json({
      success: true,
      vehicle: result.vehicle,
      count: result.products.length,
      ...result.pagination,
      products: result.products,
      facets: result.facets
    });
  } catch (error) {
    next(error);
  }
};

export const getBrands = async (req, res, next) => {
  try {
    const brands = await productService.getBrandsWithCounts();

    res.json({
      success: true,
      brands
    });
  } catch (error) {
    next(error);
  }
};

export const getSimilarProducts = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 4 } = req.query;
    
    // Generate cache key
    const cacheKey = `${CACHE_VERSION}:products:similar:${id}:${limit}`;
    
    try {
      // Try cache first
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    } catch (cacheError) {
      console.warn('[ProductController] Similar products cache read failed:', cacheError.message);
      // Continue to DB query if cache fails
    }
    
    // Get similar products from service
    const similarProducts = await SearchService.getSimilarProducts(id, Number(limit));
    
    // Ensure products have all required fields for frontend display
    const formattedProducts = similarProducts.map(product => {
      // Normalize brand name - remove "India" suffix to avoid duplication
      let brandName = product.brand || 'Autobacs';
      if (brandName && brandName.includes('India')) {
        brandName = brandName.replace(/\s*India\s*$/i, '').trim();
      }
      
      return {
        _id: product._id,
        name: product.name || 'Product Name',
        slug: product.slug || product._id.toString(),
        price: product.price || 0,
        originalPrice: product.originalPrice || null,
        images: product.images || [],
        averageRating: product.averageRating || 0,
        totalReviews: product.totalReviews || 0,
        brand: brandName,
        categories: product.categories || [],
        shortDescription: product.shortDescription || '',
        description: product.description || '',
        stock: product.stock || 0,
        isActive: product.isActive !== false,
        // Variable-product context so the card can offer quick-add (simple) vs
        // a "Select options" link to the PDP (variable — a model must be chosen).
        productType: product.productType || 'simple',
        priceMin: product.priceMin ?? null,
        priceMax: product.priceMax ?? null
      };
    });
    
    const responseData = {
      success: true,
      count: formattedProducts.length,
      products: formattedProducts
    };
    
    // Cache for 5 minutes
    try {
      await cacheService.set(cacheKey, responseData, TTL.PRODUCT_LIST, ['products']);
    } catch (cacheError) {
      console.warn('[ProductController] Similar products cache write failed:', cacheError.message);
      // Don't fail request if cache write fails
    }
    
    res.json(responseData);
  } catch (error) {
    console.error('[ProductController] Error in getSimilarProducts:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const getComplementaryProducts = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 4 } = req.query;
    
    // Generate cache key
    const cacheKey = `${CACHE_VERSION}:products:complementary:${id}:${limit}`;
    
    try {
      // Try cache first
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    } catch (cacheError) {
      console.warn('[ProductController] Complementary products cache read failed:', cacheError.message);
      // Continue to DB query if cache fails
    }
    
    // Get complementary products from service
    const complementaryProducts = await SearchService.getComplementaryProducts(id, Number(limit));
    
    // Ensure products have all required fields for frontend display
    const formattedProducts = complementaryProducts.map(product => {
      // Normalize brand name - remove "India" suffix to avoid duplication
      let brandName = product.brand || 'Autobacs';
      if (brandName && brandName.includes('India')) {
        brandName = brandName.replace(/\s*India\s*$/i, '').trim();
      }
      
      return {
        _id: product._id,
        name: product.name || 'Product Name',
        slug: product.slug || product._id.toString(),
        price: product.price || 0,
        originalPrice: product.originalPrice || null,
        images: product.images || [],
        averageRating: product.averageRating || 0,
        totalReviews: product.totalReviews || 0,
        brand: brandName,
        categories: product.categories || [],
        shortDescription: product.shortDescription || '',
        description: product.description || '',
        stock: product.stock || 0,
        isActive: product.isActive !== false,
        // Variable-product context so the card can offer quick-add (simple) vs
        // a "Select options" link to the PDP (variable — a model must be chosen).
        productType: product.productType || 'simple',
        priceMin: product.priceMin ?? null,
        priceMax: product.priceMax ?? null
      };
    });
    
    const responseData = {
      success: true,
      count: formattedProducts.length,
      products: formattedProducts
    };
    
    // Cache for 5 minutes
    try {
      await cacheService.set(cacheKey, responseData, TTL.PRODUCT_LIST, ['products']);
    } catch (cacheError) {
      console.warn('[ProductController] Complementary products cache write failed:', cacheError.message);
      // Don't fail request if cache write fails
    }
    
    res.json(responseData);
  } catch (error) {
    console.error('[ProductController] Error in getComplementaryProducts:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
