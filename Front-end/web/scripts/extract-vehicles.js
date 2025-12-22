// Extract actual vehicle mentions from product data
const axios = require('axios');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

async function extractVehicleMentions() {
  console.log('=== Extracting Actual Vehicle Mentions ===\n');
  
  const siteUrl = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL;
  const consumerKey = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY;
  const consumerSecret = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET;
  const apiVersion = process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || 'wc/v3';
  
  if (!siteUrl || !consumerKey || !consumerSecret) {
    console.log('❌ Missing required configuration');
    return;
  }
  
  try {
    // Get a larger sample of products
    console.log('--- Getting Product Sample ---');
    const productsEndpoint = `${siteUrl}/wp-json/${apiVersion}/products`;
    const productsResponse = await axios.get(productsEndpoint, {
      auth: {
        username: consumerKey,
        password: consumerSecret
      },
      params: {
        per_page: 100  // Get more products to analyze
      },
      timeout: 30000
    });
    
    const products = Array.isArray(productsResponse.data) ? productsResponse.data : [];
    console.log('Retrieved', products.length, 'products');
    
    // Extract all text from products to find vehicle mentions
    console.log('\n--- Extracting Text for Analysis ---');
    let allText = '';
    
    products.forEach(product => {
      // Product name
      allText += ' ' + (product.name || '');
      
      // Tags
      if (product.tags && Array.isArray(product.tags)) {
        product.tags.forEach(tag => {
          allText += ' ' + (tag.name || '');
        });
      }
      
      // Categories
      if (product.categories && Array.isArray(product.categories)) {
        product.categories.forEach(cat => {
          allText += ' ' + (cat.name || '');
        });
      }
    });
    
    // Extract potential vehicle makes/models
    console.log('\n--- Extracting Vehicle Mentions ---');
    const vehiclePattern = /\b(?:[A-Z][a-z]+[-\s]?[A-Z0-9]+|[A-Z]{1,2}[0-9]{1,3}[a-z]*)\b/g;
    const matches = allText.match(vehiclePattern) || [];
    
    // Filter for plausible vehicle names (at least 2 characters, not common words)
    const commonWords = new Set(['for', 'and', 'the', 'new', 'plus', 'led', 'drl', 'abs', 'kit', 'style', 'with', 'to', 'in', 'of', 'on', 'up', 'by']);
    const vehicleCandidates = matches.filter(match => 
      match.length >= 2 && 
      !commonWords.has(match.toLowerCase()) &&
      !/^[0-9]+$/.test(match) // Not just numbers
    );
    
    // Count occurrences
    const vehicleCounts = {};
    vehicleCandidates.forEach(vehicle => {
      const key = vehicle.toLowerCase();
      vehicleCounts[key] = (vehicleCounts[key] || 0) + 1;
    });
    
    // Sort by frequency
    const sortedVehicles = Object.entries(vehicleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30); // Top 30
    
    console.log('Top vehicle mentions found in product data:');
    sortedVehicles.forEach(([vehicle, count]) => {
      console.log(`- ${vehicle} (${count} occurrences)`);
    });
    
    // Look for specific known vehicle patterns
    console.log('\n--- Known Vehicle Patterns ---');
    const knownPatterns = [
      /bmw\s+[a-z0-9]+/gi,
      /thar\s+[a-z0-9]+/gi,
      /audi\s+[a-z0-9]+/gi,
      /toyota\s+[a-z0-9]+/gi,
      /mahindra\s+[a-z0-9]+/gi,
      /[a-z0-9]+\s+series/gi
    ];
    
    knownPatterns.forEach(pattern => {
      const patternMatches = allText.match(pattern);
      if (patternMatches && patternMatches.length > 0) {
        console.log(`Pattern "${pattern.toString()}":`);
        const uniqueMatches = [...new Set(patternMatches.map(m => m.toLowerCase()))];
        uniqueMatches.forEach(match => {
          console.log(`  - ${match}`);
        });
      }
    });
    
    console.log('\n🎉 Vehicle extraction completed!');
    
  } catch (error) {
    console.log('\n❌ Vehicle Extraction Failed');
    console.log('Error:', error.message);
    
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Status Text:', error.response.statusText);
      if (error.response.data) {
        console.log('Response Data:', JSON.stringify(error.response.data, null, 2));
      }
    }
  }
}

extractVehicleMentions();