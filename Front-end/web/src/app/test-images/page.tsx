'use client';

import ProductImage from '@/components/products/ProductImage';

export default function TestImagesPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Image Component Test</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Valid image */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">Valid Image</h2>
            <div className="h-64">
              <ProductImage 
                src="https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400" 
                alt="Valid image test" 
                className="object-cover w-full h-full rounded"
              />
            </div>
            <p className="mt-2 text-sm text-gray-600">This should show a real image</p>
          </div>
          
          {/* Placeholder image */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">Placeholder Image</h2>
            <div className="h-64">
              <ProductImage 
                src="https://example.com/sample-product.jpg" 
                alt="Placeholder image test" 
                className="object-cover w-full h-full rounded"
              />
            </div>
            <p className="mt-2 text-sm text-gray-600">This should show a placeholder with "Sample Product" label</p>
          </div>
          
          {/* Invalid image */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">Invalid Image</h2>
            <div className="h-64">
              <ProductImage 
                src="" 
                alt="Invalid image test" 
                className="object-cover w-full h-full rounded"
              />
            </div>
            <p className="mt-2 text-sm text-gray-600">This should show "No image available"</p>
          </div>
        </div>
        
        <div className="mt-12 bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Explanation</h2>
          <div className="prose max-w-none">
            <p>Our ProductImage component handles three types of image scenarios:</p>
            <ol className="list-decimal pl-5 space-y-2">
              <li><strong>Valid Images</strong>: Regular images from real URLs are displayed normally</li>
              <li><strong>Placeholder Images</strong>: URLs containing "example.com" show a special placeholder with a "Sample Product" label</li>
              <li><strong>Invalid Images</strong>: Empty or malformed URLs show a "No image available" message</li>
            </ol>
            <p className="mt-4">This approach ensures that users understand when they're seeing sample data versus real product images.</p>
          </div>
        </div>
      </div>
    </div>
  );
}