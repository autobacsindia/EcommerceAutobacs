// Types for order tracking functionality

export interface TrackingEvent {
  timestamp: string;
  status: EventStatus;
  location: string;
  description: string;
  scannedBy?: string;
}

export type EventStatus = 
  | 'label_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed_delivery'
  | 'returned'
  | 'exception';

// Fulfillment axis (Phase 2). Legacy values retained for historical orders and
// existing comparisons; the payment axis lives separately in paymentStatus.
export type OrderStatus =
  | 'awaiting_payment'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'returned'
  | 'cancelled'
  | 'pending'
  | 'confirmed'
  | 'refunded'
  | 'failed';

export interface Carrier {
  name: string;
  code: string;
  trackingUrl: string;
}

export interface TrackingDestination {
  city: string;
  state: string;
  postalCode: string;
}

export interface TrackingData {
  success: boolean;
  trackingNumber: string;
  carrier: Carrier;
  currentStatus: OrderStatus;
  estimatedDelivery: string;
  destination: TrackingDestination;
  events: TrackingEvent[];
}

export interface CarrierInfo {
  name: string;
  code: string;
  estimatedDeliveryDays: number;
  logoUrl?: string;
  trackingUrlPattern?: string;
}

export interface TrackingAPIResponse {
  success: boolean;
  trackingNumber?: string;
  carrier?: Carrier;
  currentStatus?: OrderStatus;
  estimatedDelivery?: string;
  destination?: TrackingDestination;
  events?: TrackingEvent[];
  message?: string;
}

export interface CarriersAPIResponse {
  success: boolean;
  carriers: CarrierInfo[];
}
