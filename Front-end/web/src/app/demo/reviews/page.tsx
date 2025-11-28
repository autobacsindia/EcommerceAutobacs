'use client';

import React from 'react';
import { Reviews } from '../../../components/reviews';

const ReviewsDemoPage: React.FC = () => {
  // Mock product ID for demonstration
  const productId = "demo-product-123";
  
  // For demo purposes, we'll simulate an authenticated user
  const isAuthenticated = true;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Product Reviews Demo</h1>
      
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 className="text-2xl font-semibold mb-4">Demo Product</h2>
        <p className="text-gray-600 mb-4">This is a demonstration of the reviews component system.</p>
        <div className="flex items-center">
          <div className="bg-gray-200 border-2 border-dashed rounded-xl w-16 h-16 mr-4" />
          <div>
            <h3 className="font-medium">Sample Product</h3>
            <p className="text-gray-500">$99.99</p>
          </div>
        </div>
      </div>
      
      {/* Reviews Component */}
      <Reviews 
        productId={productId} 
        isAuthenticated={isAuthenticated} 
      />
      
      <div className="mt-8 p-4 bg-blue-50 rounded-lg">
        <h3 className="font-semibold text-blue-800 mb-2">Component Demo Information</h3>
        <p className="text-blue-700">
          This page demonstrates the reviews components we've created. The components include:
        </p>
        <ul className="list-disc pl-5 mt-2 text-blue-700">
          <li>Star Rating Visualization</li>
          <li>Review Summary Display</li>
          <li>Review Submission Form</li>
          <li>Individual Review Items</li>
          <li>Review List with Sorting</li>
        </ul>
      </div>
    </div>
  );
};

export default ReviewsDemoPage;