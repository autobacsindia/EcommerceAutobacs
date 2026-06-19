import Product from '../models/Product.js';
import brandRepository from "../repositories/brandRepository.js";
import SearchService from '../services/searchService.js';

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Normalise a URL slug to a clean lowercase hyphenated string.
 * e.g.  "Iron Man 4x4" → "iron-man-4x4"
 */
function normaliseSlug(value) {
  return value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Flatten the stored logo ({ url, public_id } | string) to a URL string.
 * Returns null when no usable URL is present so callers can apply a fallback.
 */
function logoUrl(logo) {
  if (typeof logo === 'string') return logo || null;
  if (logo && typeof logo === 'object') return logo.url || null;
  return null;
}

// @route   GET /products/brands/:brandName
// @desc    Get products for a specific brand
// @access  Public
export async function getBrandProducts(req, res) {
  const { brandName } = req.params;

  // Resolve slug to official brand name if a Brand document exists
  const normalizedSlug = normaliseSlug(brandName);

  const brandDoc = await brandRepository.findOne({
    $or: [
      { slug: brandName },
      { slug: normalizedSlug },
      { name: { $regex: new RegExp(`^${brandName}$`, 'i') } },
    ],
  });

  const searchBrand = brandDoc ? brandDoc.name : brandName;

  const searchResults = await SearchService.searchProducts({
    brand: searchBrand,
    page: req.query.page || 1,
    limit: req.query.limit || 12,
  });

  res.json({
    success: true,
    count: searchResults.products.length,
    ...searchResults.pagination,
    products: searchResults.products,
    brand: brandDoc
      ? { name: brandDoc.name, slug: brandDoc.slug, id: brandDoc._id.toString() }
      : null,
  });
}

// @route   GET /products/brands/:brandName/details
// @desc    Get details for a specific brand
// @access  Public
export async function getBrandDetails(req, res) {
  const { brandName } = req.params;

  const normalizedSlug = normaliseSlug(brandName);

  let brandDoc = await brandRepository.findOne({
    $or: [
      { name: { $regex: new RegExp(`^${brandName.replace(/-/g, '[.\\s-]')}$`, 'i') } },
      { slug: brandName },
      { slug: normalizedSlug },
    ],
  });

  if (brandDoc) {
    return res.json({
      success: true,
      brand: {
        id: brandDoc._id.toString(),
        name: brandDoc.name,
        slug: brandDoc.slug,
        logo:
          logoUrl(brandDoc.logo) ||
          `https://via.placeholder.com/150?text=${encodeURIComponent(brandDoc.name)}`,
        description:
          brandDoc.description || 'Premium automotive accessories and performance parts',
      },
    });
  }

  // Brand not in Brand collection — check products for this brand name
  const variations = [brandName, brandName.replace(/-/g, ' '), brandName.replace(/-/g, '.')];
  const variationPatterns = variations.map((v) => new RegExp(`^${v}$`, 'i'));

  const productCount = await Product.countDocuments({
    brand: { $in: variationPatterns },
    isActive: true,
  });

  if (productCount === 0) {
    return res.status(404).json({ success: false, message: 'Brand not found' });
  }

  // Brand exists in products but has no Brand document — build a placeholder
  const product = await Product.findOne({
    brand: { $in: variationPatterns },
    isActive: true,
  });

  const actualBrandName = product ? product.brand : brandName;
  const slug = actualBrandName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  res.json({
    success: true,
    brand: {
      id: null,
      name: actualBrandName,
      slug,
      logo: `https://via.placeholder.com/150?text=${encodeURIComponent(actualBrandName)}`,
      description: 'Premium automotive accessories and performance parts',
    },
  });
}
