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

export const getProducts = async (req, res) => {
  const searchResults = await SearchService.searchProducts(req.query);
  
  res.json({
    success: true,
    count: searchResults.products.length,
    ...searchResults.pagination,
    products: searchResults.products,
    facets: searchResults.facets
  });
};

export const getSearchSuggestions = async (req, res) => {
  const { q, limit = 10 } = req.query;
  const result = await SearchService.getSearchSuggestions(q, parseInt(limit));
  
  const history = []; // Placeholder
  
  res.json({
    success: true,
    suggestions: result.suggestions || [],
    corrections: result.corrections || [],
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
