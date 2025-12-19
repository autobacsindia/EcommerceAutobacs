// Category mapping dictionary to normalize WordPress categories to standardized ones
export const categoryMap = {
  // Direct mappings for common categories
  "Car Accessories": "Accessories",
  "Exterior Styling": "Exterior",
  "Interior Styling": "Interior",
  "Bodykits": "Body Kits",
  "Bodykit": "Body Kits",
  "Body kit": "Body Kits",
  "Body Kit": "Body Kits",
  "Performance Parts": "Performance",
  "Performance Part": "Performance",
  "Suspension Systems": "Suspension",
  "Suspension System": "Suspension",
  "Car Audio": "Audio",
  "Lighting": "Lights",
  "Car Lights": "Lights",
  "Automotive Lighting": "Lights",
  
  // Brand-specific mappings
  "Autobacs India": "Accessories", // Most generic products
  "auxbeam": "Lights",
  "Auxillary Exterior Light": "Lights",
  "Bushranger": "Accessories",
  "Ironman 4x4": "Accessories",
  "Profender": "Suspension",
  "M.A.R.K. Sport": "Accessories",
  "Proman": "Accessories",
  "Option4WD": "Accessories",
  "Hamer": "Accessories",
  "ComeUp": "Accessories",
  
  // Specific product type mappings
  "Bonnet Scoop": "Exterior",
  "Bonnet Hood": "Exterior",
  "Body Parts": "Body Kits",
  "Body kit car bumber": "Body Kits",
  "Bumper": "Body Kits",
  "Exterior Accessories": "Exterior",
  "Awning": "Accessories",
  "awning": "Accessories",
  "cross bar": "Accessories",
  "ARMORO": "Accessories",
  "LED lights": "Lights",
  "Automotive Storage": "Accessories",
  "Nitro Gas Shock Absorbers": "Suspension",
  "Brands": "Accessories",
  "Ambient Lights": "Lights",
  "coil springs": "Suspension",
  "Revolution": "Accessories",
  "Leveling Kit": "Suspension",
  "Air Filters": "Accessories",
  "front leveling kit": "Suspension",
  "lift kit": "Suspension",
  "Suspension Kit": "Suspension",
  "Coil Suspension": "Suspension",
  "Foam Cell Shock Absorbers": "Suspension",
  "brake rotors": "Performance",
  "Dual Battery Manager": "Accessories",
  "Dual Battery Monitor Display": "Accessories",
  "Generic Driving Light Wiring Harness": "Lights",
  "filter": "Accessories",
  "AFN": "Body Kits",
  "aluminum hood": "Exterior",
  "Floor Mats": "Interior",
  "Canopy": "Accessories",
  "Tail Light": "Lights",
  "Coilovers": "Suspension",
  "Exhaust": "Performance",
  "Brake Kit": "Performance",
  "Brake Light": "Lights",
  "Grab Handle": "Interior",
  "dicky shutter": "Body Kits",
  
  // Pattern-based fallbacks (these would be handled programmatically)
  // Items containing these words would map to respective categories
};

// Reverse mapping for easier lookup
export const reverseCategoryMap = Object.fromEntries(
  Object.entries(categoryMap).map(([key, value]) => [value, key])
);

// Function to normalize a category name
export function normalizeCategory(categoryName) {
  if (!categoryName) return null;
  
  // Clean and normalize the input
  const cleanName = categoryName.trim();
  
  // Direct mapping lookup
  if (categoryMap[cleanName]) {
    return categoryMap[cleanName];
  }
  
  // Case insensitive lookup
  const lowerName = cleanName.toLowerCase();
  for (const [key, value] of Object.entries(categoryMap)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  
  // Pattern matching for common variations
  if (lowerName.includes('light') && !lowerName.includes('lighting')) {
    return 'Lights';
  }
  if (lowerName.includes('audio') || lowerName.includes('speaker')) {
    return 'Audio';
  }
  if (lowerName.includes('suspension') || lowerName.includes('shock')) {
    return 'Suspension';
  }
  if (lowerName.includes('performance') || lowerName.includes('turbo')) {
    return 'Performance';
  }
  if (lowerName.includes('interior') || lowerName.includes('steering') || lowerName.includes('seat')) {
    return 'Interior';
  }
  if (lowerName.includes('exterior') || lowerName.includes('bumper') || lowerName.includes('spoiler')) {
    return 'Exterior';
  }
  if (lowerName.includes('body') || lowerName.includes('kit')) {
    return 'Body Kits';
  }
  if (lowerName.includes('accessorie') || lowerName.includes('part')) {
    return 'Accessories';
  }
  
  // If no mapping found, return null
  return null;
}

export default { categoryMap, reverseCategoryMap, normalizeCategory };