import { categoryMap, normalizeCategory } from './category-mapping.js';

// Test the category mapping
console.log("Testing Category Mapping Dictionary\n");

// Test cases
const testCases = [
  "Car Accessories",
  "Exterior Styling",
  "Interior Styling",
  "Bodykits",
  "Performance Parts",
  "Suspension Systems",
  "Car Audio",
  "Lighting",
  "Autobacs India",
  "auxbeam",
  "Bushranger",
  "Ironman 4x4",
  "Bonnet Scoop",
  "Body Parts",
  "Awning",
  "LED lights",
  "Air Filters",
  "Nitro Gas Shock Absorbers"
];

console.log("Direct mapping tests:");
testCases.forEach(testCase => {
  const result = normalizeCategory(testCase);
  console.log(`  "${testCase}" → ${result || "NO MAPPING"}`);
});

console.log("\nPattern matching tests:");
const patternTests = [
  "Super bright led light",
  "Performance turbo kit",
  "Interior seat cover",
  "Exterior spoiler",
  "Body kit conversion",
  "Car accessory organizer"
];

patternTests.forEach(testCase => {
  const result = normalizeCategory(testCase);
  console.log(`  "${testCase}" → ${result || "NO MAPPING"}`);
});

console.log("\nTotal mappings in dictionary:", Object.keys(categoryMap).length);import { categoryMap, normalizeCategory } from './category-mapping.js';

// Test the category mapping
console.log("Testing Category Mapping Dictionary\n");

// Test cases
const testCases = [
  "Car Accessories",
  "Exterior Styling",
  "Interior Styling",
  "Bodykits",
  "Performance Parts",
  "Suspension Systems",
  "Car Audio",
  "Lighting",
  "Autobacs India",
  "auxbeam",
  "Bushranger",
  "Ironman 4x4",
  "Bonnet Scoop",
  "Body Parts",
  "Awning",
  "LED lights",
  "Air Filters",
  "Nitro Gas Shock Absorbers"
];

console.log("Direct mapping tests:");
testCases.forEach(testCase => {
  const result = normalizeCategory(testCase);
  console.log(`  "${testCase}" → ${result || "NO MAPPING"}`);
});

console.log("\nPattern matching tests:");
const patternTests = [
  "Super bright led light",
  "Performance turbo kit",
  "Interior seat cover",
  "Exterior spoiler",
  "Body kit conversion",
  "Car accessory organizer"
];

patternTests.forEach(testCase => {
  const result = normalizeCategory(testCase);
  console.log(`  "${testCase}" → ${result || "NO MAPPING"}`);
});

console.log("\nTotal mappings in dictionary:", Object.keys(categoryMap).length);