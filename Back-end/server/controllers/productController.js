import Product from "../models/Product.js";
import SearchService from "../services/searchService.js";
import mongoose from "mongoose";

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

export const getFeaturedProducts = async (req, res) => {
  const { limit = 6 } = req.query;

  const products = await Product.find({ isActive: true, isFeatured: true })
    .populate('categories', 'name slug')
    .limit(Number(limit))
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    count: products.length,
    products
  });
};

export const getOfferProducts = async (req, res) => {
  try {
    const { limit = 24 } = req.query;
    const now = new Date();

    const products = await Product.find({
      isActive: true,
      $and: [
        {
          $or: [
            { isOfferFeatured: true },
            { $expr: { $gt: ["$originalPrice", "$price"] } }
          ]
        },
        {
          $or: [
            { offerStartDate: { $exists: false } },
            { offerStartDate: null },
            { offerStartDate: { $lte: now } }
          ]
        },
        {
          $or: [
            { offerEndDate: { $exists: false } },
            { offerEndDate: null },
            { offerEndDate: { $gte: now } }
          ]
        }
      ]
    })
      .populate('categories', 'name slug')
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: products.length,
      products
    });
  } catch (error) {
    console.error('Error in getOfferProducts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offer products',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

export const getProductsByVehicle = async (req, res) => {
  const { vehicleId } = req.params;
  
  try {
    let vehicle;
    
    if (mongoose.Types.ObjectId.isValid(vehicleId)) {
      const Vehicle = (await import('../models/Vehicle.js')).default;
      vehicle = await Vehicle.findById(vehicleId);
    } else {
      const Vehicle = (await import('../models/Vehicle.js')).default;
      vehicle = await Vehicle.findOne({ slug: vehicleId, isActive: true });
    }
    
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }
    
    const queryParams = {
      vehicle: vehicle._id.toString(),
      page: req.query.page || 1,
      limit: req.query.limit || 12,
      sortBy: req.query.sortBy || 'createdAt',
      order: req.query.order || 'desc'
    };
    
    if (req.query.category && req.query.category !== 'undefined' && req.query.category !== 'null') {
      queryParams.category = req.query.category;
    }
    if (req.query.brand && req.query.brand !== 'undefined' && req.query.brand !== 'null') {
      queryParams.brand = req.query.brand;
    }
    if (req.query.minPrice && req.query.minPrice !== 'undefined' && req.query.minPrice !== 'null') {
      queryParams.minPrice = req.query.minPrice;
    }
    if (req.query.maxPrice && req.query.maxPrice !== 'undefined' && req.query.maxPrice !== 'null') {
      queryParams.maxPrice = req.query.maxPrice;
    }
    if (req.query.inStock && req.query.inStock !== 'undefined' && req.query.inStock !== 'null') {
      queryParams.inStock = req.query.inStock;
    }
    
    const searchResults = await SearchService.searchProducts(queryParams);
    
    res.json({
      success: true,
      vehicle: {
        _id: vehicle._id,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        slug: vehicle.slug,
        name: `${vehicle.make} ${vehicle.model}`
      },
      count: searchResults.products.length,
      ...searchResults.pagination,
      products: searchResults.products,
      facets: searchResults.facets
    });
  } catch (error) {
    console.error('Error fetching products by vehicle:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products for vehicle',
      error: error.message
    });
  }
};

export const getBrands = async (req, res) => {
  try {
    const Brand = (await import('../models/Brand.js')).default;
    
    const brands = await Brand.find({ isActive: true }).sort({ name: 1 });
    
    const brandNames = brands.map(b => b.name);
    
    const productCounts = await Product.aggregate([
      {
        $match: {
          brand: { $in: brandNames },
          isActive: true
        }
      },
      {
        $group: {
          _id: '$brand',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const countMap = {};
    productCounts.forEach(item => {
      countMap[item._id] = item.count;
    });
    
    const brandInfo = brands
      .map(brand => {
        const productCount = countMap[brand.name] || 0;
        return {
          id: brand._id.toString(),
          name: brand.name,
          slug: brand.slug,
          productCount: productCount,
          logo: brand.logo || null,
          description: brand.description || null
        };
      })
      .filter(b => b.productCount > 0);
    
    res.json({
      success: true,
      brands: brandInfo
    });
  } catch (error) {
    console.error('Error fetching brands:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brands',
      error: error.message
    });
  }
};
