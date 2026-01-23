import React from 'react';
import { ShieldCheck, Truck, RotateCcw, CreditCard } from 'lucide-react';

export default function TrustBadges() {
  return (
    <div className="grid grid-cols-2 gap-4 py-6 border-t border-gray-100 mt-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-50 rounded-full text-blue-600">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">Secure Payment</p>
          <p className="text-xs text-gray-500">100% Protected</p>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="p-2 bg-green-50 rounded-full text-green-600">
          <Truck className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">Fast Shipping</p>
          <p className="text-xs text-gray-500">Pan India Delivery</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-50 rounded-full text-orange-600">
          <RotateCcw className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">Easy Returns</p>
          <p className="text-xs text-gray-500">7 Days Policy</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-50 rounded-full text-purple-600">
          <CreditCard className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">EMI Available</p>
          <p className="text-xs text-gray-500">On Select Cards</p>
        </div>
      </div>
    </div>
  );
}
