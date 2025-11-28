import React from 'react';
// Example of how to use the Reviews component in a product page
import Reviews from './Reviews';

// This is just an example component showing how the Reviews component would be used
const ProductPageExample: React.FC = () => {
  // In a real app, this would come from authentication context or props
  const isAuthenticated = true;
  
  // In a real app, this would come from the product data
  const productId = "example-product-id-123";

  return (
    <div>
      <h1>Product Name</h1>
      <p>Product description...</p>
      
      {/* Other product details */}
      
      {/* Reviews Section */}
      <Reviews 
        productId={productId} 
        isAuthenticated={isAuthenticated} 
      />
    </div>
  );
};

export default ProductPageExample;