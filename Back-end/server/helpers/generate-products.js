/**
 * Generate sample automotive accessory products for Autobacs
 * @returns {Array} Array of product objects
 */
export function generateProducts() {
  const categories = [
    "Exterior Accessories",
    "Interior Accessories",
    "Performance Parts",
    "Lighting",
    "Wheels & Tires",
    "Audio & Electronics",
    "Safety Equipment",
    "Maintenance & Care"
  ];

  const brands = [
    "Autobacs",
    "Profender",
    "Sparco",
    "Brembo",
    "Bosch",
    "Castrol",
    "Michelin",
    "Bridgestone",
    "3M",
    "Meguiar's"
  ];

  const products = [];
  
  // Generate 100 sample products
  for (let i = 1; i <= 100; i++) {
    const category = categories[Math.floor(Math.random() * categories.length)];
    const brand = brands[Math.floor(Math.random() * brands.length)];
    
    products.push({
      name: `${brand} ${getProductNameSuffix(i)}`,
      description: `High-quality ${category.toLowerCase()} designed for optimal performance and durability. This product offers excellent value and reliability for your vehicle.`,
      shortDescription: `Premium ${category} from ${brand}`,
      price: Math.floor(Math.random() * 5000) + 500,
      originalPrice: Math.floor(Math.random() * 3000) + 5000,
      category: getCategoryObjectId(category),
      brand: brand,
      images: [
        {
          url: `https://picsum.photos/seed/product${i}/600/400`,
          alt: `${brand} ${getProductNameSuffix(i)} - View 1`,
          isPrimary: true
        },
        {
          url: `https://picsum.photos/seed/product${i}alt/600/400`,
          alt: `${brand} ${getProductNameSuffix(i)} - View 2`,
          isPrimary: false
        }
      ],
      stock: Math.floor(Math.random() * 50) + 5,
      sku: `SKU-${brand.substring(0, 3).toUpperCase()}${i.toString().padStart(4, '0')}`,
      specifications: [
        { key: "Material", value: getRandomMaterial() },
        { key: "Color", value: getRandomColor() },
        { key: "Weight", value: `${(Math.random() * 5).toFixed(2)} kg` },
        { key: "Warranty", value: `${Math.floor(Math.random() * 3) + 1} Year` }
      ],
      features: [
        "High Quality Material",
        "Easy Installation",
        "Durable Construction",
        "Designed for Performance"
      ],
      isActive: true,
      isFeatured: Math.random() > 0.8,
      tags: [category.split(' ')[0].toLowerCase(), brand.toLowerCase(), "automotive"]
    });
  }
  
  return products;
}

function getProductNameSuffix(index) {
  const suffixes = [
    "Performance Kit",
    "Protection System",
    "Enhancement Module",
    "Upgrade Package",
    "Pro Series",
    "Deluxe Edition",
    "Ultimate Version",
    "Standard Model",
    "Advanced Kit",
    "Basic Set"
  ];
  return suffixes[index % suffixes.length];
}

function getCategoryObjectId(categoryName) {
  // In a real implementation, these would be actual ObjectIDs from your categories
  const categoryIds = {
    "Exterior Accessories": "5f8d0d5dc0d9b10017f5a9a1",
    "Interior Accessories": "5f8d0d5dc0d9b10017f5a9a2",
    "Performance Parts": "5f8d0d5dc0d9b10017f5a9a3",
    "Lighting": "5f8d0d5dc0d9b10017f5a9a4",
    "Wheels & Tires": "5f8d0d5dc0d9b10017f5a9a5",
    "Audio & Electronics": "5f8d0d5dc0d9b10017f5a9a6",
    "Safety Equipment": "5f8d0d5dc0d9b10017f5a9a7",
    "Maintenance & Care": "5f8d0d5dc0d9b10017f5a9a8"
  };
  return categoryIds[categoryName] || categoryIds["Exterior Accessories"];
}

function getRandomMaterial() {
  const materials = [
    "Aluminum Alloy",
    "Carbon Fiber",
    "High-Grade Plastic",
    "Stainless Steel",
    "Rubber Composite",
    "Leather",
    "Fabric",
    "Ceramic Coating"
  ];
  return materials[Math.floor(Math.random() * materials.length)];
}

function getRandomColor() {
  const colors = [
    "Black",
    "Silver",
    "Red",
    "Blue",
    "White",
    "Gray",
    "Carbon Black",
    "Titanium Silver",
    "Matte Black",
    "Gunmetal Gray"
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export default generateProducts;