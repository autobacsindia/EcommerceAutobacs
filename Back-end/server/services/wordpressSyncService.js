import axios from 'axios';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import { getRedisClient } from '../services/cacheService.js';

// WordPress API configuration
const WORDPRESS_SITE_URL = process.env.WORDPRESS_SITE_URL || '';
const WORDPRESS_API_VERSION = process.env.WORDPRESS_API_VERSION || 'wc/v3';
const WORDPRESS_CONSUMER_KEY = process.env.WORDPRESS_API_KEY || '';
const WORDPRESS_CONSUMER_SECRET = process.env.WORDPRESS_API_SECRET || '';

// Concurrency protection: Distributed lock via Redis (works across multiple server instances)
const SYNC_LOCK_KEY = 'wordpress:sync:lock';
const SYNC_LOCK_TTL = 600; // 10 minutes (max sync duration)

// Adaptive backpressure configuration
const BASE_BACKPRESSURE_DELAY = 200; // Base delay: 200ms
const MAX_BACKPRESSURE_DELAY = 5000; // Max delay: 5s
let currentBackpressureDelay = BASE_BACKPRESSURE_DELAY;
let consecutiveErrors = 0;

/**
 * Acquire distributed lock using Redis (works across multiple server instances)
 * Returns lock object with renewal capability
 */
async function acquireSyncLock() {
  try {
    const redis = await getRedisClient();
    if (!redis) {
      // Fallback to in-memory lock if Redis unavailable
      console.warn('[WordPress Sync] Redis unavailable, using in-memory lock (not cluster-safe)');
      return acquireInMemoryLock();
    }

    // Generate unique lock ID for this instance
    const lockId = `${process.pid}:${Date.now()}`;
    
    // SET NX EX: Set if Not eXists, with EXpiry
    const lock = await redis.set(SYNC_LOCK_KEY, lockId, 'NX', 'EX', SYNC_LOCK_TTL);
    
    if (lock !== 'OK') {
      return null; // Lock already held
    }
    
    // Return lock object with renewal capability
    return {
      lockId,
      renewalInterval: null,
      
      // Heartbeat: renew lock every 5 minutes to prevent expiry during long syncs
      startRenewal: async () => {
        this.renewalInterval = setInterval(async () => {
          try {
            const currentLock = await redis.get(SYNC_LOCK_KEY);
            if (currentLock === lockId) {
              await redis.expire(SYNC_LOCK_KEY, SYNC_LOCK_TTL);
              console.log('[WordPress Sync] Lock renewed (heartbeat)');
            } else {
              console.error('[WordPress Sync] Lock stolen! Another instance took over');
              clearInterval(this.renewalInterval);
            }
          } catch (error) {
            console.error('[WordPress Sync] Lock renewal failed:', error.message);
          }
        }, 5 * 60 * 1000); // Renew every 5 minutes
      },
      
      release: async () => {
        if (this.renewalInterval) {
          clearInterval(this.renewalInterval);
        }
        try {
          const currentLock = await redis.get(SYNC_LOCK_KEY);
          if (currentLock === lockId) {
            await redis.del(SYNC_LOCK_KEY);
          }
        } catch (error) {
          console.error('[WordPress Sync] Failed to release lock:', error.message);
        }
      }
    };
  } catch (error) {
    console.error('[WordPress Sync] Failed to acquire distributed lock:', error.message);
    return null;
  }
}

/**
 * Release distributed lock
 * @deprecated - Use lock.release() method instead
 */
async function releaseSyncLock() {
  console.warn('[WordPress Sync] releaseSyncLock() deprecated - use lock.release()');
}

// Fallback in-memory lock (only used if Redis is down)
let inMemoryLock = false;

function acquireInMemoryLock() {
  if (inMemoryLock) return false;
  inMemoryLock = true;
  return true;
}

function releaseInMemoryLock() {
  inMemoryLock = false;
}

/**
 * Calculate adaptive backpressure delay based on WooCommerce API response
 * Increases delay on errors, decreases on success
 */
function calculateBackpressureDelay(httpStatus) {
  // Success (2xx): Reset to base delay
  if (httpStatus >= 200 && httpStatus < 300) {
    consecutiveErrors = 0;
    currentBackpressureDelay = BASE_BACKPRESSURE_DELAY;
    return currentBackpressureDelay;
  }
  
  // Rate limited (429) or timeout (408): Increase delay significantly
  if (httpStatus === 429 || httpStatus === 408) {
    consecutiveErrors++;
    currentBackpressureDelay = Math.min(
      currentBackpressureDelay * 2,
      MAX_BACKPRESSURE_DELAY
    );
    console.warn(`[WordPress Sync] Rate limited/timeout. Increased delay to ${currentBackpressureDelay}ms`);
    return currentBackpressureDelay;
  }
  
  // Server errors (5xx): Increase delay moderately
  if (httpStatus >= 500) {
    consecutiveErrors++;
    currentBackpressureDelay = Math.min(
      currentBackpressureDelay * 1.5,
      MAX_BACKPRESSURE_DELAY
    );
    console.warn(`[WordPress Sync] Server error. Increased delay to ${currentBackpressureDelay}ms`);
    return currentBackpressureDelay;
  }
  
  // Other errors: Slight increase
  consecutiveErrors++;
  currentBackpressureDelay = Math.min(
    currentBackpressureDelay * 1.2,
    MAX_BACKPRESSURE_DELAY
  );
  return currentBackpressureDelay;
}

/**
 * Validate WooCommerce product data (skip malformed entries)
 */
function validateProductData(wpProduct) {
  if (!wpProduct || typeof wpProduct !== 'object') {
    return false;
  }
  
  // Required fields
  if (!wpProduct.id || !wpProduct.name) {
    console.warn('[WordPress Sync] Skipping product: missing id or name', wpProduct);
    return false;
  }
  
  // Data type validation
  if (typeof wpProduct.id !== 'number') {
    console.warn('[WordPress Sync] Skipping product: invalid id type', wpProduct.id);
    return false;
  }
  
  if (typeof wpProduct.name !== 'string' || wpProduct.name.trim() === '') {
    console.warn('[WordPress Sync] Skipping product: invalid name', wpProduct.name);
    return false;
  }
  
  return true;
}

/**
 * Create WordPress API client
 */
function createWordPressClient() {
  if (!WORDPRESS_SITE_URL || !WORDPRESS_CONSUMER_KEY || !WORDPRESS_CONSUMER_SECRET) {
    console.warn('[WordPress Sync] API not configured. Please check environment variables.');
    return null;
  }
  
  return axios.create({
    baseURL: `${WORDPRESS_SITE_URL}/wp-json`,
    auth: {
      username: WORDPRESS_CONSUMER_KEY,
      password: WORDPRESS_CONSUMER_SECRET
    },
    timeout: 60000
  });
}

/**
 * Fetch with retry logic (exponential backoff)
 */
async function fetchWithRetry(fn, retries = 3, delay = 1000) {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    
    // Don't retry client errors (4xx) except 429 or 408
    if (error.response && error.response.status >= 400 && error.response.status < 500) {
      if (error.response.status !== 429 && error.response.status !== 408) {
        throw error;
      }
    }
    
    console.warn(`[WordPress Sync] Request failed. Retrying in ${delay}ms... (${retries} retries left)`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchWithRetry(fn, retries - 1, delay * 2);
  }
}

/**
 * Sync all products from WooCommerce to MongoDB
 * Uses upsert (update or insert) to prevent duplicates
 * Also removes products that were deleted from WooCommerce
 */
export async function syncProducts() {
  const startTime = Date.now();
  
  // CRITICAL: Acquire distributed lock with renewal capability
  const lock = await acquireSyncLock();
  if (!lock) {
    console.warn('[WordPress Sync] Sync already running (distributed lock), skipping...');
    return {
      success: false,
      message: 'Sync already in progress on another instance',
      totalSynced: 0,
      totalInserted: 0,
      totalUpdated: 0,
      totalDeleted: 0
    };
  }

  // Start lock renewal heartbeat (prevents expiry during long syncs)
  if (lock.startRenewal) {
    lock.startRenewal();
  }

  const wpClient = createWordPressClient();
  if (!wpClient) {
    await lock.release();
    if (lock.releaseInMemory) lock.releaseInMemory();
    throw new Error('WordPress API not configured');
  }

  console.log('[WordPress Sync] Starting product sync...');
  
  let page = 1;
  let hasMore = true;
  let totalSynced = 0;
  let totalUpdated = 0;
  let totalInserted = 0;
  let totalDeleted = 0;
  const wpProductIds = new Set(); // Track all WordPress product IDs
  
  try {
    while (hasMore) {
      const response = await fetchWithRetry(() => 
        wpClient.get(`/${WORDPRESS_API_VERSION}/products`, { 
          params: { 
            per_page: 100, 
            page,
            status: 'publish' // Only sync published products
          } 
        })
      );
      
      const products = response.data;
      
      // CRITICAL: Validate product data before processing
      const validProducts = products.filter(validateProductData);
      if (validProducts.length < products.length) {
        console.warn(`[WordPress Sync] Skipped ${products.length - validProducts.length} invalid products`);
      }
      
      // Collect all WordPress product IDs
      validProducts.forEach(p => wpProductIds.add(p.id));
      
      // Upsert each product
      for (const wpProduct of validProducts) {
        const existingProduct = await Product.findOne({ wpId: wpProduct.id });
        
        const productData = {
          // WordPress sync fields
          wpId: wpProduct.id,
          wpSlug: wpProduct.slug,
          syncedFromWordPress: true,
          lastSyncedAt: new Date(),
          
          // Product fields
          name: wpProduct.name,
          slug: wpProduct.slug,
          description: wpProduct.description || '',
          shortDescription: wpProduct.short_description || '',
          price: parseFloat(wpProduct.price) || 0,
          salePrice: wpProduct.sale_price ? parseFloat(wpProduct.sale_price) : null,
          regularPrice: wpProduct.regular_price ? parseFloat(wpProduct.regular_price) : null,
          stock: wpProduct.stock_quantity || 0,
          sku: wpProduct.sku || '',
          status: wpProduct.status === 'publish' ? 'active' : 'inactive',
          
          // Images (extract URLs)
          images: wpProduct.images ? wpProduct.images.map(img => ({
            url: img.src,
            alt: img.alt || wpProduct.name,
            public_id: `wp_${img.id}`
          })) : [],
          
          // Categories (store IDs for mapping)
          categoryIds: wpProduct.categories ? wpProduct.categories.map(cat => cat.id) : [],
          
          // Metadata
          createdAt: existingProduct?.createdAt || new Date(),
          updatedAt: new Date()
        };
        
        // Upsert: Update if exists, insert if new
        const result = await Product.findOneAndUpdate(
          { wpId: wpProduct.id },
          productData,
          { upsert: true, new: true }
        );
        
        totalSynced++;
        if (existingProduct) {
          totalUpdated++;
        } else {
          totalInserted++;
        }
      }
      
      // Check if there are more pages
      hasMore = products.length === 100;
      page++;
      
      console.log(`[WordPress Sync] Processed page ${page - 1}, synced ${products.length} products`);
      
      // CRITICAL: Adaptive backpressure - adjust delay based on WooCommerce response
      if (hasMore) {
        const backpressureDelay = calculateBackpressureDelay(response.status);
        await new Promise(resolve => setTimeout(resolve, backpressureDelay));
      }
    }
    
    // CRITICAL: Only delete products if sync completed successfully (prevents partial sync data loss)
    console.log('[WordPress Sync] Checking for deleted products...');
    const deleteResult = await Product.deleteMany({
      wpId: { $nin: Array.from(wpProductIds) },
      syncedFromWordPress: true
    });
    totalDeleted = deleteResult.deletedCount || 0;
    
    if (totalDeleted > 0) {
      console.log(`[WordPress Sync] Removed ${totalDeleted} products deleted from WooCommerce`);
    }
    
    // CRITICAL: Invalidate cache after sync completes
    try {
      await invalidateProductCache();
    } catch (cacheError) {
      console.error('[WordPress Sync] Cache invalidation failed:', cacheError.message);
      // Don't throw - sync succeeded even if cache invalidation failed
    }
    
    const duration = Date.now() - startTime;
    
    console.log(`[WordPress Sync] Product sync completed in ${duration}ms: ${totalSynced} total (${totalInserted} new, ${totalUpdated} updated, ${totalDeleted} deleted)`);
    
    // CRITICAL: Track sync metrics in Redis for monitoring
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.set('wordpress:sync:last_time', Date.now());
        await redis.set('wordpress:sync:last_duration', duration);
        await redis.set('wordpress:sync:last_total', totalSynced);
        await redis.set('wordpress:sync:last_inserted', totalInserted);
        await redis.set('wordpress:sync:last_updated', totalUpdated);
        await redis.set('wordpress:sync:last_deleted', totalDeleted);
        await redis.set('wordpress:sync:status', 'success');
        
        // CRITICAL: Actionable alerts based on metrics
        // Alert if zero products synced (possible WooCommerce API issue)
        if (totalSynced === 0) {
          console.error('[WordPress Sync] ALERT: Zero products synced! Possible API failure');
          try {
            const Sentry = await import('@sentry/node');
            Sentry.captureMessage('WordPress sync returned zero products', {
              level: 'error',
              tags: { component: 'wordpress-sync', alert_type: 'zero_products' }
            });
          } catch (sentryError) {
            // Sentry not configured
          }
        }
        
        // Alert if duration spiked (> 2x average)
        const avgDuration = parseInt(await redis.get('wordpress:sync:avg_duration') || '0');
        if (avgDuration > 0 && duration > avgDuration * 2) {
          console.warn(`[WordPress Sync] ALERT: Duration spike detected (${duration}ms vs avg ${avgDuration}ms)`);
        }
        
        // Update rolling average duration
        const previousAvg = parseInt(await redis.get('wordpress:sync:avg_duration') || '0');
        const newAvg = previousAvg === 0 ? duration : Math.round((previousAvg + duration) / 2);
        await redis.set('wordpress:sync:avg_duration', newAvg);
      }
    } catch (metricsError) {
      console.error('[WordPress Sync] Failed to track metrics:', metricsError.message);
    }
    
    return {
      success: true,
      totalSynced,
      totalInserted,
      totalUpdated,
      totalDeleted
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[WordPress Sync] Product sync failed after ${duration}ms:`, error.message);
    
    // Track failure metrics
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.set('wordpress:sync:last_duration', duration);
        await redis.set('wordpress:sync:status', 'failed');
        await redis.set('wordpress:sync:last_error', error.message);
      }
    } catch (metricsError) {
      // Ignore metrics failure
    }
    
    throw error;
  } finally {
    // CRITICAL: Always release lock (even on error)
    if (lock.release) {
      await lock.release();
    } else {
      // Fallback for in-memory lock
      releaseInMemoryLock();
    }
  }
}

/**
 * Sync all categories from WooCommerce to MongoDB
 */
export async function syncCategories() {
  const wpClient = createWordPressClient();
  if (!wpClient) {
    throw new Error('WordPress API not configured');
  }

  console.log('[WordPress Sync] Starting category sync...');
  
  let page = 1;
  let hasMore = true;
  let totalSynced = 0;
  
  try {
    while (hasMore) {
      const response = await fetchWithRetry(() => 
        wpClient.get(`/${WORDPRESS_API_VERSION}/products/categories`, { 
          params: { 
            per_page: 100, 
            page 
          } 
        })
      );
      
      const categories = response.data;
      
      // Upsert each category
      for (const wpCategory of categories) {
        await Category.findOneAndUpdate(
          { wpId: wpCategory.id },
          {
            wpId: wpCategory.id,
            name: wpCategory.name,
            slug: wpCategory.slug,
            description: wpCategory.description || '',
            parent: wpCategory.parent || 0,
            count: wpCategory.count || 0,
            syncedFromWordPress: true,
            lastSyncedAt: new Date(),
            updatedAt: new Date()
          },
          { upsert: true, new: true }
        );
        
        totalSynced++;
      }
      
      // Check if there are more pages
      hasMore = categories.length === 100;
      page++;
    }
    
    console.log(`[WordPress Sync] Category sync completed: ${totalSynced} categories synced`);
    
    return {
      success: true,
      totalSynced
    };
    
  } catch (error) {
    console.error('[WordPress Sync] Category sync failed:', error.message);
    throw error;
  }
}

/**
 * Invalidate product cache after sync
 * Clears all product-related cache keys to serve fresh data
 */
async function invalidateProductCache() {
  try {
    const redis = await getRedisClient();
    if (!redis) {
      console.log('[WordPress Sync] Redis not available, skipping cache invalidation');
      return;
    }

    // Clear all product cache keys (using pattern matching)
    const keys = await redis.keys('products:*');
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[WordPress Sync] Cleared ${keys.length} product cache keys`);
    }

    // Also clear category cache
    const categoryKeys = await redis.keys('categories:*');
    if (categoryKeys.length > 0) {
      await redis.del(...categoryKeys);
      console.log(`[WordPress Sync] Cleared ${categoryKeys.length} category cache keys`);
    }
  } catch (error) {
    console.error('[WordPress Sync] Cache invalidation error:', error.message);
    throw error;
  }
}

/**
 * Manual sync trigger (for admin panel)
 * Includes cooldown protection to prevent abuse
 */
let lastManualSyncTime = 0;
const MANUAL_SYNC_COOLDOWN = 5 * 60 * 1000; // 5 minutes

export async function triggerManualSync() {
  console.log('[WordPress Sync] Manual sync triggered by admin');
  
  // Cooldown check: prevent manual sync abuse
  const now = Date.now();
  if (now - lastManualSyncTime < MANUAL_SYNC_COOLDOWN) {
    const remaining = Math.ceil((MANUAL_SYNC_COOLDOWN - (now - lastManualSyncTime)) / 1000);
    throw new Error(`Please wait ${remaining} seconds before triggering another sync`);
  }
  
  lastManualSyncTime = now;
  
  try {
    const productsResult = await syncProducts();
    const categoriesResult = await syncCategories();
    
    // Send alert on successful manual sync (if Sentry configured)
    try {
      const Sentry = await import('@sentry/node');
      Sentry.captureMessage('Manual WordPress sync completed', {
        level: 'info',
        tags: { component: 'wordpress-manual-sync' },
        extra: {
          products: productsResult,
          categories: categoriesResult
        }
      });
    } catch (sentryError) {
      // Sentry not configured, ignore
    }
    
    return {
      success: true,
      message: 'Sync completed successfully',
      products: productsResult,
      categories: categoriesResult
    };
  } catch (error) {
    console.error('[WordPress Sync] Manual sync failed:', error.message);
    
    // Send error alert to Sentry
    try {
      const Sentry = await import('@sentry/node');
      Sentry.captureException(error, {
        tags: { component: 'wordpress-manual-sync' }
      });
    } catch (sentryError) {
      // Sentry not configured, ignore
    }
    
    throw error;
  }
}
