import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "./models/Product.js";
import Category from "./models/Category.js";

dotenv.config();

// Define the valid categories as specified in the requirements
const VALID_CATEGORIES = [
  "Accessories",
  "Exterior",
  "Interior",
  "Body Kits",
  "Performance",
  "Suspension",
  "Audio",
  "Lights"
];

/**
 * Normalize category name for comparison
 * @param {string} categoryName - The category name to normalize
 * @returns {string} Normalized category name
 */
function normalizeCategoryName(categoryName) {
  if (!categoryName) return "";
  return categoryName.trim();
}

/**
 * Validate if a category is in the valid categories list
 * @param {string} categoryName - The category name to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidCategory(categoryName) {
  const normalizedName = normalizeCategoryName(categoryName);
  return VALID_CATEGORIES.some(validCat => 
    normalizeCategoryName(validCat).toLowerCase() === normalizedName.toLowerCase()
  );
}

/**
 * Test the validation with a small sample
 */
async function testValidateProductCategories() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Get a small sample of products for testing
    const products = await Product.find({}).limit(5);
    
    if (products.length === 0) {
      console.log("No products found in database for testing");
      return;
    }
    
    // Get all categories from database for reference
    const allCategories = await Category.find({});
    const categoryMap = new Map();
    allCategories.forEach(cat => {
      categoryMap.set(cat._id.toString(), cat.name);
    });

    console.log("Testing with sample products...\n");
    
    // Process sample products
    for (const product of products) {
      // Get the primary category name (first category in array)
      let assignedCategoryName = "";
      
      if (product.categories && product.categories.length > 0) {
        // Populate the category to get the name
        const populatedProduct = await Product.findById(product._id).populate('categories');
        if (populatedProduct.categories && populatedProduct.categories.length > 0) {
          assignedCategoryName = populatedProduct.categories[0].name;
        }
      }

      // Validate the category
      const isValid = isValidCategory(assignedCategoryName);
      const validationStatus = isValid ? "VALID" : "INVALID";

      // Display result
      console.log(`Product: ${product.name}`);
      console.log(`  ID: ${product._id}`);
      console.log(`  Assigned Category: ${assignedCategoryName || "MISSING"}`);
      console.log(`  Validation Status: ${validationStatus}`);
      console.log("");
    }
    
    console.log("Sample validation complete.");
    
  } catch (error) {
    console.error("Error during test validation:", error);
  } finally {
    await mongoose.connection.close();
    console.log("Disconnected from MongoDB");
  }
}

// Run the test if this script is executed directly
testValidateProductCategories();

export default testValidateProductCategories;