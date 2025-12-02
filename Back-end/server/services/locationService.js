import UserLocation from "../models/UserLocation.js";
import DeliveryZone from "../models/DeliveryZone.js";
import Warehouse from "../models/Warehouse.js";
import googleMapsService from "./googleMapsService.js";

/**
 * Location Service for managing user locations and delivery zones
 */
class LocationService {
  /**
   * Select and save user location
   * @param {Object} identifier - { userId, sessionId }
   * @param {Object} locationData - Location details
   * @returns {Promise<Object>} Saved location with zone and warehouse info
   */
  async selectLocation(identifier, locationData) {
    try {
      // DEBUG: Log what we received
      console.log('\n=== Location Service Debug ===');
      console.log('Identifier:', identifier);
      console.log('Location Data:', JSON.stringify(locationData, null, 2));
      console.log('Has placeId?', !!locationData.placeId);
      console.log('Has coordinates?', !!locationData.coordinates);
      console.log('Has postalCode?', !!locationData.postalCode);
      console.log('Has address?', !!locationData.address);
      console.log('Address type:', typeof locationData.address);
      console.log('Address.postalCode?', locationData.address?.postalCode);
      console.log('=============================\n');

      let coordinates, formatted, placeId, addressComponents;

      // Handle different location input types
      if (locationData.placeId) {
        // Get details from Google Place ID
        const placeDetails = await googleMapsService.getPlaceDetails(locationData.placeId);
        coordinates = placeDetails.coordinates;
        formatted = placeDetails.formatted;
        placeId = placeDetails.placeId;
        addressComponents = placeDetails.addressComponents;
      } else if (locationData.coordinates) {
        // Reverse geocode coordinates
        const { latitude, longitude } = locationData.coordinates;
        const geocoded = await googleMapsService.reverseGeocode(latitude, longitude);
        coordinates = geocoded.coordinates;
        formatted = geocoded.formatted;
        placeId = geocoded.placeId;
        addressComponents = geocoded.addressComponents;
      } else if (locationData.postalCode || (locationData.address && typeof locationData.address === 'object' && locationData.address.postalCode)) {
        // Handle PIN code-only submission (no Google Maps needed)
        const pinCode = locationData.postalCode || locationData.address.postalCode;
        const deliveryZone = await DeliveryZone.findByPinCode(pinCode);
        
        if (!deliveryZone) {
          throw new Error(`Delivery not available for PIN code: ${pinCode}`);
        }

        // Use zone data to construct address
        const city = locationData.address?.city || deliveryZone.cities?.[0] || 'Unknown';
        const state = locationData.address?.state || deliveryZone.states?.[0] || 'India';
        
        addressComponents = {
          street: locationData.address?.street || '',
          city,
          state,
          postalCode: pinCode,
          country: locationData.address?.country || 'India'
        };

        formatted = `${city}, ${state} ${pinCode}, ${addressComponents.country}`;
        
        // Use zone's approximate center or default India coordinates
        // Since we don't have exact coordinates, use approximate
        coordinates = {
          latitude: 20.5937, // Center of India (approximate)
          longitude: 78.9629
        };
        
        placeId = null;
      } else if (locationData.address && typeof locationData.address === 'string') {
        // Geocode manual address string
        const geocoded = await googleMapsService.geocodeAddress(locationData.address);
        coordinates = geocoded.coordinates;
        formatted = geocoded.formatted;
        placeId = geocoded.placeId;
        addressComponents = geocoded.addressComponents;
      } else {
        throw new Error("Invalid location data provided");
      }

      // Find delivery zone by PIN code (if not already found)
      let deliveryZone;
      if (!locationData.postalCode && !(locationData.address && locationData.address.postalCode)) {
        deliveryZone = await DeliveryZone.findByPinCode(addressComponents.postalCode);
        
        if (!deliveryZone) {
          throw new Error(`Delivery not available for PIN code: ${addressComponents.postalCode}`);
        }
      } else {
        // Already found zone in the PIN code-only path
        deliveryZone = await DeliveryZone.findByPinCode(addressComponents.postalCode);
      }

      // Find nearest warehouse
      const nearestWarehouses = await Warehouse.findNearest(
        coordinates.longitude,
        coordinates.latitude
      );
      
      const nearestWarehouse = nearestWarehouses.length > 0 ? nearestWarehouses[0]._id : null;

      // Create location data
      const locationPayload = {
        selectedAddress: {
          formatted,
          street: addressComponents.street || locationData.street,
          city: addressComponents.city,
          state: addressComponents.state,
          postalCode: addressComponents.postalCode,
          country: addressComponents.country,
          coordinates: {
            type: "Point",
            coordinates: [coordinates.longitude, coordinates.latitude]
          }
        },
        deliveryZone: deliveryZone._id,
        nearestWarehouse,
        placeId
      };

      // Save location
      const savedLocation = await UserLocation.upsertLocation(identifier, locationPayload);

      return {
        location: savedLocation,
        deliveryZone: deliveryZone,
        nearestWarehouse: nearestWarehouses.length > 0 ? nearestWarehouses[0] : null,
        deliveryEstimate: deliveryZone.estimateDeliveryDate()
      };
    } catch (error) {
      console.error("Select location error:", error);
      throw error;
    }
  }

  /**
   * Get current user location
   * @param {Object} identifier - { userId, sessionId }
   * @returns {Promise<Object|null>} Current location or null
   */
  async getCurrentLocation(identifier) {
    try {
      let location;
      
      if (identifier.userId) {
        location = await UserLocation.findByUser(identifier.userId);
      } else if (identifier.sessionId) {
        location = await UserLocation.findBySession(identifier.sessionId);
      }

      if (!location) {
        return null;
      }

      // Touch location to update last used timestamp
      await location.touch();

      return {
        location,
        deliveryZone: location.deliveryZone,
        nearestWarehouse: location.nearestWarehouse,
        deliveryEstimate: location.deliveryZone 
          ? location.deliveryZone.estimateDeliveryDate() 
          : null
      };
    } catch (error) {
      console.error("Get current location error:", error);
      throw error;
    }
  }

  /**
   * Validate if address is serviceable
   * @param {string} postalCode - PIN code to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateAddress(postalCode) {
    try {
      const deliveryZone = await DeliveryZone.findByPinCode(postalCode);

      if (!deliveryZone) {
        return {
          serviceable: false,
          message: `Delivery not available for PIN code: ${postalCode}`
        };
      }

      return {
        serviceable: true,
        zone: deliveryZone,
        deliveryEstimate: deliveryZone.estimateDeliveryDate(),
        message: `Delivery available in ${deliveryZone.deliveryTime.minDays}-${deliveryZone.deliveryTime.maxDays} days`
      };
    } catch (error) {
      console.error("Validate address error:", error);
      throw error;
    }
  }

  /**
   * Get recent locations for a user
   * @param {string} userId 
   * @param {number} limit 
   * @returns {Promise<Array>} Recent locations
   */
  async getRecentLocations(userId, limit = 5) {
    try {
      return await UserLocation.getRecentLocations(userId, limit);
    } catch (error) {
      console.error("Get recent locations error:", error);
      throw error;
    }
  }

  /**
   * Clear user location
   * @param {Object} identifier - { userId, sessionId }
   * @returns {Promise<boolean>} Success status
   */
  async clearLocation(identifier) {
    try {
      const query = identifier.userId 
        ? { user: identifier.userId } 
        : { sessionId: identifier.sessionId };

      await UserLocation.updateMany(query, { isActive: false });
      return true;
    } catch (error) {
      console.error("Clear location error:", error);
      throw error;
    }
  }

  /**
   * Cleanup expired guest locations (for scheduled cleanup)
   * @param {number} expiryDays 
   * @returns {Promise<number>} Number of cleaned up locations
   */
  async cleanupExpiredLocations(expiryDays = 7) {
    try {
      return await UserLocation.cleanupExpired(expiryDays);
    } catch (error) {
      console.error("Cleanup expired locations error:", error);
      throw error;
    }
  }

  /**
   * Get delivery estimate for a location
   * @param {string} postalCode 
   * @param {Date} orderDate 
   * @returns {Promise<Object>} Delivery estimate
   */
  async getDeliveryEstimate(postalCode, orderDate = new Date()) {
    try {
      const deliveryZone = await DeliveryZone.findByPinCode(postalCode);

      if (!deliveryZone) {
        throw new Error(`Delivery zone not found for PIN code: ${postalCode}`);
      }

      const estimate = deliveryZone.estimateDeliveryDate(orderDate);

      return {
        zone: deliveryZone,
        estimate,
        zoneType: deliveryZone.type,
        deliveryDays: `${deliveryZone.deliveryTime.minDays}-${deliveryZone.deliveryTime.maxDays} days`
      };
    } catch (error) {
      console.error("Get delivery estimate error:", error);
      throw error;
    }
  }
}

export default new LocationService();
