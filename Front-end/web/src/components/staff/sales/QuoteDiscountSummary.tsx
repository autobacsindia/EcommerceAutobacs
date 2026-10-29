import { formatDateTimeIST } from '@/lib/datetime';
import { percentText, rupees, type QuoteDiscount } from './types';

/**
 * Subtotal → discount → total, as the SERVER computed them, with who gave the
 * discount and why (staff-only; the customer's PDF shows just "Discount (5%)").
 * Without a discount it is a single Total row.
 */
export default function QuoteDiscountSummary({
  subtotal,
  discount,
  total,
  totalLabel = 'Total',
}: {
  subtotal: number;
  discount: QuoteDiscount | null | undefined;
  total: number;
  totalLabel?: string;
}) {
  return (
    <div className="space-y-1.5 text-sm">
      {discount && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Subtotal</span>
            <span className="text-gray-900">{rupees(subtotal)}</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-green-700">Discount {percentText(discount.percent)}</p>
              <p className="text-xs text-gray-500" data-testid="discount-giver">
                {discount.byName ? `Given by ${discount.byName}` : 'Given'}
                {discount.at ? ` · ${formatDateTimeIST(discount.at)}` : ''}
              </p>
              {discount.reason && <p className="break-words text-xs text-gray-600">Reason: {discount.reason}</p>}
            </div>
            <span className="shrink-0 font-medium text-green-700">−{rupees(discount.amount)}</span>
          </div>
        </>
      )}
      <div className={`flex items-center justify-between ${discount ? 'border-t border-gray-200 pt-2' : ''}`}>
        <span className="text-gray-500">{totalLabel}</span>
        <span className="text-xl font-bold text-gray-900">{rupees(total)}</span>
      </div>
    </div>
  );
}
