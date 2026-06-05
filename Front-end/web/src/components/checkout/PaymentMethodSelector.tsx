import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { CreditCard, Truck } from 'lucide-react';

interface PaymentMethodSelectorProps {
  selectedMethod: string;
  onSelect: (method: string) => void;
}

const METHODS = [
  {
    value: PAYMENT_METHODS.RAZORPAY,
    label: PAYMENT_METHOD_LABELS[PAYMENT_METHODS.RAZORPAY],
    icon: CreditCard,
    description: 'Pay securely with Credit/Debit Card, UPI, or Netbanking',
  },
  {
    value: PAYMENT_METHODS.COD,
    label: PAYMENT_METHOD_LABELS[PAYMENT_METHODS.COD],
    icon: Truck,
    description: 'Pay with cash when your order is delivered',
  },
];

export default function PaymentMethodSelector({ selectedMethod, onSelect }: PaymentMethodSelectorProps) {
  return (
    <div className="space-y-3">
      {METHODS.map((method) => {
        const Icon = method.icon;
        const isSelected = selectedMethod === method.value;

        return (
          <label
            key={method.value}
            className={`flex items-start gap-4 border rounded-sm p-4 cursor-pointer transition-colors ${
              isSelected
                ? 'border-[#3B9EE8] bg-[#3B9EE8]/5'
                : 'border-[#252525] bg-[#0E0E0E] hover:border-[#3B9EE8]/40'
            }`}
          >
            <input
              type="radio"
              name="payment"
              value={method.value}
              checked={isSelected}
              onChange={() => onSelect(method.value)}
              className="mt-1 w-4 h-4 accent-[#3B9EE8]"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`h-5 w-5 ${isSelected ? 'text-[#3B9EE8]' : 'text-[#555555]'}`} />
                <span className={`font-condensed font-bold uppercase tracking-wide text-sm ${isSelected ? 'text-white' : 'text-[#C4C4C4]'}`}>
                  {method.label}
                </span>
              </div>
              <p className={`text-xs font-body ${isSelected ? 'text-[#C4C4C4]' : 'text-[#555555]'}`}>
                {method.description}
              </p>
            </div>
          </label>
        );
      })}
    </div>
  );
}
