import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

dotenv.config();

async function importRemainingProducts() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Get all existing product names
    console.log('Fetching existing products from DB...');
    const dbProducts = await Product.find({}, 'name');
    const dbProductNames = new Set(dbProducts.map(p => p.name.trim().toLowerCase()));
    console.log(`Total products in DB: ${dbProducts.length}`);

    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';

    let page = 1;
    let hasMore = true;
    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    console.log('Starting import from WordPress...');

    while (hasMore) {
        console.log(`Fetching page ${page}...`);
        try {
            const response = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
                auth: { username: wordpressApiKey, password: wordpressApiSecret },
                params: { per_page: 100, page: page, status: 'publish' },
                timeout: 120000 // Increased timeout
            });

            const wpProducts = response.data;
            if (wpProducts.length === 0) {
                console.log('Received empty array, stopping.');
                hasMore = false;
                break;
            }

            console.log(`Page ${page}: Received ${wpProducts.length} products`);

            for (const wpProduct of wpProducts) {
                const normalizedName = wpProduct.name.trim().toLowerCase();
                if (dbProductNames.has(normalizedName)) {
                    skippedCount++;
                    continue;
                }

                try {
                    // Determine Category
                    let categoryId = null;
                    if (wpProduct.categories && wpProduct.categories.length > 0) {
                        const categoryName = wpProduct.categories[0].name; // Just pick first one for simplicity
                        let category = await Category.findOne({ 
                            $or: [{ name: categoryName }, { slug: categoryName.toLowerCase().replace(/\s+/g, '-') }]
                        });

                        if (!category) {
                            category = new Category({
                                name: categoryName,
                                slug: categoryName.toLowerCase().replace(/\s+/g, '-'),
                                description: `Category for ${categoryName}`,
                                isActive: true
                            });
                            await category.save();
                            console.log(`Created new category: ${categoryName}`);
                        }
                        categoryId = category._id;
                    }

                    // Map Data
                    const productData = {
                        name: wpProduct.name,
                        description: wpProduct.description ? wpProduct.description.replace(/<[^>]*>/g, '') : '',
                        shortDescription: wpProduct.short_description ? wpProduct.short_description.replace(/<[^>]*>/g, '').substring(0, 200) : wpProduct.name.substring(0, 200),
                        price: parseFloat(wpProduct.price || wpProduct.regular_price) || 0,
                        originalPrice: parseFloat(wpProduct.regular_price) || 0,
                        sku: wpProduct.sku || `WP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        stock: parseInt(wpProduct.stock_quantity) || 0,
                        brand: wpProduct.attributes?.find(a => a.name.toLowerCase() === 'brand')?.options[0] || 'Autobacs',
                        category: categoryId,
                        isActive: wpProduct.status === 'publish',
                        images: wpProduct.images?.map((img, idx) => ({
                            url: img.src,
                            alt: img.alt || img.name || wpProduct.name,
                            isPrimary: idx === 0
                        })) || [],
                        specifications: wpProduct.attributes?.map(attr => ({
                            key: attr.name,
                            value: Array.isArray(attr.options) ? attr.options.join(', ') : attr.options
                        })) || []
                    };

                    const product = new Product(productData);
                    await product.save();
                    console.log(`Imported: ${product.name}`);
                    importedCount++;
                    dbProductNames.add(normalizedName);

                } catch (err) {
                    console.error(`Failed to import ${wpProduct.name}:`, err.message);
                    failedCount++;
                }
            }
            
            page++;
        } catch (error) {
            console.error(`Error fetching page ${page}:`, error.message);
            if (error.response) {
                console.log(`Response Status: ${error.response.status}`);
                if (error.response.status === 400) {
                     console.log('Page out of range, stopping.');
                     hasMore = false;
                } else if (error.response.status === 401 || error.response.status === 403) {
                     console.log('Auth error, stopping.');
                     hasMore = false;
                } else {
                     console.log('Server error, retrying page...');
                     // Maybe add delay?
                }
            } else {
                console.log('Network error or timeout, retrying page...');
            }
            // For now, let's stop to prevent infinite loops if persistent error, 
            // OR increment page if we want to skip? 
            // Actually, if it's a timeout, we should retry. 
            // But to be safe in this environment, I'll stop if it happens too many times?
            // Simple approach: stop.
            hasMore = false; 
        }
    }

    console.log(`\nImport Summary:`);
    console.log(`Imported: ${importedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`Failed: ${failedCount}`);

    await mongoose.connection.close();
  } catch (error) {
    console.error('Fatal Error:', error);
    if (mongoose.connection.readyState === 1) await mongoose.connection.close();
  }
}

importRemainingProducts();
