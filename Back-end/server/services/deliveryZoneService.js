import deliveryZoneRepository from "../repositories/deliveryZoneRepository.js";

/**
 * Delivery Zone Service for managing delivery zones and estimates
 */
class DeliveryZoneService {
  /**
   * Create a new delivery zone
   * @param {Object} zoneData - Zone details
   * @returns {Promise<Object>} Created zone
   */
  async createZone(zoneData) {
    try {
      const zone = deliveryZoneRepository.build(zoneData);
      await zone.save();
      return zone;
    } catch (error) {
      console.error("Create zone error:", error);
      throw error;
    }
  }

  /**
   * Get all delivery zones
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} List of zones
   */
  async getAllZones(filters = {}) {
    try {
      const query = {};

      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.serviceable !== undefined) {
        query.isServiceable = filters.serviceable;
      }

      const zones = await deliveryZoneRepository.find(query).sort({ priority: -1, name: 1 });
      return zones;
    } catch (error) {
      console.error("Get zones error:", error);
      throw error;
    }
  }

  /**
   * Get zone by ID
   * @param {string} zoneId 
   * @returns {Promise<Object>} Zone details
   */
  async getZoneById(zoneId) {
    try {
      const zone = await deliveryZoneRepository.findById(zoneId);
      
      if (!zone) {
        throw new Error("Delivery zone not found");
      }

      return zone;
    } catch (error) {
      console.error("Get zone by ID error:", error);
      throw error;
    }
  }

  /**
   * Get zone by PIN code
   * @param {string} pinCode 
   * @returns {Promise<Object|null>} Zone details or null
   */
  async getZoneByPinCode(pinCode) {
    try {
      return await deliveryZoneRepository.findByPinCode(pinCode);
    } catch (error) {
      console.error("Get zone by PIN code error:", error);
      throw error;
    }
  }

  /**
   * Update delivery zone
   * @param {string} zoneId 
   * @param {Object} updateData 
   * @returns {Promise<Object>} Updated zone
   */
  async updateZone(zoneId, updateData) {
    try {
      const zone = await deliveryZoneRepository.findByIdAndUpdate(
        zoneId,
        updateData,
        { new: true, runValidators: true }
      );

      if (!zone) {
        throw new Error("Delivery zone not found");
      }

      return zone;
    } catch (error) {
      console.error("Update zone error:", error);
      throw error;
    }
  }

  /**
   * Delete delivery zone
   * @param {string} zoneId 
   * @returns {Promise<boolean>} Success status
   */
  async deleteZone(zoneId) {
    try {
      const zone = await deliveryZoneRepository.findByIdAndDelete(zoneId);

      if (!zone) {
        throw new Error("Delivery zone not found");
      }

      return true;
    } catch (error) {
      console.error("Delete zone error:", error);
      throw error;
    }
  }

  /**
   * Add PIN codes to zone
   * @param {string} zoneId 
   * @param {Array<string>} pinCodes 
   * @returns {Promise<Object>} Updated zone
   */
  async addPinCodes(zoneId, pinCodes) {
    try {
      return await deliveryZoneRepository.bulkAddPinCodes(zoneId, pinCodes);
    } catch (error) {
      console.error("Add PIN codes error:", error);
      throw error;
    }
  }

  /**
   * Remove PIN codes from zone
   * @param {string} zoneId 
   * @param {Array<string>} pinCodes 
   * @returns {Promise<Object>} Updated zone
   */
  async removePinCodes(zoneId, pinCodes) {
    try {
      const zone = await deliveryZoneRepository.findByIdAndUpdate(
        zoneId,
        { $pullAll: { pinCodes: pinCodes } },
        { new: true }
      );

      if (!zone) {
        throw new Error("Delivery zone not found");
      }

      return zone;
    } catch (error) {
      console.error("Remove PIN codes error:", error);
      throw error;
    }
  }

  /**
   * Check if PIN code is serviceable
   * @param {string} pinCode 
   * @returns {Promise<Object>} Serviceability status
   */
  async checkServiceability(pinCode) {
    try {
      const zone = await deliveryZoneRepository.findByPinCode(pinCode);

      return {
        serviceable: zone !== null,
        zone: zone,
        message: zone 
          ? `Delivery available in ${zone.deliveryTime.minDays}-${zone.deliveryTime.maxDays} business days`
          : `Delivery not available for PIN code ${pinCode}`
      };
    } catch (error) {
      console.error("Check serviceability error:", error);
      throw error;
    }
  }

  /**
   * Get delivery estimate for PIN code
   * @param {string} pinCode 
   * @param {Date} orderDate 
   * @returns {Promise<Object>} Delivery estimate
   */
  async getDeliveryEstimate(pinCode, orderDate = new Date()) {
    try {
      const zone = await deliveryZoneRepository.findByPinCode(pinCode);

      if (!zone) {
        throw new Error(`No delivery zone found for PIN code: ${pinCode}`);
      }

      const estimate = zone.estimateDeliveryDate(orderDate);

      return {
        zone: {
          name: zone.name,
          type: zone.type
        },
        estimate,
        deliveryDays: `${zone.deliveryTime.minDays}-${zone.deliveryTime.maxDays} days`
      };
    } catch (error) {
      console.error("Get delivery estimate error:", error);
      throw error;
    }
  }

  /**
   * Calculate shipping cost for PIN code and weight
   * @param {string} pinCode 
   * @param {number} weightKg 
   * @returns {Promise<Object>} Shipping cost
   */
  async calculateShippingCost(pinCode, weightKg = 0) {
    try {
      const zone = await deliveryZoneRepository.findByPinCode(pinCode);

      if (!zone) {
        throw new Error(`No delivery zone found for PIN code: ${pinCode}`);
      }

      const cost = zone.calculateShippingCost(weightKg);

      return {
        zone: zone.name,
        weightKg,
        shippingCost: cost,
        breakdown: {
          baseRate: zone.shippingCost.baseRate,
          perKgRate: zone.shippingCost.perKgRate,
          weightCharge: weightKg * zone.shippingCost.perKgRate
        }
      };
    } catch (error) {
      console.error("Calculate shipping cost error:", error);
      throw error;
    }
  }

  /**
   * Get zones summary statistics
   * @returns {Promise<Array>} Zones summary
   */
  async getZonesSummary() {
    try {
      return await deliveryZoneRepository.getZonesSummary();
    } catch (error) {
      console.error("Get zones summary error:", error);
      throw error;
    }
  }

  /**
   * Bulk import PIN codes from data
   * @param {Array} pinCodeData - Array of { pinCode, zoneType, city, state }
   * @returns {Promise<Object>} Import result
   */
  async bulkImportPinCodes(pinCodeData) {
    try {
      const grouped = {};

      // Group PIN codes by zone type
      for (const item of pinCodeData) {
        if (!grouped[item.zoneType]) {
          grouped[item.zoneType] = {
            pinCodes: [],
            cities: new Set(),
            states: new Set()
          };
        }

        grouped[item.zoneType].pinCodes.push(item.pinCode);
        if (item.city) grouped[item.zoneType].cities.add(item.city);
        if (item.state) grouped[item.zoneType].states.add(item.state);
      }

      const results = [];

      // Update or create zones
      for (const [zoneType, data] of Object.entries(grouped)) {
        let zone = await deliveryZoneRepository.findOne({ type: zoneType });

        if (zone) {
          // Add to existing zone
          zone = await deliveryZoneRepository.bulkAddPinCodes(zone._id, data.pinCodes);
          
          // Add cities and states
          const citiesToAdd = Array.from(data.cities).filter(c => !zone.cities.includes(c));
          const statesToAdd = Array.from(data.states).filter(s => !zone.states.includes(s));

          if (citiesToAdd.length > 0 || statesToAdd.length > 0) {
            zone = await deliveryZoneRepository.findByIdAndUpdate(
              zone._id,
              {
                $addToSet: {
                  cities: { $each: citiesToAdd },
                  states: { $each: statesToAdd }
                }
              },
              { new: true }
            );
          }
        }

        results.push({
          zoneType,
          pinCodesAdded: data.pinCodes.length,
          zone: zone ? zone._id : null
        });
      }

      return {
        success: true,
        results,
        totalPinCodes: pinCodeData.length
      };
    } catch (error) {
      console.error("Bulk import PIN codes error:", error);
      throw error;
    }
  }
}

export default new DeliveryZoneService();
