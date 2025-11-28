'use client';

import React from 'react';
import Link from 'next/link';

const DemoHomePage: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Component Demos</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link href="/demo/reviews" className="block">
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <h2 className="text-xl font-semibold mb-2">Product Reviews</h2>
            <p className="text-gray-600">Demo of the complete product reviews system</p>
            <div className="mt-4 text-blue-600 font-medium">View Demo →</div>
          </div>
        </Link>
        
        {/* Placeholder for other demos */}
        <div className="bg-gray-100 rounded-lg shadow-md p-6 opacity-50">
          <h2 className="text-xl font-semibold mb-2">More Demos Coming Soon</h2>
          <p className="text-gray-500">Additional component demos will be added here</p>
        </div>
      </div>
    </div>
  );
};

export default DemoHomePage;