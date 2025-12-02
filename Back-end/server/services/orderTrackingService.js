/**
 * Order Tracking Service
 * Handles tracking number generation, tracking events, and carrier integration
 */

import Order from '../models/Order.js';
import crypto from 'crypto';

/**
 * Supported carriers with their configurations
 */
const CARRIERS = {
  FEDEX: {
    name: 'FedEx',
    code: 'FEDEX',
    trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr=',
    trackingNumberFormat: /^[0-9]{12,14}$/,
    estimatedDeliveryDays: 3
  },
  UPS: {
    name: 'UPS',
    code: 'UPS',
    trackingUrl: 'https://www.ups.com/track?tracknum=',
    trackingNumberFormat: /^1Z[A-Z0-9]{16}$/,
    estimatedDeliveryDays: 3
  },
  DHL: {
    name: 'DHL',
    code: 'DHL',
    trackingUrl: 'https://www.dhl.com/en/express/tracking.html?AWB=',
    trackingNumberFormat: /^[0-9]{10,11}$/,
    estimatedDeliveryDays: 4
  },
  USPS: {
    name: 'USPS',
    code: 'USPS',
    trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=',
    trackingNumberFormat: /^[0-9]{20,22}$/,
    estimatedDeliveryDays: 5
  },
  INDIA_POST: {
    name: 'India Post',
    code: 'INDIA_POST',
    trackingUrl: 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?tracknumber=',
    trackingNumberFormat: /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/,
    estimatedDeliveryDays: 7
  },
  DELHIVERY: {
    name: 'Delhivery',
    code: 'DELHIVERY',
    trackingUrl: 'https://www.delhivery.com/track/package/',
    trackingNumberFormat: /^[0-9]{12,15}$/,
    estimatedDeliveryDays: 2
  },
  BLUE_DART: {
    name: 'Blue Dart',
    code: 'BLUE_DART',
    trackingUrl: 'https://www.bluedart.com/tracking?trackFor=',
    trackingNumberFormat: /^[0-9]{10,12}$/,
    estimatedDeliveryDays: 2
  },
  DTDC: {
    name: 'DTDC',
    code: 'DTDC',
    trackingUrl: 'https://www.dtdc.in/tracking.asp?tracking_no=',
    trackingNumberFormat: /^[A-Z0-9]{10,15}$/,
    estimatedDeliveryDays: 3
  },
  ECOM_EXPRESS: {
    name: 'Ecom Express',
    code: 'ECOM_EXPRESS',
    trackingUrl: 'https://ecomexpress.in/tracking/?awb_field=',
    trackingNumberFormat: /^[0-9]{12,14}$/,
    estimatedDeliveryDays: 3
  }
};

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
  generateTrackingNumber(carrierCode = 'DELHIVERY', orderId = null) {
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
    const { trackingNumber, carrierCode, notes } = trackingData;

    try {
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      // Validate carrier
      const carrier = CARRIERS[carrierCode];
      if (!carrier) {
        throw new Error(`Invalid carrier code: ${carrierCode}`);
      }

      // Validate tracking number format if provided
      if (trackingNumber && !this.validateTrackingNumber(trackingNumber, carrierCode)) {
        throw new Error(`Invalid tracking number format for carrier ${carrier.name}`);
      }

      // Update order with tracking info
      order.trackingNumber = trackingNumber;
      order.carrier = {
        name: carrier.name,
        code: carrierCode,
        trackingUrl: carrier.trackingUrl + trackingNumber
      };

      // Calculate estimated delivery
      const estimatedDays = carrier.estimatedDeliveryDays;
      const estimatedDate = new Date();
      estimatedDate.setDate(estimatedDate.getDate() + estimatedDays);
      order.estimatedDelivery = estimatedDate;

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
      estimatedDeliveryDays: carrier.estimatedDeliveryDays
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
  TRACKING_STATUS,
  STATUS_DESCRIPTIONS
};
