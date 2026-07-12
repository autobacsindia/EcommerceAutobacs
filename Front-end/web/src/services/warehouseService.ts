import apiClient from '@/lib/api';

export interface WarehouseFormData {
  name: string;
  code: string;
  type: 'warehouse' | 'store' | 'hub';
  location: {
    address: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    // Manual coordinates — the backend converts these to GeoJSON. Required
    // because geospatial warehouse routing depends on them.
    latitude: number | '';
    longitude: number | '';
  };
  serviceablePinCodes: string[];
  operationalStatus: 'active' | 'inactive' | 'maintenance';
  contactInfo: {
    phone: string;
    email: string;
    manager: string;
  };
  capacity: number;
}

export interface WarehouseListItem {
  _id: string;
  name: string;
  code: string;
  type: 'warehouse' | 'store' | 'hub';
  location: {
    address: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    // GeoJSON Point — coordinates are [longitude, latitude].
    coordinates?: { type: 'Point'; coordinates: [number, number] };
  };
  operationalStatus: 'active' | 'inactive' | 'maintenance';
  contactInfo: { phone: string; email: string; manager: string };
  capacity: number;
  serviceablePinCodes: string[];
  isActive: boolean;
  showOnHomepage: boolean;
  createdAt: string;
}

export interface InventoryItem {
  _id: string;
  product: { _id: string; name: string; sku?: string; price: number };
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderLevel: number;
  reorderQuantity: number;
  lastRestocked?: string;
  location?: string;
  isActive: boolean;
}

export interface LowStockItem {
  _id: string;
  product: { _id: string; name: string; sku?: string };
  quantity: number;
  reorderLevel: number;
  reorderQuantity: number;
}

export interface WarehouseFilters {
  status?: string;
  type?: string;
  city?: string;
}

export interface InventoryFilters {
  page?: number;
  limit?: number;
  search?: string;
  lowStock?: boolean;
}

class WarehouseService {
  private base = '/warehouses';

  async getWarehouses(filters: WarehouseFilters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.type) params.set('type', filters.type);
    if (filters.city) params.set('city', filters.city);
    const qs = params.toString();
    return apiClient.get<{ success: boolean; warehouses: WarehouseListItem[]; count: number }>(
      `${this.base}${qs ? `?${qs}` : ''}`
    );
  }

  async getWarehouse(id: string) {
    return apiClient.get<{ success: boolean; warehouse: WarehouseListItem }>(`${this.base}/${id}`);
  }

  async createWarehouse(data: WarehouseFormData) {
    return apiClient.post<{ success: boolean; warehouse: WarehouseListItem }>(this.base, data);
  }

  async updateWarehouse(id: string, data: Partial<WarehouseFormData>) {
    return apiClient.put<{ success: boolean; warehouse: WarehouseListItem }>(
      `${this.base}/${id}`,
      data
    );
  }

  async toggleHomepage(id: string, enabled: boolean) {
    return apiClient.put<{ success: boolean; warehouse: WarehouseListItem }>(
      `${this.base}/${id}`,
      { showOnHomepage: enabled }
    );
  }

  async deleteWarehouse(id: string) {
    return apiClient.delete<{ success: boolean; message: string }>(`${this.base}/${id}`);
  }

  async getInventory(id: string, filters: InventoryFilters = {}) {
    const params = new URLSearchParams();
    if (filters.page) params.set('page', String(filters.page));
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.search) params.set('search', filters.search);
    if (filters.lowStock) params.set('lowStock', 'true');
    const qs = params.toString();
    return apiClient.get<{
      success: boolean;
      inventory: InventoryItem[];
      total: number;
      pages: number;
      currentPage: number;
    }>(`${this.base}/${id}/inventory${qs ? `?${qs}` : ''}`);
  }

  async updateInventoryStock(
    warehouseId: string,
    productId: string,
    data: { quantity?: number; reorderLevel?: number; reorderQuantity?: number; location?: string }
  ) {
    return apiClient.put<{ success: boolean; inventory: InventoryItem }>(
      `${this.base}/${warehouseId}/inventory/${productId}`,
      data
    );
  }

  async getLowStock(id: string) {
    return apiClient.get<{ success: boolean; lowStockItems: LowStockItem[]; count: number }>(
      `${this.base}/${id}/low-stock`
    );
  }
}

export const warehouseService = new WarehouseService();
export default warehouseService;
