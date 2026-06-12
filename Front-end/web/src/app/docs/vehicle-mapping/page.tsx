'use client';

export default function VehicleMappingDocumentation() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-linear-to-r from-blue-600 to-blue-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold mb-4">Vehicle-to-Product Mapping Documentation</h1>
          <p className="text-blue-100 text-lg">
            Technical documentation for the vehicle-to-product mapping system
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Overview</h2>
          <p className="text-gray-700 mb-4">
            The vehicle-to-product mapping system connects automotive products with specific vehicle models 
            using WordPress custom taxonomies and the WooCommerce REST API. This enables customers to easily 
            find parts and accessories that are compatible with their specific vehicle.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg shadow-md p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Architecture</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">WordPress Backend</h3>
                <ul className="list-disc pl-5 space-y-2 text-gray-700">
                  <li>Custom taxonomy "vehicle" for categorizing products</li>
                  <li>WooCommerce products tagged with vehicle terms</li>
                  <li>Standard product categories (Exterior, Interior, Performance, Accessories)</li>
                  <li>REST API endpoints for data access</li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Frontend Integration</h3>
                <ul className="list-disc pl-5 space-y-2 text-gray-700">
                  <li>Next.js React application</li>
                  <li>TypeScript type definitions for API responses</li>
                  <li>Axios for API requests with authentication</li>
                  <li>Error handling and loading states</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">API Endpoints</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Vehicle Taxonomy</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <code className="text-sm">GET /wp-json/wp/v2/vehicle</code>
                  <p className="text-gray-600 text-sm mt-2">
                    Retrieves all vehicle terms with product counts
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Product Filtering</h3>
                <div className="bg-gray-50 p-4 rounded-lg mb-3">
                  <code className="text-sm">GET /wp-json/wc/v3/products?vehicle=&#123;slug&#125;</code>
                  <p className="text-gray-600 text-sm mt-2">
                    Retrieves products for a specific vehicle
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <code className="text-sm">GET /wp-json/wc/v3/products?vehicle=&#123;slug&#125;&category=&#123;slug&#125;</code>
                  <p className="text-gray-600 text-sm mt-2">
                    Retrieves filtered products for a specific vehicle and category
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Implementation Details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Data Flow</h3>
              <ol className="list-decimal pl-5 space-y-3 text-gray-700">
                <li>User visits vehicle listing page</li>
                <li>Application fetches vehicle terms from WordPress API</li>
                <li>User selects a vehicle</li>
                <li>Application fetches products tagged with that vehicle term</li>
                <li>Products are displayed with filtering options</li>
              </ol>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Components</h3>
              <ul className="list-disc pl-5 space-y-3 text-gray-700">
                <li><code>wordpressService.ts</code> - API communication layer</li>
                <li><code>VehicleProducts.tsx</code> - Product display component</li>
                <li>TypeScript interfaces for data validation</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Setup Requirements</h2>
          
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">WordPress Configuration</h3>
              <ul className="list-disc pl-5 space-y-2 text-gray-700">
                <li>Install Custom Post Type UI plugin</li>
                <li>Create "vehicle" custom taxonomy</li>
                <li>Enable REST API exposure for taxonomy</li>
                <li>Generate WooCommerce REST API keys with read permissions</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Frontend Configuration</h3>
              <ul className="list-disc pl-5 space-y-2 text-gray-700">
                <li>Set environment variables in <code>.env.local</code></li>
                <li>Configure WordPress site URL and API credentials</li>
                <li>Ensure CORS settings allow frontend requests</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Product Organization</h3>
              <ul className="list-disc pl-5 space-y-2 text-gray-700">
                <li>Tag products with appropriate vehicle terms</li>
                <li>Organize products into standard categories</li>
                <li>Use descriptive product names and images</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}