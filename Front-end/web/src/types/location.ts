/**
 * Location Service Type Definitions
 */

export interface Coordinates {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
}

export interface Address {
  formatted: string;
  street?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  coordinates: Coordinates;
}

export interface UserLocation {
  _id: string;
  user?: string;
  sessionId?: string;
  selectedAddress: Address;
  deliveryZone?: string | DeliveryZone;
  nearestWarehouse?: string | Warehouse;
  placeId?: string;
  lastUsed: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryTime {
  minDays: number;
  maxDays: number;
}

export interface ShippingCost {
  baseRate: number;
  perKgRate: number;
}

export interface DeliveryZone {
  _id: string;
  name: string;
  type: "metro" | "tier1" | "tier2" | "remote";
  pinCodes: string[];
  cities: string[];
  states: string[];
  deliveryTime: DeliveryTime;
  shippingCost: ShippingCost;
  isServiceable: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryEstimate {
  minDate: Date | string;
  maxDate: Date | string;
  formattedRange: string;
}

export interface WarehouseLocation {
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  coordinates: Coordinates;
}

export interface Warehouse {
  _id: string;
  name: string;
  code: string;
  type: "warehouse" | "store" | "hub";
  location: WarehouseLocation;
  serviceablePinCodes: string[];
  operationalStatus: "active" | "inactive" | "maintenance";
  capacity: number;
  isActive: boolean;
  distance?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WarehouseInventory {
  _id: string;
  warehouse: string | Warehouse;
  product: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderLevel: number;
  reorderQuantity: number;
  lastRestocked?: Date;
  isActive: boolean;
}

export interface ProductAvailability {
  totalStock: number;
  available: number;
  reserved: number;
  warehouses: Array<{
    warehouse: Warehouse;
    quantity: number;
    reservedQuantity: number;
    available: number;
  }>;
  inStock: boolean;
}

export interface LocationSelectRequest {
  placeId?: string;
  address?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  street?: string;
}

export interface LocationSelectResponse {
  success: boolean;
  location: UserLocation;
  deliveryZone: DeliveryZone;
  nearestWarehouse: Warehouse;
  deliveryEstimate: DeliveryEstimate;
}

export interface LocationValidateRequest {
  postalCode: string;
}

export interface LocationValidateResponse {
  success: boolean;
  serviceable: boolean;
  zone?: DeliveryZone;
  deliveryEstimate?: DeliveryEstimate;
  message: string;
}

export interface DeliveryEstimateRequest {
  pinCode: string;
  orderDate?: Date | string;
}

export interface DeliveryEstimateResponse {
  success: boolean;
  zone: {
    name: string;
    type: string;
  };
  estimate: DeliveryEstimate;
  deliveryDays: string;
}

export interface ShippingCostRequest {
  pinCode: string;
  weightKg?: number;
}

export interface ShippingCostResponse {
  success: boolean;
  zone: string;
  weightKg: number;
  shippingCost: number;
  breakdown: {
    baseRate: number;
    perKgRate: number;
    weightCharge: number;
  };
}

export interface WarehouseSelectionRequest {
  orderItems: Array<{
    productId: string;
    quantity: number;
  }>;
  deliveryAddress: {
    coordinates: {
      latitude: number;
      longitude: number;
    };
    postalCode: string;
  };
}

export interface WarehouseSelectionResponse {
  success: boolean;
  available: boolean;
  warehouse?: Warehouse;
  distance?: number;
  distanceKm?: string;
  inventory?: WarehouseInventory[];
  message?: string;
}

// Google Maps related types
export interface PlacePrediction {
  description: string;
  place_id: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export interface GoogleMapsConfig {
  apiKey: string;
  region: string;
  language: string;
}

// Context types for React
export interface LocationContextType {
  currentLocation: UserLocation | null;
  deliveryZone: DeliveryZone | null;
  deliveryEstimate: DeliveryEstimate | null;
  isLoading: boolean;
  error: string | null;
  selectLocation: (data: LocationSelectRequest) => Promise<void>;
  clearLocation: () => Promise<void>;
  validateAddress: (postalCode: string) => Promise<LocationValidateResponse>;
  refreshLocation: () => Promise<void>;
}

// Component prop types
export interface LocationSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onLocationSelected?: (location: UserLocation) => void;
}

export interface LocationDisplayProps {
  location: UserLocation | null;
  compact?: boolean;
  showChangeButton?: boolean;
  onChangeClick?: () => void;
}

export interface DeliveryEstimateProps {
  postalCode?: string;
  deliveryZone?: DeliveryZone;
  className?: string;
  showIcon?: boolean;
}

export interface AvailabilityIndicatorProps {
  productId: string;
  showWarehouse?: boolean;
  className?: string;
}

// Error types
export interface LocationError {
  code: string;
  message: string;
  field?: string;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: LocationError;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
