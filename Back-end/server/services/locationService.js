import UserLocation from "../models/UserLocation.js";
import Warehouse from "../models/Warehouse.js";
import googleMapsService from "./googleMapsService.js";

// Simple in-memory cache for location data
const locationCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Location Service for managing user locations and delivery zones
 */
class LocationService {
  /**
   * Compute generic India-wide delivery estimate
   */
  computeGenericEstimate(minDays = 3, maxDays = 7, processingDays = 1) {
    const startDate = new Date();
    const addBusinessDays = (date, days) => {
      let d = new Date(date);
      let added = 0;
      while (added < days) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0) {
          added++;
        }
      }
      return d;
    };
    const afterProcessing = addBusinessDays(startDate, processingDays);
    const minDate = addBusinessDays(afterProcessing, minDays);
    const maxDate = addBusinessDays(afterProcessing, maxDays);
    const options = { month: "short", day: "numeric" };
    const minStr = minDate.toLocaleDateString("en-IN", options);
    const maxStr = maxDate.toLocaleDateString("en-IN", options);
    return {
      minDate,
      maxDate,
      formattedRange: minStr === maxStr ? `by ${minStr}` : `between ${minStr} and ${maxStr}`
    };
  }
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
        // Trust provided coordinates but try to reverse geocode if address is missing
        let latitude, longitude;
        if (Array.isArray(locationData.coordinates)) {
          [longitude, latitude] = locationData.coordinates;
        } else {
          latitude = locationData.coordinates.latitude;
          longitude = locationData.coordinates.longitude;
        }
        coordinates = { latitude, longitude };
        
        let city = locationData.address?.city;
        let state = locationData.address?.state;
        let postalCode = locationData.postalCode || locationData.address?.postalCode;
        let street = locationData.address?.street || '';
        let country = locationData.address?.country || 'India';
        
        // If critical info is missing, try reverse geocoding
        if (!city || city === 'Unknown' || !state) {
          try {
            console.log(`Attempting reverse geocode for ${latitude}, ${longitude}`);
            const geocoded = await googleMapsService.reverseGeocode(latitude, longitude);
            if (geocoded && geocoded.addressComponents) {
              city = geocoded.addressComponents.city || city;
              state = geocoded.addressComponents.state || state;
              postalCode = geocoded.addressComponents.postalCode || postalCode;
              street = geocoded.addressComponents.street || street;
              country = geocoded.addressComponents.country || country;
              formatted = geocoded.formatted;
              placeId = geocoded.placeId;
            }
          } catch (err) {
            console.warn("Reverse geocoding failed, falling back to basic info:", err.message);
            // Fallback will use whatever we have or defaults below
          }
        }

        city = city || 'Unknown';
        state = state || 'India';
        postalCode = postalCode || '';
        
        addressComponents = {
          street,
          city,
          state,
          postalCode,
          country
        };
        
        if (!formatted) {
          formatted = city && state
            ? `${city}, ${state}${postalCode ? ' ' + postalCode : ''}, ${country}`
            : `${latitude.toFixed(5)}, ${longitude.toFixed(5)} (${country})`;
        }
        
        if (!placeId) placeId = null;
      } else if (locationData.postalCode || (locationData.address && typeof locationData.address === 'object' && locationData.address.postalCode)) {
        const pinCode = locationData.postalCode || locationData.address.postalCode;
        const city = locationData.address?.city || 'Unknown';
        const state = locationData.address?.state || 'India';
        addressComponents = {
          street: locationData.address?.street || '',
          city,
          state,
          postalCode: pinCode,
          country: locationData.address?.country || 'India'
        };
        formatted = `${city}, ${state} ${pinCode}, ${addressComponents.country}`;
        coordinates = {
          latitude: 20.5937,
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

      // Find nearest warehouse
      const nearestWarehouses = await Warehouse.findNearest(
        coordinates.longitude,
        coordinates.latitude
      );
      
      const nearestWarehouse = nearestWarehouses.length > 0 ? nearestWarehouses[0]._id : null;

      // Always proceed without delivery zone logic (India-wide service)

      // If zone found, proceed as usual

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
        deliveryZone: undefined,
        nearestWarehouse,
        placeId
      };

      // Save location
      const savedLocation = await UserLocation.upsertLocation(identifier, locationPayload);

      // Cache the location data
      const cacheKey = identifier.userId ? `user:${identifier.userId}` : `session:${identifier.sessionId}`;
      const genericEstimate = this.computeGenericEstimate();
      locationCache.set(cacheKey, {
        data: {
          location: savedLocation,
          deliveryZone: null,
          nearestWarehouse: nearestWarehouses.length > 0 ? nearestWarehouses[0] : null,
          deliveryEstimate: genericEstimate
        },
        timestamp: Date.now()
      });

      return {
        location: savedLocation,
        deliveryZone: null,
        nearestWarehouse: nearestWarehouses.length > 0 ? nearestWarehouses[0] : null,
        deliveryEstimate: this.computeGenericEstimate()
      };
    } catch (error) {
      console.error("Select location error:", error);
      throw error;
    }
  }
  async getCurrentLocation(identifier) {
    try {
      // Check cache first
      const cacheKey = identifier.userId ? `user:${identifier.userId}` : `session:${identifier.sessionId}`;
      const cached = locationCache.get(cacheKey);
      
      // Return cached data if it's still valid
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log('Returning cached location data');
        return cached.data;
      }
      
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

      // Get delivery zone and warehouse details
      const deliveryZone = location.deliveryZone;
      const nearestWarehouse = location.nearestWarehouse;
      const deliveryEstimate = deliveryZone ? deliveryZone.estimateDeliveryDate() : null;

      // Cache the data
      locationCache.set(cacheKey, {
        data: {
          location,
          deliveryZone,
          nearestWarehouse,
          deliveryEstimate
        },
        timestamp: Date.now()
      });

      return {
        location,
        deliveryZone,
        nearestWarehouse,
        deliveryEstimate
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
      const genericEstimate = this.computeGenericEstimate();
      return {
        serviceable: true,
        zone: null,
        deliveryEstimate: genericEstimate,
        message: `Delivery available across India in ${genericEstimate.formattedRange}`
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
      
      // Clear cache
      const cacheKey = identifier.userId ? `user:${identifier.userId}` : `session:${identifier.sessionId}`;
      locationCache.delete(cacheKey);
      
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
   * Get delivery estimate for a postal code
   * @param {string} postalCode 
   * @returns {Promise<Object>} Delivery estimate
   */
  async getDeliveryEstimate(postalCode) {
    try {
      return {
        zone: null,
        estimate: this.computeGenericEstimate()
      };
    } catch (error) {
      console.error("Get delivery estimate error:", error);
      throw error;
    }
  }

  /**
   * Assign zone by city and state when PIN code lookup fails
   * @param {string} city 
   * @param {string} state 
   * @returns {Promise<Object|null>} Delivery zone or null
   */
  async assignZoneByCity(city, state) {
    return null;
  }
}

export default new LocationService();
