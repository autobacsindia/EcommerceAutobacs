import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "./models/Product.js";
import Category from "./models/Category.js";
import { categoryMap, normalizeCategory } from "./category-mapping.js";

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
 * Validate if a category is in the valid categories list
 * @param {string} categoryName - The category name to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidCategory(categoryName) {
  if (!categoryName) return false;
  const normalizedName = categoryName.trim();
  return VALID_CATEGORIES.includes(normalizedName);
}

/**
 * Validate product category assignments with mapping
 */
async function validateProductCategoriesWithMapping() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Initialize results and counters
    const validationResults = [];
    const categoryCounts = {};
    const invalidAssignments = [];
    const mappingApplied = [];
    
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
        let mappedCategory = null;
        
        if (product.categories && product.categories.length > 0) {
          // Use the first category as the assigned category
          assignedCategoryName = product.categories[0].name;
          
          // Try to map the category
          mappedCategory = normalizeCategory(assignedCategoryName);
        }

        // Validate the category
        if (mappedCategory && isValidCategory(mappedCategory)) {
          validationStatus = "VALID";
          categoryCounts[mappedCategory]++;
          
          // Track mapping applied
          if (mappedCategory !== assignedCategoryName) {
            mappingApplied.push({
              product_id: product._id.toString(),
              product_name: product.name,
              original_category: assignedCategoryName,
              mapped_category: mappedCategory
            });
          }
        } else if (isValidCategory(assignedCategoryName)) {
          // Already valid category
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

        // Add to validation results (show mapped category if applicable)
        const displayCategory = mappedCategory || assignedCategoryName || "MISSING";
        validationResults.push({
          product_id: product._id.toString(),
          product_name: product.name,
          assigned_category: displayCategory,
          validation_status: validationStatus
        });

        // Show progress
        if (processedCount % 50 === 0 || processedCount === totalProducts) {
          console.log(`Processed ${processedCount}/${totalProducts} products...`);
        }
      }
    }

    // Generate and display report
    console.log("\n=== PRODUCT CATEGORY VALIDATION REPORT (WITH MAPPING) ===\n");
    
    console.log("Category Distribution:");
    for (const [category, count] of Object.entries(categoryCounts)) {
      console.log(`  ${category}: ${count}`);
    }
    
    console.log(`\nTotal Products Validated: ${validationResults.length}`);
    const validCount = validationResults.filter(result => result.validation_status === "VALID").length;
    const invalidCount = validationResults.filter(result => result.validation_status === "INVALID").length;
    console.log(`Valid Assignments: ${validCount}`);
    console.log(`Invalid Assignments: ${invalidCount}`);
    console.log(`Validation Success Rate: ${((validCount / validationResults.length) * 100).toFixed(2)}%`);
    
    if (mappingApplied.length > 0) {
      console.log(`\nMappings Applied: ${mappingApplied.length}`);
      console.log("Sample of mappings applied:");
      mappingApplied.slice(0, 10).forEach((mapping, index) => {
        console.log(`  ${index + 1}. "${mapping.original_category}" → "${mapping.mapped_category}" (${mapping.product_name})`);
      });
      if (mappingApplied.length > 10) {
        console.log(`  ... and ${mappingApplied.length - 10} more mappings`);
      }
    }
    
    console.log("\nInvalid/Missing Category Assignments (Top 10):");
    if (invalidAssignments.length === 0) {
      console.log("  None found - all products have valid category assignments!");
    } else {
      invalidAssignments.slice(0, 10).forEach((item, index) => {
        console.log(`  ${index + 1}. ${item.product_name} (ID: ${item.product_id}) - Assigned: ${item.assigned_category}`);
      });
      if (invalidAssignments.length > 10) {
        console.log(`  ... and ${invalidAssignments.length - 10} more invalid assignments`);
      }
    }
    
    // Save results to files
    await saveResultsToFile(validationResults, categoryCounts, invalidAssignments, mappingApplied);
    
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
 * @param {Array} mappingApplied - List of mappings applied
 */
async function saveResultsToFile(validationResults, categoryCounts, invalidAssignments, mappingApplied) {
  const fs = (await import("fs")).default;
  const path = (await import("path")).default;
  
  // Create reports directory if it doesn't exist
  const reportsDir = path.join(process.cwd(), "reports-mapping");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  // Save individual validation results
  const validationResultsPath = path.join(reportsDir, "product-category-validation-results-with-mapping.json");
  fs.writeFileSync(
    validationResultsPath,
    JSON.stringify(validationResults, null, 2)
  );
  
  // Save category counts
  const categoryCountsPath = path.join(reportsDir, "category-distribution-with-mapping.json");
  fs.writeFileSync(
    categoryCountsPath,
    JSON.stringify(categoryCounts, null, 2)
  );
  
  // Save invalid assignments
  const invalidAssignmentsPath = path.join(reportsDir, "invalid-category-assignments-with-mapping.json");
  fs.writeFileSync(
    invalidAssignmentsPath,
    JSON.stringify(invalidAssignments, null, 2)
  );
  
  // Save mapping applied
  const mappingAppliedPath = path.join(reportsDir, "category-mappings-applied.json");
  fs.writeFileSync(
    mappingAppliedPath,
    JSON.stringify(mappingApplied, null, 2)
  );
  
  // Save summary report
  const summaryReportPath = path.join(reportsDir, "validation-summary-with-mapping.txt");
  const validCount = validationResults.filter(result => result.validation_status === "VALID").length;
  const invalidCount = validationResults.filter(result => result.validation_status === "INVALID").length;
  const summaryContent = `
PRODUCT CATEGORY VALIDATION SUMMARY REPORT (WITH MAPPING)
=====================================================

Total Products Validated: ${validationResults.length}
Valid Assignments: ${validCount}
Invalid Assignments: ${invalidCount}
Validation Success Rate: ${((validCount / validationResults.length) * 100).toFixed(2)}%

Category Distribution:
${Object.entries(categoryCounts).map(([category, count]) => `  ${category}: ${count}`).join('\n')}

Mappings Applied: ${mappingApplied.length}
${mappingApplied.slice(0, 20).map((mapping, index) => 
  `  ${index + 1}. "${mapping.original_category}" → "${mapping.mapped_category}" (${mapping.product_name})`
).join('\n')}
${mappingApplied.length > 20 ? `  ... and ${mappingApplied.length - 20} more mappings` : ''}

Invalid/Missing Category Assignments:
${invalidAssignments.length === 0 ? 'None found - all products have valid category assignments!' : 
  invalidAssignments.slice(0, 50).map((item, index) => 
    `  ${index + 1}. ${item.product_name} (ID: ${item.product_id}) - Assigned: ${item.assigned_category}`
  ).join('\n')}
${invalidAssignments.length > 50 ? `  ... and ${invalidAssignments.length - 50} more invalid assignments` : ''}
  `.trim();
  
  fs.writeFileSync(summaryReportPath, summaryContent);
  
  console.log(`Reports saved to ${reportsDir}/`);
}

// Run the validation
validateProductCategoriesWithMapping();

export default validateProductCategoriesWithMapping;