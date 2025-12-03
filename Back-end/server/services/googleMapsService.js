import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * Google Maps Service for location-related operations
 * Handles geocoding, place details, and autocomplete
 */
class GoogleMapsService {
  constructor() {
    this.serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
    this.clientKey = process.env.GOOGLE_MAPS_CLIENT_KEY;
    this.region = process.env.GOOGLE_MAPS_REGION || "IN";
    this.language = process.env.GOOGLE_MAPS_LANGUAGE || "en";
    this.geocodingCache = new Map(); // In-memory cache for geocoding results
    this.cacheDuration = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
  }

  /**
   * Geocode an address to get coordinates
   * @param {string} address - Address to geocode
   * @returns {Promise<Object>} Geocoding result with coordinates
   */
  async geocodeAddress(address) {
    try {
      // Check if API key is configured
      if (!this.serverKey || this.serverKey === 'your_server_key_here') {
        throw new Error('GOOGLE_MAPS_API_NOT_CONFIGURED');
      }

      // Check cache first
      const cacheKey = `geocode_${address}`;
      const cached = this.getCached(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await axios.get(
        "https://maps.googleapis.com/maps/api/geocode/json",
        {
          params: {
            address: address,
            key: this.serverKey,
            region: this.region,
            language: this.language
          }
        }
      );

      if (response.data.status !== "OK") {
        console.error('Google Maps API Response:', response.data);
        throw new Error(`Geocoding failed: ${response.data.status}`);
      }

      const result = response.data.results[0];
      const geocoded = {
        formatted: result.formatted_address,
        coordinates: {
          longitude: result.geometry.location.lng,
          latitude: result.geometry.location.lat
        },
        placeId: result.place_id,
        addressComponents: this.parseAddressComponents(result.address_components)
      };

      // Cache the result
      this.setCached(cacheKey, geocoded);

      return geocoded;
    } catch (error) {
      console.error("Geocoding error:", error.message);
      
      // Provide specific error messages
      if (error.message === 'GOOGLE_MAPS_API_NOT_CONFIGURED') {
        throw new Error('Location services not configured');
      } else if (error.response?.status === 403) {
        throw new Error('Location services unavailable');
      }
      
      throw new Error("Failed to geocode address");
    }
  }

  /**
   * Reverse geocode coordinates to get address
   * @param {number} latitude 
   * @param {number} longitude 
   * @returns {Promise<Object>} Address details
   */
  async reverseGeocode(latitude, longitude) {
    try {
      // Check if API key is configured
      if (!this.serverKey || this.serverKey === 'your_server_key_here') {
        throw new Error('GOOGLE_MAPS_API_NOT_CONFIGURED');
      }

      const cacheKey = `reverse_${latitude}_${longitude}`;
      const cached = this.getCached(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await axios.get(
        "https://maps.googleapis.com/maps/api/geocode/json",
        {
          params: {
            latlng: `${latitude},${longitude}`,
            key: this.serverKey,
            region: this.region,
            language: this.language
          }
        }
      );

      if (response.data.status !== "OK") {
        console.error('Google Maps API Response:', response.data);
        throw new Error(`Reverse geocoding failed: ${response.data.status}`);
      }

      const result = response.data.results[0];
      const geocoded = {
        formatted: result.formatted_address,
        coordinates: {
          longitude: result.geometry.location.lng,
          latitude: result.geometry.location.lat
        },
        placeId: result.place_id,
        addressComponents: this.parseAddressComponents(result.address_components)
      };

      // Verify postal code exists
      if (!geocoded.addressComponents.postalCode) {
        throw new Error('NO_POSTAL_CODE_FOUND');
      }

      this.setCached(cacheKey, geocoded);

      return geocoded;
    } catch (error) {
      console.error("Reverse geocoding error:", error.message);
      
      // Provide specific error messages
      if (error.message === 'GOOGLE_MAPS_API_NOT_CONFIGURED') {
        throw new Error('Location services not configured. Please enter PIN code manually.');
      } else if (error.message === 'NO_POSTAL_CODE_FOUND') {
        throw new Error('Unable to determine PIN code from location. Please enter it manually.');
      } else if (error.response?.status === 403) {
        throw new Error('Location services unavailable. Please enter PIN code manually.');
      }
      
      throw new Error("Failed to reverse geocode coordinates");
    }
  }

  /**
   * Get place details by Place ID
   * @param {string} placeId - Google Maps Place ID
   * @returns {Promise<Object>} Place details
   */
  async getPlaceDetails(placeId) {
    try {
      const cacheKey = `place_${placeId}`;
      const cached = this.getCached(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await axios.get(
        "https://maps.googleapis.com/maps/api/place/details/json",
        {
          params: {
            place_id: placeId,
            key: this.serverKey,
            fields: "formatted_address,geometry,address_components,place_id",
            region: this.region,
            language: this.language
          }
        }
      );

      if (response.data.status !== "OK") {
        throw new Error(`Place details failed: ${response.data.status}`);
      }

      const result = response.data.result;
      const placeDetails = {
        formatted: result.formatted_address,
        coordinates: {
          longitude: result.geometry.location.lng,
          latitude: result.geometry.location.lat
        },
        placeId: result.place_id,
        addressComponents: this.parseAddressComponents(result.address_components)
      };

      this.setCached(cacheKey, placeDetails);

      return placeDetails;
    } catch (error) {
      console.error("Place details error:", error.message);
      throw new Error("Failed to get place details");
    }
  }

  /**
   * Parse address components into structured format
   * @param {Array} components - Address components from Google Maps
   * @returns {Object} Parsed address components
   */
  parseAddressComponents(components) {
    const parsed = {
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "India"
    };

    components.forEach((component) => {
      const types = component.types;

      if (types.includes("street_number") || types.includes("route")) {
        parsed.street += (parsed.street ? " " : "") + component.long_name;
      }

      if (types.includes("locality") || types.includes("administrative_area_level_2")) {
        parsed.city = component.long_name;
      }

      if (types.includes("administrative_area_level_1")) {
        parsed.state = component.long_name;
      }

      if (types.includes("postal_code")) {
        parsed.postalCode = component.long_name;
      }

      if (types.includes("country")) {
        parsed.country = component.long_name;
      }
    });

    return parsed;
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   * @param {number} lat1 - Latitude of first point
   * @param {number} lon1 - Longitude of first point
   * @param {number} lat2 - Latitude of second point
   * @param {number} lon2 - Longitude of second point
   * @returns {number} Distance in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Get cached value
   * @param {string} key - Cache key
   * @returns {Object|null} Cached value or null
   */
  getCached(key) {
    const cached = this.geocodingCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }
    return null;
  }

  /**
   * Set cached value
   * @param {string} key - Cache key
   * @param {Object} data - Data to cache
   */
  setCached(key, data) {
    this.geocodingCache.set(key, {
      data,
      timestamp: Date.now()
    });

    // Cleanup old cache entries (keep cache size manageable)
    if (this.geocodingCache.size > 1000) {
      const firstKey = this.geocodingCache.keys().next().value;
      this.geocodingCache.delete(firstKey);
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.geocodingCache.clear();
  }

  /**
   * Get client-side API key (for frontend use)
   * @returns {string} Client API key
   */
  getClientKey() {
    return this.clientKey;
  }
}

export default new GoogleMapsService();
