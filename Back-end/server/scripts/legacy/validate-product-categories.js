import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../../models/Product.js";
import Category from "../../models/Category.js";

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
 * Validate product category assignments
 */
async function validateProductCategories() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Get all categories from database for reference
    const allCategories = await Category.find({});
    const categoryMap = new Map();
    allCategories.forEach(cat => {
      categoryMap.set(cat._id.toString(), cat.name);
    });

    // Initialize results and counters
    const validationResults = [];
    const categoryCounts = {};
    const invalidAssignments = [];
    
    // Initialize category counts
    VALID_CATEGORIES.forEach(cat => {
      categoryCounts[cat] = 0;
    });
    categoryCounts["INVALID/MISSING"] = 0;

    // Get total product count for progress tracking
    const totalProducts = await Product.countDocuments();
    console.log(`Found ${totalProducts} products to validate`);

    // Process products in batches to handle large datasets
    const batchSize = 100;
    let processedCount = 0;

    // Process all products
    for (let skip = 0; skip < totalProducts; skip += batchSize) {
      const products = await Product.find({})
        .populate('categories')
        .skip(skip)
        .limit(batchSize);

      for (const product of products) {
        processedCount++;
        
        // Get the primary category name (first category in array)
        let assignedCategoryName = "";
        let validationStatus = "INVALID";
        
        if (product.categories && product.categories.length > 0) {
          // Use the first category as the assigned category
          assignedCategoryName = product.categories[0].name;
        }

        // Validate the category
        if (isValidCategory(assignedCategoryName)) {
          validationStatus = "VALID";
          categoryCounts[assignedCategoryName]++;
        } else {
          categoryCounts["INVALID/MISSING"]++;
          invalidAssignments.push({
            product_id: product._id.toString(),
            product_name: product.name,
            assigned_category: assignedCategoryName || "MISSING"
          });
        }

        // Add to validation results
        validationResults.push({
          product_id: product._id.toString(),
          product_name: product.name,
          assigned_category: assignedCategoryName || "MISSING",
          validation_status: validationStatus
        });

        // Show progress
        if (processedCount % 50 === 0 || processedCount === totalProducts) {
          console.log(`Processed ${processedCount}/${totalProducts} products...`);
        }
      }
    }

    // Generate and display report
    console.log("\n=== PRODUCT CATEGORY VALIDATION REPORT ===\n");
    
    console.log("Individual Product Validation Results:");
    console.log(JSON.stringify(validationResults, null, 2));
    
    console.log("\nCategory Distribution:");
    for (const [category, count] of Object.entries(categoryCounts)) {
      console.log(`  ${category}: ${count}`);
    }
    
    console.log("\nInvalid/Missing Category Assignments:");
    if (invalidAssignments.length === 0) {
      console.log("  None found - all products have valid category assignments!");
    } else {
      invalidAssignments.forEach((item, index) => {
        console.log(`  ${index + 1}. ${item.product_name} (ID: ${item.product_id}) - Assigned: ${item.assigned_category}`);
      });
    }
    
    // Summary statistics
    const validCount = validationResults.filter(result => result.validation_status === "VALID").length;
    const invalidCount = validationResults.filter(result => result.validation_status === "INVALID").length;
    
    console.log("\nSummary:");
    console.log(`  Total Products Validated: ${validationResults.length}`);
    console.log(`  Valid Assignments: ${validCount}`);
    console.log(`  Invalid Assignments: ${invalidCount}`);
    console.log(`  Validation Success Rate: ${((validCount / validationResults.length) * 100).toFixed(2)}%`);

    // Save results to files
    await saveResultsToFile(validationResults, categoryCounts, invalidAssignments);
    
    console.log("\nValidation complete. Results saved to files.");
    
  } catch (error) {
    console.error("Error during validation:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("Disconnected from MongoDB");
  }
}

/**
 * Save validation results to files
 * @param {Array} validationResults - Individual product validation results
 * @param {Object} categoryCounts - Category distribution counts
 * @param {Array} invalidAssignments - List of invalid assignments
 */
async function saveResultsToFile(validationResults, categoryCounts, invalidAssignments) {
  const fs = (await import("fs")).default;
  const path = (await import("path")).default;
  
  // Create reports directory if it doesn't exist
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  // Save individual validation results
  const validationResultsPath = path.join(reportsDir, "product-category-validation-results.json");
  fs.writeFileSync(
    validationResultsPath,
    JSON.stringify(validationResults, null, 2)
  );
  
  // Save category counts
  const categoryCountsPath = path.join(reportsDir, "category-distribution.json");
  fs.writeFileSync(
    categoryCountsPath,
    JSON.stringify(categoryCounts, null, 2)
  );
  
  // Save invalid assignments
  const invalidAssignmentsPath = path.join(reportsDir, "invalid-category-assignments.json");
  fs.writeFileSync(
    invalidAssignmentsPath,
    JSON.stringify(invalidAssignments, null, 2)
  );
  
  // Save summary report
  const summaryReportPath = path.join(reportsDir, "validation-summary.txt");
  const validCount = validationResults.filter(result => result.validation_status === "VALID").length;
  const invalidCount = validationResults.filter(result => result.validation_status === "INVALID").length;
  const summaryContent = `
PRODUCT CATEGORY VALIDATION SUMMARY REPORT
=========================================

Total Products Validated: ${validationResults.length}
Valid Assignments: ${validCount}
Invalid Assignments: ${invalidCount}
Validation Success Rate: ${((validCount / validationResults.length) * 100).toFixed(2)}%

Category Distribution:
${Object.entries(categoryCounts).map(([category, count]) => `  ${category}: ${count}`).join('\n')}

Invalid/Missing Category Assignments:
${invalidAssignments.length === 0 ? 'None found - all products have valid category assignments!' : 
  invalidAssignments.map((item, index) => 
    `  ${index + 1}. ${item.product_name} (ID: ${item.product_id}) - Assigned: ${item.assigned_category}`
  ).join('\n')}
  `.trim();
  
  fs.writeFileSync(summaryReportPath, summaryContent);
  
  console.log(`Reports saved to ${reportsDir}/`);
}

// Run the validation
validateProductCategories();

export default validateProductCategories;