/**
 * Google Maps Configuration Verification Script
 * 
 * This script verifies that Google Maps API is configured correctly
 * and provides detailed diagnostic information.
 * 
 * Usage: node verify-google-maps-config.js
 */

import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

// Color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m"
};

function print(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printStatus(label, value, isGood) {
  const symbol = isGood ? "✓" : "✗";
  const color = isGood ? "green" : "red";
  print(`  ${symbol} ${label}: ${value}`, color);
}

function printSection(title) {
  print(`\n${"═".repeat(60)}`, "cyan");
  print(`  ${title}`, "cyan");
  print("═".repeat(60), "cyan");
}

async function verifyConfiguration() {
  print("\n╔════════════════════════════════════════════════════════════╗", "cyan");
  print("║   Google Maps API Configuration Verification            ║", "cyan");
  print("╚════════════════════════════════════════════════════════════╝", "cyan");
  
  let allGood = true;
  
  // ========== 1. Environment Variables Check ==========
  printSection("Environment Variables");
  
  const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  const clientKey = process.env.GOOGLE_MAPS_CLIENT_KEY;
  const region = process.env.GOOGLE_MAPS_REGION;
  const language = process.env.GOOGLE_MAPS_LANGUAGE;
  
  // Check server key
  if (!serverKey) {
    printStatus("GOOGLE_MAPS_SERVER_KEY", "NOT SET", false);
    allGood = false;
  } else if (serverKey === "your_server_key_here") {
    printStatus("GOOGLE_MAPS_SERVER_KEY", "PLACEHOLDER VALUE", false);
    print("    → Update with actual API key from Google Cloud Console", "yellow");
    allGood = false;
  } else if (!serverKey.startsWith("AIza")) {
    printStatus("GOOGLE_MAPS_SERVER_KEY", "INVALID FORMAT", false);
    print("    → API keys should start with 'AIza'", "yellow");
    allGood = false;
  } else {
    printStatus("GOOGLE_MAPS_SERVER_KEY", `${serverKey.substring(0, 20)}...`, true);
  }
  
  // Check client key
  if (!clientKey) {
    printStatus("GOOGLE_MAPS_CLIENT_KEY", "NOT SET", false);
    print("    → Required for frontend features (autocomplete, maps)", "yellow");
    allGood = false;
  } else if (clientKey === "your_client_key_here") {
    printStatus("GOOGLE_MAPS_CLIENT_KEY", "PLACEHOLDER VALUE", false);
    print("    → Update with actual API key from Google Cloud Console", "yellow");
    allGood = false;
  } else if (!clientKey.startsWith("AIza")) {
    printStatus("GOOGLE_MAPS_CLIENT_KEY", "INVALID FORMAT", false);
    allGood = false;
  } else {
    printStatus("GOOGLE_MAPS_CLIENT_KEY", `${clientKey.substring(0, 20)}...`, true);
  }
  
  // Check region
  if (region === "IN") {
    printStatus("GOOGLE_MAPS_REGION", region, true);
  } else {
    printStatus("GOOGLE_MAPS_REGION", region || "NOT SET", false);
    print("    → Should be set to 'IN' for India", "yellow");
    allGood = false;
  }
  
  // Check language
  if (language === "en") {
    printStatus("GOOGLE_MAPS_LANGUAGE", language, true);
  } else {
    printStatus("GOOGLE_MAPS_LANGUAGE", language || "NOT SET", false);
    print("    → Should be set to 'en' for English", "yellow");
    allGood = false;
  }
  
  // ========== 2. API Key Format Validation ==========
  printSection("API Key Format Validation");
  
  if (serverKey && serverKey !== "your_server_key_here") {
    const serverKeyLength = serverKey.length;
    const expectedLength = 39; // Typical Google API key length
    
    if (serverKeyLength === expectedLength) {
      printStatus("Server key length", `${serverKeyLength} characters`, true);
    } else {
      printStatus("Server key length", `${serverKeyLength} characters (expected ~${expectedLength})`, false);
      print("    → Key may be incomplete or have extra characters", "yellow");
    }
    
    // Check for common issues
    if (serverKey.includes(" ")) {
      printStatus("Server key format", "Contains spaces", false);
      print("    → Remove any spaces from the API key", "yellow");
      allGood = false;
    } else if (serverKey.includes("\n") || serverKey.includes("\r")) {
      printStatus("Server key format", "Contains line breaks", false);
      print("    → Remove any line breaks from the API key", "yellow");
      allGood = false;
    } else {
      printStatus("Server key format", "No spaces or line breaks", true);
    }
  }
  
  // ========== 3. Network Connectivity Test ==========
  printSection("Network Connectivity");
  
  try {
    print("  Testing connection to Google Maps API...", "blue");
    
    // Test basic connectivity
    const testUrl = "https://maps.googleapis.com/maps/api/geocode/json";
    const testParams = {
      address: "1600 Amphitheatre Parkway, Mountain View, CA",
      key: serverKey
    };
    
    const startTime = Date.now();
    const response = await axios.get(testUrl, { 
      params: testParams,
      timeout: 10000 
    });
    const duration = Date.now() - startTime;
    
    printStatus("Network connectivity", `OK (${duration}ms)`, true);
    
    // Check API response status
    const status = response.data.status;
    
    if (status === "OK") {
      printStatus("API response status", status, true);
      print("    → Geocoding API is working correctly!", "green");
    } else if (status === "REQUEST_DENIED") {
      printStatus("API response status", status, false);
      print("    → Possible issues:", "yellow");
      print("      - Geocoding API not enabled in Google Cloud Console", "yellow");
      print("      - API key restrictions blocking your IP address", "yellow");
      print("      - Invalid API key", "yellow");
      allGood = false;
    } else if (status === "OVER_QUERY_LIMIT") {
      printStatus("API response status", status, false);
      print("    → Quota exceeded or billing not enabled", "yellow");
      print("      - Enable billing in Google Cloud Console", "yellow");
      print("      - Check quota limits", "yellow");
      allGood = false;
    } else if (status === "INVALID_REQUEST") {
      printStatus("API response status", status, false);
      print("    → Request format issue (not a configuration problem)", "yellow");
      allGood = false;
    } else {
      printStatus("API response status", status, false);
      print(`    → Error details: ${response.data.error_message || "Unknown error"}`, "yellow");
      allGood = false;
    }
    
  } catch (error) {
    if (error.code === "ENOTFOUND") {
      printStatus("Network connectivity", "DNS resolution failed", false);
      print("    → Check your internet connection", "yellow");
      allGood = false;
    } else if (error.code === "ETIMEDOUT") {
      printStatus("Network connectivity", "Request timeout", false);
      print("    → Check your internet connection or firewall settings", "yellow");
      allGood = false;
    } else if (error.response) {
      printStatus("Network connectivity", `HTTP ${error.response.status}`, false);
      print(`    → Server returned error: ${error.response.statusText}`, "yellow");
      allGood = false;
    } else {
      printStatus("Network connectivity", "Failed", false);
      print(`    → Error: ${error.message}`, "yellow");
      allGood = false;
    }
  }
  
  // ========== 4. API Enablement Check ==========
  printSection("Required APIs Status");
  
  print("  To verify APIs are enabled:", "blue");
  print("  1. Go to: https://console.cloud.google.com/apis/dashboard", "blue");
  print("  2. Select your project", "blue");
  print("  3. Verify the following APIs are enabled:", "blue");
  print("     • Geocoding API", "blue");
  print("     • Places API", "blue");
  print("     • Maps JavaScript API", "blue");
  
  // ========== 5. Service File Check ==========
  printSection("Service Files");
  
  try {
    await import("./services/googleMapsService.js");
    printStatus("googleMapsService.js", "Found", true);
  } catch (error) {
    printStatus("googleMapsService.js", "Not found or has errors", false);
    print(`    → Error: ${error.message}`, "yellow");
    allGood = false;
  }
  
  try {
    await import("./services/locationService.js");
    printStatus("locationService.js", "Found", true);
  } catch (error) {
    printStatus("locationService.js", "Not found or has errors", false);
    print(`    → Error: ${error.message}`, "yellow");
    allGood = false;
  }
  
  // ========== 6. Recommendations ==========
  printSection("Recommendations");
  
  if (!allGood) {
    print("\n  ⚠ Issues detected in configuration", "yellow");
    print("\n  Next steps:", "yellow");
    print("  1. Review the errors above", "yellow");
    print("  2. Refer to GOOGLE_MAPS_SETUP_GUIDE.md for detailed instructions", "yellow");
    print("  3. Verify API keys in Google Cloud Console", "yellow");
    print("  4. Ensure all required APIs are enabled", "yellow");
    print("  5. Check API key restrictions (IP/referrer)", "yellow");
    print("  6. Run this script again after making changes\n", "yellow");
  } else {
    print("\n  ✓ All checks passed!", "green");
    print("\n  Your Google Maps API configuration is correct.", "green");
    print("  Run 'node test-google-maps-integration.js' for comprehensive testing.\n", "green");
  }
  
  // ========== 7. Configuration Summary ==========
  printSection("Configuration Summary");
  
  console.log("\n  Current Configuration:");
  console.log(`  {`);
  console.log(`    "serverKey": "${serverKey ? serverKey.substring(0, 20) + '...' : 'NOT SET'}",`);
  console.log(`    "clientKey": "${clientKey ? clientKey.substring(0, 20) + '...' : 'NOT SET'}",`);
  console.log(`    "region": "${region || 'NOT SET'}",`);
  console.log(`    "language": "${language || 'NOT SET'}"`);
  console.log(`  }\n`);
  
  // ========== 8. Useful Links ==========
  printSection("Useful Links");
  
  print("\n  • Google Cloud Console:", "blue");
  print("    https://console.cloud.google.com", "cyan");
  print("\n  • API Dashboard:", "blue");
  print("    https://console.cloud.google.com/apis/dashboard", "cyan");
  print("\n  • Credentials:", "blue");
  print("    https://console.cloud.google.com/apis/credentials", "cyan");
  print("\n  • Billing:", "blue");
  print("    https://console.cloud.google.com/billing", "cyan");
  print("\n  • Google Maps Documentation:", "blue");
  print("    https://developers.google.com/maps/documentation", "cyan");
  print("\n  • Pricing Calculator:", "blue");
  print("    https://cloud.google.com/maps-platform/pricing", "cyan");
  print("\n");
  
  return allGood;
}

// Run verification
verifyConfiguration()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    print(`\n✗ Fatal error: ${error.message}`, "red");
    console.error(error);
    process.exit(1);
  });
