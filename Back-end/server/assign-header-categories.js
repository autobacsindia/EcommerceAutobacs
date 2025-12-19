import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "./models/Product.js";
import Category from "./models/Category.js";

dotenv.config();

// Define the header navigation categories
const HEADER_NAV_CATEGORIES = ["Body Kits", "Audio", "Lights"];

// Define keyword patterns for each category
const CATEGORY_KEYWORDS = {
  "Body Kits": [
    "bumper", "spoiler", "side skirt", "body kit", "fender flare", "hood", 
    "bumper kit", "facelift", "conversion kit", "front bumper", "rear bumper",
    "body part", "kit", "panel", "skirt"
  ],
  "Audio": [
    "speaker", "subwoofer", "amplifier", "stereo", "head unit", "sound system",
    "audio", "sub woofer", "amp", "radio", "car stereo", "sound bar"
  ],
  "Lights": [
    "fog light", "headlamp", "led", "taillight", "headlight", "light bar",
    "driving light", "spotlight", "work light", "lighting", "lamp", "bulb",
    "tail light", "fog lamp", "halogen", "hid", "xenon"
  ]
};

/**
 * Check if a product matches keywords for a specific category
 * @param {Object} product - The product to check
 * @param {string} categoryName - The category to check against
 * @returns {boolean} True if product matches category keywords
 */
function productMatchesCategory(product, categoryName) {
  const keywords = CATEGORY_KEYWORDS[categoryName];
  const productName = product.name ? product.name.toLowerCase() : "";
  const productDesc = product.description ? product.description.toLowerCase() : "";
  const productTags = product.tags ? product.tags.join(" ").toLowerCase() : "";
  const productBrand = product.brand ? product.brand.toLowerCase() : "";
  
  // Combine all text fields for searching
  const searchText = `${productName} ${productDesc} ${productTags} ${productBrand}`;
  
  // Check if any keyword matches
  return keywords.some(keyword => searchText.includes(keyword.toLowerCase()));
}

/**
 * Get category ID by name
 * @param {string} categoryName - The category name
 * @returns {Promise<string|null>} The category ID or null if not found
 */
async function getCategoryIdByName(categoryName) {
  try {
    const category = await Category.findOne({ name: categoryName });
    return category ? category._id : null;
  } catch (error) {
    console.error(`Error finding category ${categoryName}:`, error);
    return null;
  }
}

/**
 * Assign products to header navigation categories
 */
async function assignHeaderCategories() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Get category IDs
    const categoryIds = {};
    for (const categoryName of HEADER_NAV_CATEGORIES) {
      const categoryId = await getCategoryIdByName(categoryName);
      if (categoryId) {
        categoryIds[categoryName] = categoryId;
        console.log(`Found category "${categoryName}" with ID: ${categoryId}`);
      } else {
        console.warn(`Warning: Category "${categoryName}" not found in database`);
      }
    }

    // Initialize counters
    const reassignedProducts = [];
    const categoryCounts = {};
    HEADER_NAV_CATEGORIES.forEach(cat => categoryCounts[cat] = 0);

    // Get all products
    console.log("Fetching all products...");
    const allProducts = await Product.find({});
    console.log(`Found ${allProducts.length} products to process`);

    // Process each product
    for (const product of allProducts) {
      let assignedCategory = null;
      
      // Check each header nav category
      for (const categoryName of HEADER_NAV_CATEGORIES) {
        if (productMatchesCategory(product, categoryName)) {
          assignedCategory = categoryName;
          break; // Assign to first matching category only
        }
      }
      
      // If we found a matching category and it exists in our database
      if (assignedCategory && categoryIds[assignedCategory]) {
        // Check if product is already assigned to this category
        const isAlreadyAssigned = product.categories && 
          product.categories.some(catId => catId.toString() === categoryIds[assignedCategory].toString());
        
        if (!isAlreadyAssigned) {
          // Update the product
          await Product.findByIdAndUpdate(product._id, {
            $set: { categories: [categoryIds[assignedCategory]] }
          });
          
          // Track the reassignment
          reassignedProducts.push({
            product_id: product._id.toString(),
            product_name: product.name,
            old_categories: product.categories ? product.categories.map(String) : [],
            new_category: assignedCategory
          });
          
          categoryCounts[assignedCategory]++;
          console.log(`Assigned "${product.name}" to "${assignedCategory}"`);
        }
      }
    }

    // Generate report
    console.log("\n=== HEADER NAVIGATION CATEGORY ASSIGNMENT REPORT ===\n");
    console.log("Products reassigned:");
    reassignedProducts.forEach((item, index) => {
      console.log(`${index + 1}. ${item.product_name} (${item.product_id}) → ${item.new_category}`);
    });
    
    console.log("\nSummary:");
    let totalReassigned = 0;
    for (const [category, count] of Object.entries(categoryCounts)) {
      console.log(`  ${category}: ${count} products`);
      totalReassigned += count;
    }
    console.log(`  Total reassigned: ${totalReassigned} products`);
    
    // Save results to file
    await saveResultsToFile(reassignedProducts, categoryCounts);
    
    console.log("\nAssignment complete. Results saved to file.");
    
  } catch (error) {
    console.error("Error during category assignment:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("Disconnected from MongoDB");
  }
}

/**
 * Save results to file
 * @param {Array} reassignedProducts - List of reassigned products
 * @param {Object} categoryCounts - Count of products per category
 */
async function saveResultsToFile(reassignedProducts, categoryCounts) {
  const fs = (await import("fs")).default;
  const path = (await import("path")).default;
  
  // Create reports directory if it doesn't exist
  const reportsDir = path.join(process.cwd(), "reports-header-nav");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  // Save reassigned products
  const reassignedPath = path.join(reportsDir, "header-nav-reassigned-products.json");
  fs.writeFileSync(
    reassignedPath,
    JSON.stringify(reassignedProducts, null, 2)
  );
  
  // Save summary
  const summaryPath = path.join(reportsDir, "header-nav-assignment-summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(categoryCounts, null, 2)
  );
  
  // Save detailed report
  const reportPath = path.join(reportsDir, "header-nav-assignment-report.txt");
  const reportContent = `
HEADER NAVIGATION CATEGORY ASSIGNMENT REPORT
==========================================

Products reassigned: ${reassignedProducts.length}

${reassignedProducts.map((item, index) => 
  `${index + 1}. ${item.product_name} (${item.product_id}) → ${item.new_category}`
).join('\n')}

Summary:
${Object.entries(categoryCounts).map(([category, count]) => 
  `  ${category}: ${count} products`
).join('\n')}
  Total reassigned: ${reassignedProducts.length} products
  `.trim();
  
  fs.writeFileSync(reportPath, reportContent);
  
  console.log(`Reports saved to ${reportsDir}/`);
}

// Run the assignment if this script is executed directly
assignHeaderCategories();

export default assignHeaderCategories;