/**
 * Order Status Service
 * Handles order status transitions with validation and tracking
 */

import Order from '../models/Order.js';

/**
 * Define valid status transition rules
 * Each status maps to an array of allowed next statuses
 */
const STATUS_TRANSITIONS = {
  'pending': ['confirmed', 'cancelled', 'failed'],
  'confirmed': ['processing', 'cancelled'],
  'processing': ['shipped', 'cancelled'],
  'shipped': ['delivered'],
  'delivered': ['refunded'],
  'cancelled': [], // Terminal state
  'refunded': [],   // Terminal state
  'failed': []      // Terminal state
};

/**
 * Define which transitions require admin approval
 */
const ADMIN_ONLY_TRANSITIONS = {
  'processing': ['cancelled'], // Only admin can cancel after processing starts
  'shipped': [], // Shipped orders cannot be cancelled
  'delivered': ['refunded'] // Only admin can initiate refund
};

/**
 * Define status transition reasons/categories
 */
const TRANSITION_REASONS = {
  'confirmed': ['payment_verified', 'inventory_available', 'manual_confirmation'],
  'processing': ['warehouse_assigned', 'items_picked', 'packing_started'],
  'shipped': ['handed_to_carrier', 'label_created', 'in_transit'],
  'delivered': ['customer_received', 'left_at_door', 'signed_for'],
  'cancelled': ['customer_request', 'out_of_stock', 'payment_failed', 'fraud_suspected', 'duplicate_order'],
  'refunded': ['return_completed', 'damaged_item', 'quality_issue', 'order_cancelled'],
  'failed': ['payment_failed', 'gateway_error', 'timeout']
};

class OrderStatusService {
  /**
   * Validate if a status transition is allowed
   * @param {string} currentStatus - Current order status
   * @param {string} newStatus - Desired new status
   * @param {boolean} isAdmin - Whether the user is an admin
   * @returns {Object} - { valid: boolean, message: string }
   */
  validateTransition(currentStatus, newStatus, isAdmin = false) {
    // Check if current status exists
    if (!STATUS_TRANSITIONS[currentStatus]) {
      return {
        valid: false,
        message: `Invalid current status: ${currentStatus}`
      };
    }

    // Check if new status is in allowed transitions
    const allowedStatuses = STATUS_TRANSITIONS[currentStatus];
    if (!allowedStatuses.includes(newStatus)) {
      return {
        valid: false,
        message: `Cannot transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedStatuses.join(', ') || 'none'}`
      };
    }

    // Check if admin permission required
    if (ADMIN_ONLY_TRANSITIONS[currentStatus] && 
        ADMIN_ONLY_TRANSITIONS[currentStatus].includes(newStatus) && 
        !isAdmin) {
      return {
        valid: false,
        message: `Admin permission required to transition from '${currentStatus}' to '${newStatus}'`
      };
    }

    return {
      valid: true,
      message: 'Transition is valid'
    };
  }

  /**
   * Get valid next statuses for current status
   * @param {string} currentStatus - Current order status
   * @param {boolean} isAdmin - Whether the user is an admin
   * @returns {Array} - Array of valid next statuses
   */
  getValidNextStatuses(currentStatus, isAdmin = false) {
    const allNextStatuses = STATUS_TRANSITIONS[currentStatus] || [];
    
    if (!isAdmin) {
      // Filter out admin-only transitions
      return allNextStatuses.filter(nextStatus => {
        return !ADMIN_ONLY_TRANSITIONS[currentStatus] || 
               !ADMIN_ONLY_TRANSITIONS[currentStatus].includes(nextStatus);
      });
    }
    
    return allNextStatuses;
  }

  /**
   * Get valid reasons for a status transition
   * @param {string} status - Target status
   * @returns {Array} - Array of valid reasons
   */
  getValidReasons(status) {
    return TRANSITION_REASONS[status] || [];
  }

  /**
   * Update order status with validation and history tracking
   * @param {string} orderId - Order ID
   * @param {string} newStatus - New status to set
   * @param {Object} options - Additional options
   * @param {string} options.userId - ID of user making the change
   * @param {boolean} options.isAdmin - Whether user is admin
   * @param {string} options.reason - Reason for status change
   * @param {string} options.notes - Additional notes
   * @param {Object} options.metadata - Additional metadata
   * @returns {Promise<Object>} - Updated order or error
   */
  async updateOrderStatus(orderId, newStatus, options = {}) {
    const {
      userId,
      isAdmin = false,
      reason,
      notes,
      metadata = {}
    } = options;

    try {
      // Find the order
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      const currentStatus = order.status;

      // Validate transition
      const validation = this.validateTransition(currentStatus, newStatus, isAdmin);
      if (!validation.valid) {
        throw new Error(validation.message);
      }

      // Validate reason if provided
      if (reason) {
        const validReasons = this.getValidReasons(newStatus);
        
        // Allow 'admin_update' reason for admins, even if not in the strict validation list
        // This supports manual overrides from the admin panel
        const isAllowedAdminUpdate = isAdmin && reason === 'admin_update';
        
        if (!isAllowedAdminUpdate && validReasons.length > 0 && !validReasons.includes(reason)) {
          throw new Error(`Invalid reason '${reason}' for status '${newStatus}'. Valid reasons: ${validReasons.join(', ')}`);
        }
      }

      // Update status
      order.status = newStatus;

      // Add to status history (will be handled by pre-save middleware, but we add details here)
      const historyEntry = {
        status: newStatus,
        timestamp: new Date(),
        updatedBy: userId,
        reason,
        notes,
        metadata
      };

      // Manually add to history with full details
      if (!order.statusHistory) {
        order.statusHistory = [];
      }
      order.statusHistory.push(historyEntry);

      // Update fulfillment metrics based on status
      await this.updateFulfillmentMetrics(order, newStatus);

      // Update specific fields based on status
      switch (newStatus) {
        case 'cancelled':
          order.cancelledAt = new Date();
          if (reason) {
            order.cancellationReason = reason;
          }
          break;
        case 'delivered':
          order.deliveredAt = new Date();
          if (order.fulfillmentMetrics) {
            order.fulfillmentMetrics.deliveredAt = new Date();
          }
          break;
      }

      // Save order
      await order.save();

      return {
        success: true,
        order,
        message: `Order status updated to '${newStatus}'`
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Update fulfillment metrics based on status change
   * @param {Object} order - Order document
   * @param {string} newStatus - New status
   * @private
   */
  async updateFulfillmentMetrics(order, newStatus) {
    if (!order.fulfillmentMetrics) {
      order.fulfillmentMetrics = {};
    }

    const now = new Date();

    switch (newStatus) {
      case 'confirmed':
        order.fulfillmentMetrics.confirmedAt = now;
        break;
      
      case 'processing':
        order.fulfillmentMetrics.processingStartedAt = now;
        break;
      
      case 'shipped':
        order.fulfillmentMetrics.shippedAt = now;
        
        // Calculate time to ship (from confirmation to shipping)
        if (order.fulfillmentMetrics.confirmedAt) {
          const confirmedTime = new Date(order.fulfillmentMetrics.confirmedAt);
          const timeToShipMs = now - confirmedTime;
          order.fulfillmentMetrics.timeToShip = Math.round(timeToShipMs / (1000 * 60 * 60)); // hours
        }
        break;
      
      case 'delivered':
        order.fulfillmentMetrics.deliveredAt = now;
        
        // Calculate time to deliver (from shipping to delivery)
        if (order.fulfillmentMetrics.shippedAt) {
          const shippedTime = new Date(order.fulfillmentMetrics.shippedAt);
          const timeToDeliverMs = now - shippedTime;
          order.fulfillmentMetrics.timeToDeliver = Math.round(timeToDeliverMs / (1000 * 60 * 60)); // hours
        }
        break;
    }
  }

  /**
   * Add entry to status history
   * @param {string} orderId - Order ID
   * @param {Object} historyEntry - History entry data
   * @returns {Promise<Object>} - Updated order
   */
  async addStatusHistory(orderId, historyEntry) {
    try {
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      if (!order.statusHistory) {
        order.statusHistory = [];
      }

      order.statusHistory.push({
        ...historyEntry,
        timestamp: historyEntry.timestamp || new Date()
      });

      await order.save();

      return {
        success: true,
        order
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get status history for an order
   * @param {string} orderId - Order ID
   * @returns {Promise<Array>} - Status history
   */
  async getStatusHistory(orderId) {
    try {
      const order = await Order.findById(orderId)
        .populate('statusHistory.updatedBy', 'name email role')
        .select('statusHistory status');

      if (!order) {
        throw new Error('Order not found');
      }

      return {
        success: true,
        currentStatus: order.status,
        history: order.statusHistory || []
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Check if order can be cancelled by customer
   * @param {Object} order - Order document
   * @returns {Object} - { canCancel: boolean, reason: string }
   */
  canCustomerCancel(order) {
    const cancellableStatuses = ['pending', 'confirmed'];
    
    if (!cancellableStatuses.includes(order.status)) {
      return {
        canCancel: false,
        reason: `Orders with status '${order.status}' cannot be cancelled by customers. Please contact support.`
      };
    }

    return {
      canCancel: true,
      reason: 'Order can be cancelled'
    };
  }

  /**
   * Get order status statistics
   * @param {Object} filter - MongoDB filter object
   * @returns {Promise<Object>} - Status statistics
   */
  async getStatusStatistics(filter = {}) {
    try {
      const stats = await Order.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$totalAmount' }
          }
        },
        {
          $project: {
            status: '$_id',
            count: 1,
            totalValue: 1,
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

  /**
   * Get fulfillment performance metrics
   * @param {Object} filter - MongoDB filter object
   * @returns {Promise<Object>} - Performance metrics
   */
  async getFulfillmentMetrics(filter = {}) {
    try {
      const metrics = await Order.aggregate([
        { $match: { ...filter, status: { $in: ['delivered', 'shipped'] } } },
        {
          $group: {
            _id: null,
            avgTimeToShip: { $avg: '$fulfillmentMetrics.timeToShip' },
            avgTimeToDeliver: { $avg: '$fulfillmentMetrics.timeToDeliver' },
            minTimeToShip: { $min: '$fulfillmentMetrics.timeToShip' },
            maxTimeToShip: { $max: '$fulfillmentMetrics.timeToShip' },
            minTimeToDeliver: { $min: '$fulfillmentMetrics.timeToDeliver' },
            maxTimeToDeliver: { $max: '$fulfillmentMetrics.timeToDeliver' },
            totalOrders: { $sum: 1 }
          }
        }
      ]);

      return {
        success: true,
        metrics: metrics[0] || {
          avgTimeToShip: 0,
          avgTimeToDeliver: 0,
          totalOrders: 0
        }
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
const orderStatusService = new OrderStatusService();
export default orderStatusService;

// Export class for testing
export { OrderStatusService, STATUS_TRANSITIONS, ADMIN_ONLY_TRANSITIONS, TRANSITION_REASONS };
