/**
 * Offline-First Cart Storage
 * 
 * Implements local-first cart persistence that works:
 * - ✅ Without authentication (guest users)
 * - ✅ Without network connection (offline)
 * - ✅ With automatic sync when online
 * - ✅ With conflict resolution
 * 
 * Architecture:
 * UI → localStorage/IndexedDB → Sync Layer → API
 *      ↑
 *      Source of truth (offline-safe)
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  images: any[];
  stock: number;
  addedAt: string;
}

interface LocalCart {
  items: CartItem[];
  updatedAt: string;
  version: number;
}

interface SyncQueueItem {
  action: 'add' | 'remove' | 'update' | 'clear';
  productId?: string;
  quantity?: number;
  timestamp: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CART_STORAGE_KEY = 'autobacs_cart';
const SYNC_QUEUE_KEY = 'autobacs_cart_sync_queue';
const CART_VERSION = 1;

// ── Storage Functions ────────────────────────────────────────────────────────

/**
 * Get cart from localStorage
 */
export const getLocalCart = (): LocalCart | null => {
  try {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (!stored) return null;
    
    const cart: LocalCart = JSON.parse(stored);
    
    // Validate structure
    if (!cart.items || !Array.isArray(cart.items)) {
      console.warn('[Cart] Invalid cart structure, clearing');
      localStorage.removeItem(CART_STORAGE_KEY);
      return null;
    }
    
    return cart;
  } catch (error) {
    console.error('[Cart] Failed to load cart from localStorage:', error);
    return null;
  }
};

/**
 * Save cart to localStorage
 */
export const saveLocalCart = (cart: LocalCart): void => {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({
      ...cart,
      updatedAt: new Date().toISOString(),
      version: CART_VERSION
    }));
  } catch (error) {
    console.error('[Cart] Failed to save cart to localStorage:', error);
    // Handle quota exceeded
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.warn('[Cart] Storage quota exceeded, clearing old cart');
      localStorage.removeItem(CART_STORAGE_KEY);
    }
  }
};

/**
 * Clear local cart
 */
export const clearLocalCart = (): void => {
  localStorage.removeItem(CART_STORAGE_KEY);
  localStorage.removeItem(SYNC_QUEUE_KEY);
};

// ── Cart Operations ──────────────────────────────────────────────────────────

/**
 * Add item to local cart
 */
export const addToLocalCart = (item: Omit<CartItem, 'addedAt'>): LocalCart => {
  const cart = getLocalCart() || { items: [], updatedAt: new Date().toISOString(), version: CART_VERSION };
  
  // Check if item already exists
  const existingIndex = cart.items.findIndex(i => i.productId === item.productId);
  
  if (existingIndex >= 0) {
    // Update quantity
    cart.items[existingIndex].quantity += item.quantity;
  } else {
    // Add new item
    cart.items.push({
      ...item,
      addedAt: new Date().toISOString()
    });
  }
  
  saveLocalCart(cart);
  return cart;
};

/**
 * Remove item from local cart
 */
export const removeFromLocalCart = (productId: string): LocalCart => {
  const cart = getLocalCart() || { items: [], updatedAt: new Date().toISOString(), version: CART_VERSION };
  
  cart.items = cart.items.filter(item => item.productId !== productId);
  
  saveLocalCart(cart);
  return cart;
};

/**
 * Update item quantity in local cart
 */
export const updateLocalCartQuantity = (productId: string, quantity: number): LocalCart => {
  const cart = getLocalCart() || { items: [], updatedAt: new Date().toISOString(), version: CART_VERSION };
  
  const itemIndex = cart.items.findIndex(i => i.productId === productId);
  
  if (itemIndex >= 0) {
    if (quantity <= 0) {
      // Remove item
      cart.items.splice(itemIndex, 1);
    } else {
      // Update quantity
      cart.items[itemIndex].quantity = quantity;
    }
  }
  
  saveLocalCart(cart);
  return cart;
};

/**
 * Clear local cart
 */
export const clearLocalCartItems = (): LocalCart => {
  const emptyCart: LocalCart = {
    items: [],
    updatedAt: new Date().toISOString(),
    version: CART_VERSION
  };
  
  saveLocalCart(emptyCart);
  return emptyCart;
};

// ── Sync Queue ───────────────────────────────────────────────────────────────

/**
 * Add action to sync queue
 */
export const addToSyncQueue = (action: Omit<SyncQueueItem, 'timestamp'>): void => {
  try {
    const queue = getSyncQueue();
    queue.push({
      ...action,
      timestamp: Date.now()
    });
    
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('[Cart Sync] Failed to add to sync queue:', error);
  }
};

/**
 * Get sync queue
 */
export const getSyncQueue = (): SyncQueueItem[] => {
  try {
    const stored = localStorage.getItem(SYNC_QUEUE_KEY);
    if (!stored) return [];
    
    return JSON.parse(stored);
  } catch (error) {
    console.error('[Cart Sync] Failed to load sync queue:', error);
    return [];
  }
};

/**
 * Clear sync queue
 */
export const clearSyncQueue = (): void => {
  localStorage.removeItem(SYNC_QUEUE_KEY);
};

/**
 * Process sync queue (send pending actions to server)
 */
export const processSyncQueue = async (apiClient: any): Promise<void> => {
  const queue = getSyncQueue();
  
  if (queue.length === 0) return;
  
  console.log(`[Cart Sync] Processing ${queue.length} pending actions`);
  
  const failedActions: SyncQueueItem[] = [];
  
  for (const action of queue) {
    try {
      switch (action.action) {
        case 'add':
          if (action.productId) {
            await apiClient.post('/api/v1/cart/add', {
              productId: action.productId,
              quantity: action.quantity || 1
            });
          }
          break;
        
        case 'remove':
          if (action.productId) {
            await apiClient.delete(`/api/v1/cart/remove/${action.productId}`);
          }
          break;
        
        case 'update':
          if (action.productId) {
            await apiClient.put(`/api/v1/cart/update/${action.productId}`, {
              quantity: action.quantity || 1
            });
          }
          break;
        
        case 'clear':
          await apiClient.delete('/api/v1/cart/clear');
          break;
      }
    } catch (error) {
      console.warn(`[Cart Sync] Failed to sync action:`, action, error);
      failedActions.push(action);
    }
  }
  
  // Keep failed actions in queue for retry
  if (failedActions.length > 0) {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(failedActions));
    console.warn(`[Cart Sync] ${failedActions.length} actions failed, will retry later`);
  } else {
    clearSyncQueue();
    console.log('[Cart Sync] All actions synced successfully');
  }
};

// ── Conflict Resolution ──────────────────────────────────────────────────────

/**
 * Merge local cart with server cart
 * 
 * Strategy: Intelligent quantity merge
 * - If same product exists in both, use higher quantity
 * - Add items that exist only in local
 * - Add items that exist only in server
 */
export const mergeCarts = (
  localCart: LocalCart,
  serverCart: any
): LocalCart => {
  const mergedItems = [...localCart.items];
  
  // Process server items
  for (const serverItem of serverCart.items || []) {
    const localIndex = mergedItems.findIndex(
      i => i.productId === serverItem.product._id
    );
    
    if (localIndex >= 0) {
      // Item exists in both - use higher quantity
      const localItem = mergedItems[localIndex];
      mergedItems[localIndex] = {
        ...localItem,
        quantity: Math.max(localItem.quantity, serverItem.quantity)
      };
    } else {
      // Item only in server - add it
      mergedItems.push({
        productId: serverItem.product._id,
        name: serverItem.product.name,
        price: serverItem.product.price,
        quantity: serverItem.quantity,
        images: serverItem.product.images || [],
        stock: serverItem.product.stock,
        addedAt: new Date().toISOString()
      });
    }
  }
  
  const mergedCart: LocalCart = {
    items: mergedItems,
    updatedAt: new Date().toISOString(),
    version: CART_VERSION
  };
  
  saveLocalCart(mergedCart);
  return mergedCart;
};

// ── Cart Statistics ──────────────────────────────────────────────────────────

/**
 * Get cart statistics
 */
export const getCartStats = () => {
  const cart = getLocalCart();
  const queue = getSyncQueue();
  
  return {
    itemCount: cart?.items.length || 0,
    totalQuantity: cart?.items.reduce((sum, item) => sum + item.quantity, 0) || 0,
    totalPrice: cart?.items.reduce((sum, item) => sum + (item.price * item.quantity), 0) || 0,
    pendingSyncActions: queue.length,
    lastUpdated: cart?.updatedAt || null
  };
};

// ── Online/Offline Detection ─────────────────────────────────────────────────

/**
 * Check if browser is online
 */
export const isOnline = (): boolean => {
  return navigator.onLine;
};

/**
 * Add online/offline event listeners
 */
export const onNetworkChange = (callback: (online: boolean) => void): (() => void) => {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);
  
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  
  // Return cleanup function
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
};
