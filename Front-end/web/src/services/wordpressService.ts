// Temporary WordPress service that extracts vehicles from product data
// This bypasses the missing vehicle taxonomy by parsing product names/tags

import axios from 'axios';
import wordpressDebug from '@/lib/wordpressDebug';

// WordPress API configuration
const WORDPRESS_SITE_URL = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL || '';
const WORDPRESS_API_VERSION = process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || 'wc/v3';
const WORDPRESS_CONSUMER_KEY = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY || '';
const WORDPRESS_CONSUMER_SECRET = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET || '';

// Create axios instance with default configuration
const createWordpressApi = () => {
  // Don't create the API instance if we don't have all required configuration
  if (!WORDPRESS_SITE_URL || !WORDPRESS_CONSUMER_KEY || !WORDPRESS_CONSUMER_SECRET) {
    // Log debug information
    wordpressDebug.logConfig();
    return null;
  }
  
  return axios.create({
    baseURL: `${WORDPRESS_SITE_URL}/wp-json`,
    auth: {
      username: WORDPRESS_CONSUMER_KEY,
      password: WORDPRESS_CONSUMER_SECRET
    },
    timeout: 30000
  });
};

const wordpressApi = createWordpressApi();

// WordPress API response types
interface WordPressProductImage {
  id: number;
  src: string;
  name: string;
  alt: string;
}

interface WordPressProductCategory {
  id: number;
  name: string;
  slug: string;
}

interface WordPressProductAttribute {
  id: number;
  name: string;
  slug: string;
  options: string[];
}

interface WordPressVehicle {
  id: number;
  name: string;
  slug: string;
  count: number;
}

interface WordPressProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  date_created: string;
  date_modified: string;
  type: string;
  status: string;
  featured: boolean;
  catalog_visibility: string;
  description: string;
  short_description: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  date_on_sale_from: string | null;
  date_on_sale_to: string | null;
  on_sale: boolean;
  purchasable: boolean;
  total_sales: number;
  virtual: boolean;
  downloadable: boolean;
  downloads: any[];
  download_limit: number;
  download_expiry: number;
  external_url: string;
  button_text: string;
  tax_status: string;
  tax_class: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: string;
  backorders: string;
  backorders_allowed: boolean;
  backordered: boolean;
  sold_individually: boolean;
  weight: string;
  dimensions: {
    length: string;
    width: string;
    height: string;
  };
  shipping_required: boolean;
  shipping_taxable: boolean;
  shipping_class: string;
  shipping_class_id: number;
  reviews_allowed: boolean;
  average_rating: string;
  rating_count: number;
  upsell_ids: number[];
  cross_sell_ids: number[];
  parent_id: number;
  purchase_note: string;
  categories: WordPressProductCategory[];
  tags: any[];
  images: WordPressProductImage[];
  attributes: WordPressProductAttribute[];
  default_attributes: any[];
  variations: any[];
  grouped_products: any[];
  menu_order: number;
  price_html: string;
  related_ids: number[];
  meta_data: any[];
  _links: any;
}

// Extract vehicle names from product data
function extractVehiclesFromProducts(products: WordPressProduct[]): string[] {
  const vehicleMap: { [key: string]: number } = {};
  
  products.forEach(product => {
    // Extract from product name
    const productName = product.name.toLowerCase();
    
    // Common vehicle patterns
    const patterns = [
      /(?:bmw|m3|m4|m5)\s*[a-z0-9]+/gi,
      /(?:thar|scorpio|bolero|xylo|xuv)[\s\-]?[a-z0-9]*/gi,
      /(?:hilux|fortuner|innova|prado|land\s*cruiser|camry|corolla|yaris)[\s\-]?[a-z0-9]*/gi,
      /(?:audi|a[0-9])\s*[a-z0-9]+/gi,
      /(?:mercedes|benz|c\-?class|e\-?class|s\-?class|gl[ac])[a-z0-9\-]*/gi,
      /[a-z0-9]+\s*(?:series|class)/gi
    ];
    
    patterns.forEach(pattern => {
      const matches = productName.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const cleanMatch = match.trim().toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^a-z0-9\s\-]/g, '');
          
          if (cleanMatch.length > 2) {
            vehicleMap[cleanMatch] = (vehicleMap[cleanMatch] || 0) + 1;
          }
        });
      }
    });
    
    // Extract from tags
    if (product.tags && Array.isArray(product.tags)) {
      product.tags.forEach(tag => {
        const tagName = (tag.name || '').toLowerCase();
        // Look for vehicle-like patterns in tags
        if (tagName.includes('bmw') || tagName.includes('thar') || tagName.includes('hilux') || 
            tagName.includes('fortuner') || tagName.includes('scorpio') || tagName.includes('audi') ||
            tagName.includes('toyota') || tagName.includes('mahindra') || tagName.includes('series')) {
          vehicleMap[tagName] = (vehicleMap[tagName] || 0) + 1;
        }
      });
    }
  });
  
  // Convert to array and sort by frequency
  return Object.entries(vehicleMap)
    .sort((a, b) => b[1] - a[1])
    .map(([vehicle]) => vehicle)
    .slice(0, 20); // Top 20 vehicles
}

// Service functions
export const wordpressService = {
  // Extract vehicles from product data instead of using taxonomy
  async getAllVehicles(): Promise<{ id: number; name: string; slug: string; count: number }[]> {
    // Return empty array if WordPress API is not configured
    if (!wordpressApi) {
      console.warn('WordPress API not configured. Returning empty vehicles array.');
      return [];
    }
    
    try {
      // Get a sample of products to extract vehicles from
      const response = await wordpressApi.get<WordPressProduct[]>(
        `/${WORDPRESS_API_VERSION}/products`,
        {
          params: {
            per_page: 100 // Get enough products to identify vehicles
          }
        }
      );
      
      const vehicleNames = extractVehiclesFromProducts(response.data);
      
      // Convert to expected format
      return vehicleNames.map((name, index) => ({
        id: index + 1,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        slug: name.replace(/\s+/g, '-').toLowerCase(),
        count: 0 // We don't have actual counts without proper taxonomy
      }));
    } catch (error) {
      console.error('Error extracting vehicles:', error);
      // Return empty array instead of throwing error to prevent app crash
      return [];
    }
  },
  
  // Fetch products by vehicle using more comprehensive search
  async getProductsByVehicle(vehicleSlug: string, page: number = 1, perPage: number = 20): Promise<{ products: WordPressProduct[], total: number }> {
    // Return empty array if WordPress API is not configured
    if (!wordpressApi) {
      console.warn('WordPress API not configured. Returning empty products array.');
      return { products: [], total: 0 };
    }
      
    try {
      // Decode the vehicle slug to get the actual vehicle name
      const vehicleName = decodeURIComponent(vehicleSlug).toLowerCase();
        
      // Approach: Get all products that match the vehicle across all pages, then paginate
      // First, get all products matching the vehicle
      const allVehicleProducts = await this.getAllVehicleProducts(vehicleName);
        
      // Calculate total number of products for this vehicle
      const totalVehicleProducts = allVehicleProducts.length;
        
      // Calculate start index for the requested page
      const startIndex = (page - 1) * perPage;
        
      // Slice the products for the requested page
      const paginatedProducts = allVehicleProducts.slice(startIndex, startIndex + perPage);
        
      return { products: paginatedProducts, total: totalVehicleProducts };
    } catch (error) {
      console.error(`Error fetching products for vehicle ${vehicleSlug}:`, error);
      // Return empty array instead of throwing error to prevent app crash
      return { products: [], total: 0 };
    }
  },
    
  // Helper method to fetch all products matching a vehicle across all pages
  async getAllVehicleProducts(vehicleName: string): Promise<WordPressProduct[]> {
    if (!wordpressApi) {
      console.warn('WordPress API not configured. Returning empty products array.');
      return [];
    }
      
    const perPage = 50; // Fetch more per page to reduce API calls
    let allProducts: WordPressProduct[] = [];
    let currentPage = 1;
    let totalPages = 1; // We'll update this after first request
      
    // First, try to get an estimate of total pages by fetching first page
    try {
      const firstPageResponse = await wordpressApi.get<WordPressProduct[]>(
        `/${WORDPRESS_API_VERSION}/products`,
        {
          params: {
            per_page: 1, // Just get 1 to check total
            page: 1
          }
        }
      );
        
      const headers = firstPageResponse.headers;
      const totalProductsHeader = headers['x-wp-total'] || headers['X-WP-Total'];
      const totalProducts = totalProductsHeader ? parseInt(totalProductsHeader as string) : 100; // Default to 100 if not available
      totalPages = Math.ceil(totalProducts / perPage);
      totalPages = Math.min(totalPages, 10); // Limit to 10 pages to prevent too many API calls
    } catch (countError) {
      console.warn('Could not fetch total product count, using default:', countError);
      totalPages = 5; // Default to 5 pages if we can't get the count
    }
      
    // Fetch all pages up to the calculated total
    for (currentPage = 1; currentPage <= totalPages; currentPage++) {
      try {
        const response = await wordpressApi.get<WordPressProduct[]>(
          `/${WORDPRESS_API_VERSION}/products`,
          {
            params: {
              per_page: perPage,
              page: currentPage
            }
          }
        );
          
        // Filter products that mention the vehicle
        const vehicleProducts = response.data.filter(product => {
          const productName = (product.name || '').toLowerCase();
          const productTags = product.tags && Array.isArray(product.tags) 
            ? product.tags.map(tag => (tag.name || '').toLowerCase()).join(' ')
            : '';
          const productCategories = product.categories && Array.isArray(product.categories)
            ? product.categories.map(cat => (cat.name || '').toLowerCase()).join(' ')
            : '';
          
          const searchText = `${productName} ${productTags} ${productCategories}`;
          
          // Check for multiple variations of the vehicle name
          const vehicleNameVariations = [
            vehicleName, // original form like 'toyota-hilux'
            vehicleName.replace(/-/g, ' '), // 'toyota hilux'
            vehicleName.replace(/-/g, ''), // 'toyotahilux'
            vehicleName.replace(/-/g, ' ').split(' ').reverse().join(' ') // 'hilux toyota' (if applicable)
          ];
          
          // Also add variations with proper capitalization that might exist in the data
          const vehicleNameSpaceSeparated = vehicleName.replace(/-/g, ' ');
          const additionalVariations = [
            vehicleNameSpaceSeparated.replace(/\b\w/g, l => l.toUpperCase()), // 'Toyota Hilux'
            vehicleNameSpaceSeparated.toUpperCase(), // 'TOYOTA HILUX'
            vehicleNameSpaceSeparated.toLowerCase(), // 'toyota hilux'
          ];
          
          const allVariations = [...vehicleNameVariations, ...additionalVariations];
          
          return allVariations.some(variation => searchText.includes(variation));
        });
          
        // Add only the vehicle-specific products to our collection
        allProducts = allProducts.concat(vehicleProducts);
          
        // Small delay to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 100));
          
        // If this page returned no products, we might be past the last relevant page
        // But we'll continue to ensure we don't miss any
      } catch (pageError) {
        console.warn(`Error fetching page ${currentPage}, continuing with available data:`, pageError);
        break; // Stop if we encounter an error
      }
    }
      
    return allProducts;
  },
  
  // Fetch product categories (unchanged)
  async getProductCategories(): Promise<WordPressProductCategory[]> {
    // Return empty array if WordPress API is not configured
    if (!wordpressApi) {
      console.warn('WordPress API not configured. Returning empty categories array.');
      return [];
    }
    
    try {
      const response = await wordpressApi.get<WordPressProductCategory[]>(
        `/${WORDPRESS_API_VERSION}/products/categories`,
        {
          params: {
            per_page: 100
          }
        }
      );
      
      return response.data;
    } catch (error) {
      console.error('Error fetching product categories:', error);
      // Return empty array instead of throwing error to prevent app crash
      return [];
    }
  }
};

export type { WordPressProduct, WordPressProductCategory };