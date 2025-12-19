const fs = require('fs');

// Read the invalid category assignments
const rawData = fs.readFileSync('./reports/invalid-category-assignments.json', 'utf8');
const invalidAssignments = JSON.parse(rawData);

// Get unique category names
const categories = [...new Set(invalidAssignments.map(item => item.assigned_category))];

console.log('Unique invalid categories:');
categories.forEach((cat, i) => console.log(`${i+1}. ${cat}`));

// Count occurrences of each category
const categoryCounts = {};
invalidAssignments.forEach(item => {
  const cat = item.assigned_category;
  categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
});

console.log('\nCategory counts (top 20):');
Object.entries(categoryCounts)
  .sort(([,a], [,b]) => b - a) // Sort by count descending
  .slice(0, 20)
  .forEach(([category, count]) => console.log(`${category}: ${count}`));