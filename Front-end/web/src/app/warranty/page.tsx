import React from 'react';

export default function WarrantyPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Warranty Information</h1>
      <div className="prose max-w-none">
        <p>
          At Autobacs, we stand behind the quality of our products. All products come with a standard manufacturer warranty.
        </p>
        <p className="mt-4">
          For specific warranty details regarding your purchase, please refer to the documentation included with your product or contact our support team.
        </p>
      </div>
    </div>
  );
}
