/**
 * Order Tracking Service
 * Handles tracking number generation, tracking events, and carrier integration
 */

import Order from '../models/Order.js';
import crypto from 'crypto';
import { enqueueDeliveryUpdateEmail, customerVisibleChange } from './deliveryUpdateEmailService.js';

/**
 * Code of the free-text "Other" carrier — the admin supplies the courier name.
 */
const OTHER_CARRIER_CODE = 'OTHER';

/** Permissive AWB shape for couriers whose numbers we have no pattern for. */
const LOOSE_AWB_FORMAT = /^[A-Za-z0-9][A-Za-z0-9-/]{3,39}$/;

/**
 * Supported carriers — the ONE courier list for the whole site (the admin order
 * page and the team panel's "Delivery partner" dropdown both read it through
 * GET /orders/tracking/carriers).
 *
 * `trackingUrl` is the courier's tracking page. Where `{id}` appears in it, the
 * tracking number is put there (URL-encoded) and the link opens that parcel. Where
 * it does not, the link opens the plain tracking page and staff paste the copied
 * number in — today's VRL / Delhivery / DTDC / Trackon / Shree Tirupati pages do
 * not take the number in the address. If one starts to, add `{id}` to its link.
 *
 * `deliveryPartner: true` puts the courier in the team panel's dropdown, in the
 * order listed here.
 */
const CARRIERS = {
  VRL: {
    name: 'VRL',
    code: 'VRL',
    deliveryPartner: true,
    trackingUrl: 'https://www.vrlgroup.in/Tracking/TrackShipment',
    trackingNumberFormat: LOOSE_AWB_FORMAT,
    estimatedDeliveryDays: null
  },
  FEDEX: {
    name: 'FedEx',
    code: 'FEDEX',
    trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr={id}',
    trackingNumberFormat: /^[0-9]{12,14}$/,
    estimatedDeliveryDays: 3
  },
  UPS: {
    name: 'UPS',
    code: 'UPS',
    trackingUrl: 'https://www.ups.com/track?tracknum={id}',
    trackingNumberFormat: /^1Z[A-Z0-9]{16}$/,
    estimatedDeliveryDays: 3
  },
  DHL: {
    name: 'DHL',
    code: 'DHL',
    trackingUrl: 'https://www.dhl.com/en/express/tracking.html?AWB={id}',
    trackingNumberFormat: /^[0-9]{10,11}$/,
    estimatedDeliveryDays: 4
  },
  USPS: {
    name: 'USPS',
    code: 'USPS',
    trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={id}',
    trackingNumberFormat: /^[0-9]{20,22}$/,
    estimatedDeliveryDays: 5
  },
  INDIA_POST: {
    name: 'India Post',
    code: 'INDIA_POST',
    trackingUrl: 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?tracknumber={id}',
    trackingNumberFormat: /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/,
    estimatedDeliveryDays: 7
  },
  DELHIVERY: {
    name: 'Delhivery',
    code: 'DELHIVERY',
    deliveryPartner: true,
    trackingUrl: 'https://www.delhivery.com/tracking',
    trackingNumberFormat: /^[0-9]{12,15}$/,
    estimatedDeliveryDays: 2
  },
  BLUE_DART: {
    name: 'Blue Dart',
    code: 'BLUE_DART',
    trackingUrl: 'https://www.bluedart.com/tracking?trackFor={id}',
    trackingNumberFormat: /^[0-9]{10,12}$/,
    estimatedDeliveryDays: 2
  },
  DTDC: {
    name: 'DTDC',
    code: 'DTDC',
    deliveryPartner: true,
    trackingUrl: 'https://www.dtdc.com/track-your-shipment/',
    trackingNumberFormat: /^[A-Z0-9]{10,15}$/,
    estimatedDeliveryDays: 3
  },
  TRACKON: {
    name: 'Trackon',
    code: 'TRACKON',
    deliveryPartner: true,
    trackingUrl: 'https://www.trackon.in/',
    trackingNumberFormat: LOOSE_AWB_FORMAT,
    estimatedDeliveryDays: null
  },
  SHREE_TIRUPATI: {
    name: 'Shree Tirupati Courier',
    code: 'SHREE_TIRUPATI',
    deliveryPartner: true,
    trackingUrl: 'https://www.shreetirupaticourier.net/',
    trackingNumberFormat: LOOSE_AWB_FORMAT,
    estimatedDeliveryDays: null
  },
  ECOM_EXPRESS: {
    name: 'Ecom Express',
    code: 'ECOM_EXPRESS',
    trackingUrl: 'https://ecomexpress.in/tracking/?awb_field={id}',
    trackingNumberFormat: /^[0-9]{12,14}$/,
    estimatedDeliveryDays: 3
  },
  // Escape hatch for regional/one-off couriers we don't model. Staff type the
  // courier's name and, optionally, its tracking page (http/https only); with no
  // page the order carries the number only and the shipped email omits the link.
  // Listed last on purpose — getSupportedCarriers preserves this order.
  OTHER: {
    name: 'Other courier',
    code: OTHER_CARRIER_CODE,
    custom: true,
    deliveryPartner: true,
    trackingUrl: null,
    // Permissive: third-party AWBs vary wildly (letters, digits, dashes).
    trackingNumberFormat: LOOSE_AWB_FORMAT,
    // No SLA to promise for an unknown courier — no ETA is derived.
    estimatedDeliveryDays: null
  }
};

/** Max length accepted for an admin-typed courier name. */
const MAX_CUSTOM_CARRIER_NAME = 60;

/** Max length accepted for a staff-typed courier tracking page. */
const MAX_CUSTOM_CARRIER_URL = 500;

/** Codes offered in the team panel's "Delivery partner" dropdown, in order. */
const DELIVERY_PARTNER_CODES = Object.values(CARRIERS).filter((c) => c.deliveryPartner).map((c) => c.code);

/**
 * The URL, normalised, when it is an absolute http(s) link — otherwise null.
 * Everything that becomes an <a href> or an email link passes through here, so
 * `javascript:`, `data:`, `vbscript:`, protocol-relative and credentialed URLs
 * never get stored or rendered.
 */
function safeHttpUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > MAX_CUSTOM_CARRIER_URL) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.toString();
}

/** A courier's tracking link for one parcel: `{id}` filled in, else the plain page. */
function carrierTrackingLink(carrier, trackingNumber) {
  const page = carrier?.trackingUrl;
  if (!page) return null;
  if (!page.includes('{id}')) return page;
  const id = String(trackingNumber || '').trim();
  return id ? page.split('{id}').join(encodeURIComponent(id)) : null;
}

/** A built-in courier whose name matches free text typed before the dropdown existed. */
function carrierByName(name) {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!n) return null;
  return Object.values(CARRIERS).find((c) => !c.custom && c.name.toLowerCase() === n) || null;
}

/**
 * Tracking event status codes
 */
const TRACKING_STATUS = {
  LABEL_CREATED: 'label_created',
  PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  FAILED_DELIVERY: 'failed_delivery',
  RETURNED: 'returned',
  EXCEPTION: 'exception'
};

/**
 * Tracking event descriptions
 */
const STATUS_DESCRIPTIONS = {
  label_created: 'Shipping label created',
  picked_up: 'Package picked up by carrier',
  in_transit: 'Package in transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Package delivered',
  failed_delivery: 'Delivery attempt failed',
  returned: 'Package returned to sender',
  exception: 'Exception occurred'
};

class OrderTrackingService {
  /**
   * Generate tracking number based on carrier
   * @param {string} carrierCode - Carrier code
   * @param {string} orderId - Order ID
   * @returns {string} - Generated tracking number
   */
  generateTrackingNumber(carrierCode = 'DELHIVERY', _orderId = null) {
    const carrier = CARRIERS[carrierCode];
    if (!carrier) {
      throw new Error(`Invalid carrier code: ${carrierCode}`);
    }

    // Generate tracking number based on carrier format
    switch (carrierCode) {
      case 'FEDEX':
      case 'DHL':
      case 'DELHIVERY':
      case 'BLUE_DART':
      case 'ECOM_EXPRESS':
        // Generate 12-14 digit number
        return this._generateNumericTracking(12);
      
      case 'UPS':
        // Generate UPS format: 1Z + 16 alphanumeric
        return '1Z' + this._generateAlphanumeric(16);
      
      case 'INDIA_POST':
        // Generate India Post format: 2 letters + 9 digits + 2 letters
        return this._generateIndiaPostTracking();
      
      case 'DTDC':
        // Generate 10-15 alphanumeric
        return this._generateAlphanumeric(12);
      
      case 'USPS':
        // Generate 20-22 digit number
        return this._generateNumericTracking(20);
      
      default:
        return this._generateNumericTracking(12);
    }
  }

  /**
   * Generate numeric tracking number
   * @private
   */
  _generateNumericTracking(length) {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(6).toString('hex');
    const combined = (timestamp + random).replace(/[^0-9]/g, '');
    return combined.substring(0, length).padStart(length, '0');
  }

  /**
   * Generate alphanumeric tracking number
   * @private
   */
  _generateAlphanumeric(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }

  /**
   * Generate India Post format tracking number
   * @private
   */
  _generateIndiaPostTracking() {
    const letters1 = this._generateAlphanumeric(2);
    const digits = this._generateNumericTracking(9);
    const letters2 = this._generateAlphanumeric(2);
    return `${letters1}${digits}${letters2}`;
  }

  /**
   * Validate tracking number format
   * @param {string} trackingNumber - Tracking number to validate
   * @param {string} carrierCode - Carrier code
   * @returns {boolean} - Is valid
   */
  validateTrackingNumber(trackingNumber, carrierCode) {
    const carrier = CARRIERS[carrierCode];
    if (!carrier) {
      return false;
    }
    return carrier.trackingNumberFormat.test(trackingNumber);
  }

  /**
   * Add tracking information to order
   * @param {string} orderId - Order ID
   * @param {Object} trackingData - Tracking data
   * @returns {Promise<Object>} - Updated order
   */
  async addTrackingInfo(orderId, trackingData) {
    const { trackingNumber, carrierCode, carrierName, notes } = trackingData;

    try {
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      // Validate carrier (and the admin-typed name for the `OTHER` carrier)
      const { carrier, error } = this.resolveCarrier(carrierCode, carrierName);
      if (!carrier) {
        throw new Error(error);
      }

      // Validate tracking number format if provided
      if (trackingNumber && !this.validateTrackingNumber(trackingNumber, carrierCode)) {
        throw new Error(`Invalid tracking number format for carrier ${carrier.name}`);
      }

      // What the customer saw before, to tell them about a real correction below.
      const before = {
        trackingNumber: order.trackingNumber,
        carrier: { name: order.carrier?.name, trackingUrl: order.carrier?.trackingUrl },
      };

      // Update order with tracking info
      order.trackingNumber = trackingNumber;
      order.carrier = this.buildCarrierSubdoc(carrier, trackingNumber);

      // Calculate estimated delivery. An unknown courier has no SLA to promise,
      // so leave the ETA unset rather than inventing one.
      const estimatedDays = carrier.estimatedDeliveryDays;
      if (estimatedDays) {
        const estimatedDate = new Date();
        estimatedDate.setDate(estimatedDate.getDate() + estimatedDays);
        order.estimatedDelivery = estimatedDate;
      }

      // Add initial tracking event
      if (!order.trackingEvents) {
        order.trackingEvents = [];
      }

      order.trackingEvents.push({
        timestamp: new Date(),
        status: TRACKING_STATUS.LABEL_CREATED,
        description: notes || STATUS_DESCRIPTIONS.label_created,
        location: 'Origin facility'
      });

      await order.save();

      /*
        A legacy order shipped WITHOUT parcels shows the customer these order-level
        fields, so correcting them after dispatch deserves a "delivery update" email.
        With parcels, the customer sees each parcel's own details instead — those are
        corrected (and emailed) through the parcel edit, not here.
      */
      if (order.status === 'shipped' && !(order.shipments || []).length && customerVisibleChange(before, order)) {
        enqueueDeliveryUpdateEmail(String(order._id), null);
      }

      return {
        success: true,
        order,
        trackingUrl: order.carrier.trackingUrl,
        estimatedDelivery: order.estimatedDelivery
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Add tracking event to order
   * @param {string} orderId - Order ID
   * @param {Object} eventData - Event data
   * @returns {Promise<Object>} - Updated order
   */
  async addTrackingEvent(orderId, eventData) {
    const {
      status,
      location,
      description,
      scannedBy,
      timestamp
    } = eventData;

    try {
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      if (!order.trackingNumber) {
        throw new Error('Order does not have tracking information');
      }

      // Validate status
      if (!Object.values(TRACKING_STATUS).includes(status)) {
        throw new Error(`Invalid tracking status: ${status}`);
      }

      // Initialize trackingEvents if not exists
      if (!order.trackingEvents) {
        order.trackingEvents = [];
      }

      // Add tracking event
      const event = {
        timestamp: timestamp || new Date(),
        status,
        location: location || 'Unknown location',
        description: description || STATUS_DESCRIPTIONS[status] || 'Status update',
        scannedBy: scannedBy || 'System'
      };

      order.trackingEvents.push(event);

      // Update order status based on tracking status
      if (status === TRACKING_STATUS.DELIVERED && order.status === 'shipped') {
        // Automatically update order status to delivered
        order.status = 'delivered';
        order.deliveredAt = event.timestamp;
        
        // Update fulfillment metrics
        if (order.fulfillmentMetrics) {
          order.fulfillmentMetrics.deliveredAt = event.timestamp;
          
          // Calculate time to deliver
          if (order.fulfillmentMetrics.shippedAt) {
            const shippedTime = new Date(order.fulfillmentMetrics.shippedAt);
            const deliveredTime = new Date(event.timestamp);
            const timeToDeliverMs = deliveredTime - shippedTime;
            order.fulfillmentMetrics.timeToDeliver = Math.round(timeToDeliverMs / (1000 * 60 * 60)); // hours
          }
        }

        // Add to status history
        if (!order.statusHistory) {
          order.statusHistory = [];
        }
        order.statusHistory.push({
          status: 'delivered',
          timestamp: event.timestamp,
          reason: 'customer_received',
          notes: 'Automatically updated from tracking event'
        });
      }

      await order.save();

      return {
        success: true,
        order,
        event
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get tracking history for an order
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} - Tracking history
   */
  async getTrackingHistory(orderId) {
    try {
      const order = await Order.findById(orderId)
        .select('trackingNumber carrier trackingEvents status estimatedDelivery deliveredAt');

      if (!order) {
        throw new Error('Order not found');
      }

      if (!order.trackingNumber) {
        throw new Error('Order does not have tracking information');
      }

      // Sort events by timestamp (newest first)
      const events = (order.trackingEvents || []).sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );

      return {
        success: true,
        trackingNumber: order.trackingNumber,
        carrier: order.carrier,
        currentStatus: order.status,
        estimatedDelivery: order.estimatedDelivery,
        deliveredAt: order.deliveredAt,
        events
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Track order by tracking number (public lookup)
   * @param {string} trackingNumber - Tracking number
   * @returns {Promise<Object>} - Tracking information
   */
  async trackByNumber(trackingNumber) {
    try {
      const order = await Order.findOne({ trackingNumber })
        .select('trackingNumber carrier trackingEvents status estimatedDelivery deliveredAt shippingAddress')
        .lean();

      if (!order) {
        throw new Error('Tracking number not found');
      }

      // Sort events by timestamp (newest first)
      const events = (order.trackingEvents || []).sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );

      // Return limited information for privacy
      return {
        success: true,
        trackingNumber: order.trackingNumber,
        carrier: order.carrier,
        currentStatus: order.status,
        estimatedDelivery: order.estimatedDelivery,
        deliveredAt: order.deliveredAt,
        destination: {
          city: order.shippingAddress?.city,
          state: order.shippingAddress?.state,
          postalCode: order.shippingAddress?.postalCode
        },
        events
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get all supported carriers
   * @returns {Array} - List of carriers
   */
  getSupportedCarriers() {
    return Object.values(CARRIERS).map(carrier => ({
      name: carrier.name,
      code: carrier.code,
      estimatedDeliveryDays: carrier.estimatedDeliveryDays,
      // Tells the admin UI to show a "courier name" input for this option.
      ...(carrier.custom ? { custom: true } : {}),
      // In the team panel's "Delivery partner" dropdown.
      ...(carrier.deliveryPartner ? { deliveryPartner: true } : {})
    }));
  }

  /**
   * Get carrier by code
   * @param {string} carrierCode - Carrier code
   * @returns {Object} - Carrier information
   */
  getCarrier(carrierCode) {
    return CARRIERS[carrierCode] || null;
  }

  /**
   * Resolve the carrier a write path should persist, folding in the admin-typed
   * name for the free-text `OTHER` carrier. Single source of truth for every
   * path that stamps `order.carrier`.
   *
   * @param {string} carrierCode - Carrier code
   * @param {string} [carrierName] - Courier name, required when code is OTHER
   * @param {string} [carrierUrl] - OTHER only: the courier's tracking page (http/https)
   * @returns {{carrier: Object|null, error: string|null}}
   */
  resolveCarrier(carrierCode, carrierName, carrierUrl) {
    const carrier = this.getCarrier(carrierCode);
    if (!carrier) {
      return { carrier: null, error: `Unknown carrier code: ${carrierCode}` };
    }

    if (!carrier.custom) {
      return { carrier, error: null };
    }

    const name = typeof carrierName === 'string' ? carrierName.trim() : '';
    if (!name) {
      return { carrier: null, error: 'Courier name is required when the carrier is "Other"' };
    }
    if (name.length > MAX_CUSTOM_CARRIER_NAME) {
      return {
        carrier: null,
        error: `Courier name must be ${MAX_CUSTOM_CARRIER_NAME} characters or fewer`
      };
    }

    // Optional tracking page. Stored as typed (no `{id}` filling): it is staff
    // input, and anything but an absolute http(s) link is refused outright.
    const rawUrl = typeof carrierUrl === 'string' ? carrierUrl.trim() : '';
    let customUrl = null;
    if (rawUrl) {
      customUrl = safeHttpUrl(rawUrl);
      if (!customUrl) {
        return { carrier: null, error: 'Tracking page must be a web link starting with http:// or https://' };
      }
    }

    // Same shape as a built-in carrier, with the staff's name (and page) in place of ours.
    return { carrier: { ...carrier, name, customUrl }, error: null };
  }

  /**
   * Build the `order.carrier` subdocument for a resolved carrier. Custom
   * couriers have no URL pattern, so `trackingUrl` is left unset rather than
   * emitted as a bare tracking number that would render as a broken link.
   *
   * @param {Object} carrier - Carrier from resolveCarrier()
   * @param {string} trackingNumber - Tracking number
   * @returns {{name: string, code: string, trackingUrl?: string}}
   */
  buildCarrierSubdoc(carrier, trackingNumber) {
    const link = carrier.custom ? carrier.customUrl || null : carrierTrackingLink(carrier, trackingNumber);
    return {
      name: carrier.name,
      code: carrier.code,
      ...(link ? { trackingUrl: link } : {})
    };
  }

  /**
   * The link the staff panel's link icon opens for a stored parcel/order carrier.
   * Stored link first (only if it is a safe http(s) URL); else the built-in courier
   * by code; else — parcels recorded before the dropdown, where the courier was
   * typed — a built-in courier whose name matches. Null when there is none.
   *
   * @param {{name?: string, code?: string, trackingUrl?: string}} [carrier]
   * @param {string} [trackingNumber]
   * @returns {string|null}
   */
  trackingLinkFor(carrier, trackingNumber) {
    const stored = safeHttpUrl(carrier?.trackingUrl);
    if (stored) return stored;
    const known = (carrier?.code && CARRIERS[carrier.code] && !CARRIERS[carrier.code].custom)
      ? CARRIERS[carrier.code]
      : carrierByName(carrier?.name);
    return known ? carrierTrackingLink(known, trackingNumber) : null;
  }

  /**
   * Simulate carrier tracking update (for testing)
   * @param {string} orderId - Order ID
   * @param {string} scenario - Simulation scenario
   * @returns {Promise<Object>} - Simulation result
   */
  async simulateTracking(orderId, scenario = 'normal_delivery') {
    try {
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      if (!order.trackingNumber) {
        throw new Error('Order does not have tracking information');
      }

      // Simulate tracking events based on scenario
      const events = [];
      const baseTime = new Date();

      switch (scenario) {
        case 'normal_delivery':
          events.push(
            { status: TRACKING_STATUS.PICKED_UP, hours: 2, location: 'Origin facility' },
            { status: TRACKING_STATUS.IN_TRANSIT, hours: 24, location: 'Hub 1' },
            { status: TRACKING_STATUS.IN_TRANSIT, hours: 48, location: 'Hub 2' },
            { status: TRACKING_STATUS.OUT_FOR_DELIVERY, hours: 70, location: 'Destination facility' },
            { status: TRACKING_STATUS.DELIVERED, hours: 72, location: 'Customer address' }
          );
          break;

        case 'delayed':
          events.push(
            { status: TRACKING_STATUS.PICKED_UP, hours: 2, location: 'Origin facility' },
            { status: TRACKING_STATUS.IN_TRANSIT, hours: 24, location: 'Hub 1' },
            { status: TRACKING_STATUS.EXCEPTION, hours: 48, location: 'Hub 2', description: 'Weather delay' },
            { status: TRACKING_STATUS.IN_TRANSIT, hours: 96, location: 'Hub 3' },
            { status: TRACKING_STATUS.OUT_FOR_DELIVERY, hours: 120, location: 'Destination facility' },
            { status: TRACKING_STATUS.DELIVERED, hours: 122, location: 'Customer address' }
          );
          break;

        case 'failed_delivery':
          events.push(
            { status: TRACKING_STATUS.PICKED_UP, hours: 2, location: 'Origin facility' },
            { status: TRACKING_STATUS.IN_TRANSIT, hours: 24, location: 'Hub 1' },
            { status: TRACKING_STATUS.OUT_FOR_DELIVERY, hours: 70, location: 'Destination facility' },
            { status: TRACKING_STATUS.FAILED_DELIVERY, hours: 72, location: 'Customer address', description: 'Recipient not available' },
            { status: TRACKING_STATUS.OUT_FOR_DELIVERY, hours: 94, location: 'Destination facility' },
            { status: TRACKING_STATUS.DELIVERED, hours: 96, location: 'Customer address' }
          );
          break;
      }

      // Add events to order
      for (const event of events) {
        const eventTime = new Date(baseTime);
        eventTime.setHours(eventTime.getHours() + event.hours);

        await this.addTrackingEvent(orderId, {
          status: event.status,
          location: event.location,
          description: event.description || STATUS_DESCRIPTIONS[event.status],
          timestamp: eventTime
        });
      }

      return {
        success: true,
        message: `Simulated ${scenario} tracking events`,
        eventsAdded: events.length
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get tracking statistics
   * @param {Object} filter - Filter options
   * @returns {Promise<Object>} - Tracking statistics
   */
  async getTrackingStatistics(filter = {}) {
    try {
      const stats = await Order.aggregate([
        {
          $match: {
            trackingNumber: { $exists: true, $ne: null },
            ...filter
          }
        },
        {
          $group: {
            _id: '$carrier.code',
            carrierName: { $first: '$carrier.name' },
            totalOrders: { $sum: 1 },
            delivered: {
              $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
            },
            inTransit: {
              $sum: { $cond: [{ $eq: ['$status', 'shipped'] }, 1, 0] }
            },
            avgDeliveryTime: { $avg: '$fulfillmentMetrics.timeToDeliver' }
          }
        },
        {
          $project: {
            carrierCode: '$_id',
            carrierName: 1,
            totalOrders: 1,
            delivered: 1,
            inTransit: 1,
            avgDeliveryTime: { $round: ['$avgDeliveryTime', 2] },
            deliveryRate: {
              $multiply: [
                { $divide: ['$delivered', '$totalOrders'] },
                100
              ]
            },
            _id: 0
          }
        }
      ]);

      return {
        success: true,
        statistics: stats
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }
}

// Export singleton instance
const orderTrackingService = new OrderTrackingService();
export default orderTrackingService;

// Export class and constants for testing
export {
  OrderTrackingService,
  CARRIERS,
  carrierByName,
  OTHER_CARRIER_CODE,
  MAX_CUSTOM_CARRIER_NAME,
  MAX_CUSTOM_CARRIER_URL,
  DELIVERY_PARTNER_CODES,
  safeHttpUrl,
  TRACKING_STATUS,
  STATUS_DESCRIPTIONS
};
