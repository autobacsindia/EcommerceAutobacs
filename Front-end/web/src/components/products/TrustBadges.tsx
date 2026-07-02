import React from 'react';
import { ShieldCheck, Truck, RotateCcw, CreditCard } from 'lucide-react';

export default function TrustBadges() {
  return (
    <div className="grid grid-cols-2 gap-4 py-6 border-t border-hairline mt-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gold/10 rounded-full text-gold">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Secure Payment</p>
          <p className="text-xs text-ink-muted">100% Protected</p>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="p-2 bg-green-50 rounded-full text-green-600">
          <Truck className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Fast Shipping</p>
          <p className="text-xs text-ink-muted">Pan India Delivery</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-50 rounded-full text-orange-600">
          <RotateCcw className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Easy Returns</p>
          <p className="text-xs text-ink-muted">7 Days Policy</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="p-2 bg-gold/10 rounded-full text-gold">
          <CreditCard className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">EMI Available</p>
          <p className="text-xs text-ink-muted">On Select Cards</p>
        </div>
      </div>
    </div>
  );
}
