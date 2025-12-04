/**
 * Google Maps Integration Test Script
 * 
 * This script tests the Google Maps API integration to verify:
 * 1. API keys are configured correctly
 * 2. Geocoding API is working
 * 3. Reverse geocoding is functional
 * 4. Location service integration is operational
 * 
 * Run this script after configuring Google Maps API keys in .env
 * 
 * Usage: node test-google-maps-integration.js
 */

import dotenv from "dotenv";
import googleMapsService from "./services/googleMapsService.js";
import axios from "axios";

dotenv.config();

// Test configuration
const TEST_CONFIG = {
  // Test address in India
  testAddress: "Connaught Place, New Delhi, Delhi 110001, India",
  
  // Test coordinates (Delhi city center)
  testLatitude: 28.6139,
  testLongitude: 77.2090,
  
  // Test PIN code
  testPinCode: "110001",
  
  // Expected results tolerance
  coordinateTolerance: 0.1, // degrees
};

// Color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

/**
 * Print colored output to console
 */
function print(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Print test result
 */
function printResult(testName, passed, details = "") {
  const symbol = passed ? "✓" : "✗";
  const color = passed ? "green" : "red";
  print(`${symbol} ${testName}`, color);
  if (details) {
    console.log(`  ${details}`);
  }
}

/**
 * Test 1: Configuration Check
 */
async function testConfiguration() {
  print("\n=== Test 1: Configuration Check ===", "cyan");
  
  const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  const clientKey = process.env.GOOGLE_MAPS_CLIENT_KEY;
  
  // Check if keys are configured
  const serverKeyConfigured = serverKey && serverKey !== "your_server_key_here";
  const clientKeyConfigured = clientKey && clientKey !== "your_client_key_here";
  
  printResult(
    "Server API key configured",
    serverKeyConfigured,
    serverKeyConfigured ? `Key: ${serverKey.substring(0, 20)}...` : "Missing or using placeholder"
  );
  
  printResult(
    "Client API key configured",
    clientKeyConfigured,
    clientKeyConfigured ? `Key: ${clientKey.substring(0, 20)}...` : "Missing or using placeholder"
  );
  
  // Check other settings
  const region = process.env.GOOGLE_MAPS_REGION;
  const language = process.env.GOOGLE_MAPS_LANGUAGE;
  
  printResult(
    "Region configured",
    region === "IN",
    `Region: ${region || "Not set"}`
  );
  
  printResult(
    "Language configured",
    language === "en",
    `Language: ${language || "Not set"}`
  );
  
  return serverKeyConfigured && clientKeyConfigured;
}

/**
 * Test 2: Geocoding API
 */
async function testGeocoding() {
  print("\n=== Test 2: Geocoding API ===", "cyan");
  
  try {
    print(`Testing address: ${TEST_CONFIG.testAddress}`, "blue");
    
    const result = await googleMapsService.geocodeAddress(TEST_CONFIG.testAddress);
    
    // Verify result structure
    const hasCoordinates = result.coordinates && 
                          typeof result.coordinates.latitude === "number" &&
                          typeof result.coordinates.longitude === "number";
    
    const hasFormattedAddress = typeof result.formatted === "string" && result.formatted.length > 0;
    const hasPlaceId = typeof result.placeId === "string" && result.placeId.length > 0;
    const hasAddressComponents = result.addressComponents && typeof result.addressComponents === "object";
    
    printResult("Geocoding request successful", true);
    printResult("Coordinates received", hasCoordinates, 
               hasCoordinates ? `Lat: ${result.coordinates.latitude}, Lng: ${result.coordinates.longitude}` : "");
    printResult("Formatted address received", hasFormattedAddress,
               hasFormattedAddress ? `Address: ${result.formatted}` : "");
    printResult("Place ID received", hasPlaceId,
               hasPlaceId ? `Place ID: ${result.placeId}` : "");
    printResult("Address components parsed", hasAddressComponents,
               hasAddressComponents ? `Components: ${Object.keys(result.addressComponents).join(", ")}` : "");
    
    // Check if coordinates are in expected range (India)
    const inIndia = result.coordinates.latitude >= 6 && result.coordinates.latitude <= 37 &&
                   result.coordinates.longitude >= 68 && result.coordinates.longitude <= 98;
    
    printResult("Coordinates in India range", inIndia);
    
    return hasCoordinates && hasFormattedAddress && hasPlaceId && hasAddressComponents && inIndia;
    
  } catch (error) {
    printResult("Geocoding API test", false, `Error: ${error.message}`);
    
    // Provide helpful error messages
    if (error.message.includes("not configured")) {
      print("  → Check that GOOGLE_MAPS_SERVER_KEY is set in .env file", "yellow");
    } else if (error.message.includes("REQUEST_DENIED")) {
      print("  → Verify Geocoding API is enabled in Google Cloud Console", "yellow");
      print("  → Check API key restrictions allow your server IP", "yellow");
    } else if (error.message.includes("OVER_QUERY_LIMIT")) {
      print("  → Check billing is enabled in Google Cloud Console", "yellow");
      print("  → Verify quota limits are not exceeded", "yellow");
    }
    
    return false;
  }
}

/**
 * Test 3: Reverse Geocoding API
 */
async function testReverseGeocoding() {
  print("\n=== Test 3: Reverse Geocoding API ===", "cyan");
  
  try {
    print(`Testing coordinates: ${TEST_CONFIG.testLatitude}, ${TEST_CONFIG.testLongitude}`, "blue");
    
    const result = await googleMapsService.reverseGeocode(
      TEST_CONFIG.testLatitude,
      TEST_CONFIG.testLongitude
    );
    
    // Verify result structure
    const hasFormattedAddress = typeof result.formatted === "string" && result.formatted.length > 0;
    const hasPostalCode = result.addressComponents && result.addressComponents.postalCode;
    const hasCity = result.addressComponents && result.addressComponents.city;
    
    printResult("Reverse geocoding successful", true);
    printResult("Address extracted", hasFormattedAddress,
               hasFormattedAddress ? `Address: ${result.formatted}` : "");
    printResult("PIN code extracted", hasPostalCode,
               hasPostalCode ? `PIN: ${result.addressComponents.postalCode}` : "");
    printResult("City extracted", hasCity,
               hasCity ? `City: ${result.addressComponents.city}` : "");
    
    return hasFormattedAddress && hasPostalCode;
    
  } catch (error) {
    printResult("Reverse geocoding test", false, `Error: ${error.message}`);
    
    // Provide helpful error messages
    if (error.message.includes("PIN code")) {
      print("  → This location may not have a postal code in Google's database", "yellow");
      print("  → This is expected behavior; manual PIN entry will be used", "yellow");
    } else if (error.message.includes("not configured")) {
      print("  → Check that GOOGLE_MAPS_SERVER_KEY is set in .env file", "yellow");
    }
    
    return false;
  }
}

/**
 * Test 4: Distance Calculation
 */
async function testDistanceCalculation() {
  print("\n=== Test 4: Distance Calculation ===", "cyan");
  
  try {
    // Test Haversine formula with known coordinates
    // Delhi to Mumbai approximate distance: ~1,150 km
    const delhiLat = 28.6139;
    const delhiLng = 77.2090;
    const mumbaiLat = 19.0760;
    const mumbaiLng = 72.8777;
    
    const distance = googleMapsService.calculateDistance(
      delhiLat, delhiLng,
      mumbaiLat, mumbaiLng
    );
    
    const distanceKm = (distance / 1000).toFixed(2);
    
    // Expected distance should be around 1,150 km (±100 km tolerance)
    const isReasonable = distance > 1000000 && distance < 1300000;
    
    printResult("Distance calculation working", true,
               `Delhi to Mumbai: ${distanceKm} km`);
    printResult("Distance value reasonable", isReasonable,
               isReasonable ? "Within expected range (1,000-1,300 km)" : "Outside expected range");
    
    // Test same location (should be ~0)
    const sameDistance = googleMapsService.calculateDistance(
      delhiLat, delhiLng,
      delhiLat, delhiLng
    );
    
    printResult("Same location returns zero", sameDistance < 1,
               `Distance: ${sameDistance.toFixed(2)} meters`);
    
    return isReasonable && sameDistance < 1;
    
  } catch (error) {
    printResult("Distance calculation test", false, `Error: ${error.message}`);
    return false;
  }
}

/**
 * Test 5: Caching Mechanism
 */
async function testCaching() {
  print("\n=== Test 5: Caching Mechanism ===", "cyan");
  
  try {
    const testAddress = "India Gate, New Delhi, India";
    
    // Clear cache first
    googleMapsService.clearCache();
    printResult("Cache cleared", true);
    
    // First request (should hit API)
    print("Making first geocoding request...", "blue");
    const startTime1 = Date.now();
    const result1 = await googleMapsService.geocodeAddress(testAddress);
    const duration1 = Date.now() - startTime1;
    
    printResult("First request completed", true, `Time: ${duration1}ms`);
    
    // Second request (should use cache)
    print("Making second geocoding request (should use cache)...", "blue");
    const startTime2 = Date.now();
    const result2 = await googleMapsService.geocodeAddress(testAddress);
    const duration2 = Date.now() - startTime2;
    
    printResult("Second request completed", true, `Time: ${duration2}ms`);
    
    // Cache should be faster
    const cacheIsFaster = duration2 < duration1;
    printResult("Cache improves performance", cacheIsFaster,
               cacheIsFaster ? `${((1 - duration2/duration1) * 100).toFixed(0)}% faster` : "");
    
    // Results should be identical
    const resultsMatch = JSON.stringify(result1) === JSON.stringify(result2);
    printResult("Cached results match original", resultsMatch);
    
    return cacheIsFaster && resultsMatch;
    
  } catch (error) {
    printResult("Caching test", false, `Error: ${error.message}`);
    return false;
  }
}

/**
 * Test 6: Location Service Integration
 */
async function testLocationServiceIntegration() {
  print("\n=== Test 6: Location Service Integration ===", "cyan");
  
  try {
    // This test requires the backend server to be running
    const serverUrl = `http://localhost:${process.env.PORT || 5000}`;
    
    // Test if server is running
    try {
      await axios.get(`${serverUrl}/api/health`);
      printResult("Backend server is running", true);
    } catch (error) {
      printResult("Backend server is running", false, 
                 "Server not responding. Please start the backend server first.");
      return false;
    }
    
    // Test PIN code-based location selection
    const testPayload = {
      address: {
        postalCode: TEST_CONFIG.testPinCode,
        city: "New Delhi",
        state: "Delhi",
        country: "India"
      }
    };
    
    print(`Testing location selection with PIN: ${TEST_CONFIG.testPinCode}`, "blue");
    
    const response = await axios.post(
      `${serverUrl}/api/location/select`,
      testPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': 'test-session-' + Date.now()
        }
      }
    );
    
    const locationData = response.data;
    
    printResult("Location selection endpoint working", response.status === 200);
    printResult("Location saved successfully", locationData.success === true);
    
    return response.status === 200 && locationData.success === true;
    
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      printResult("Location service integration test", false,
                 "Backend server not running. Start server with 'npm run dev'");
    } else {
      printResult("Location service integration test", false,
                 `Error: ${error.message}`);
    }
    return false;
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  print("\n╔═══════════════════════════════════════════════════════╗", "cyan");
  print("║   Google Maps API Integration Test Suite           ║", "cyan");
  print("╚═══════════════════════════════════════════════════════╝", "cyan");
  
  const results = {
    configuration: false,
    geocoding: false,
    reverseGeocoding: false,
    distanceCalculation: false,
    caching: false,
    locationService: false
  };
  
  try {
    // Run tests sequentially
    results.configuration = await testConfiguration();
    
    if (!results.configuration) {
      print("\n⚠ Configuration test failed. Fix configuration before proceeding.", "yellow");
      print("Refer to GOOGLE_MAPS_SETUP_GUIDE.md for setup instructions.", "yellow");
      return;
    }
    
    results.geocoding = await testGeocoding();
    results.reverseGeocoding = await testReverseGeocoding();
    results.distanceCalculation = await testDistanceCalculation();
    results.caching = await testCaching();
    results.locationService = await testLocationServiceIntegration();
    
  } catch (error) {
    print(`\n✗ Fatal error during testing: ${error.message}`, "red");
    console.error(error);
  }
  
  // Print summary
  print("\n╔═══════════════════════════════════════════════════════╗", "cyan");
  print("║   Test Summary                                      ║", "cyan");
  print("╚═══════════════════════════════════════════════════════╝", "cyan");
  
  const totalTests = Object.keys(results).length;
  const passedTests = Object.values(results).filter(r => r === true).length;
  const failedTests = totalTests - passedTests;
  
  print(`\nTotal Tests: ${totalTests}`);
  print(`Passed: ${passedTests}`, "green");
  print(`Failed: ${failedTests}`, failedTests > 0 ? "red" : "green");
  
  Object.entries(results).forEach(([testName, passed]) => {
    const symbol = passed ? "✓" : "✗";
    const color = passed ? "green" : "red";
    print(`  ${symbol} ${testName}`, color);
  });
  
  if (passedTests === totalTests) {
    print("\n🎉 All tests passed! Google Maps integration is working correctly.", "green");
    print("You can now use location features in the Autobacs application.", "green");
  } else {
    print(`\n⚠ ${failedTests} test(s) failed. Please review errors above.`, "yellow");
    print("Refer to GOOGLE_MAPS_SETUP_GUIDE.md for troubleshooting steps.", "yellow");
  }
  
  print("\n");
}

// Run tests
runAllTests().catch(error => {
  print(`\n✗ Unexpected error: ${error.message}`, "red");
  console.error(error);
  process.exit(1);
});
