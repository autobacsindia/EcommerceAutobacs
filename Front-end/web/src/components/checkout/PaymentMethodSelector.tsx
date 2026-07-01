import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { CreditCard } from 'lucide-react';

interface PaymentMethodSelectorProps {
  selectedMethod: string;
  onSelect: (method: string) => void;
}

export default function PaymentMethodSelector({ selectedMethod, onSelect }: PaymentMethodSelectorProps) {
  const methods = [
    {
      value: PAYMENT_METHODS.RAZORPAY,
      label: PAYMENT_METHOD_LABELS[PAYMENT_METHODS.RAZORPAY],
      icon: CreditCard,
      description: 'Pay securely with Credit/Debit Card, UPI, or Netbanking'
    }
  ];

  return (
    <div className="space-y-4">
      {methods.map((method) => {
        const Icon = method.icon;
        const isSelected = selectedMethod === method.value;

        return (
          <label
            key={method.value}
            className={`flex items-start gap-4 border rounded-lg p-4 cursor-pointer transition-all ${
              isSelected ? 'border-gold bg-blue-50 ring-1 ring-gold' : 'border-hairline hover:bg-obsidian-deep'
            }`}
          >
            <input
              type="radio"
              name="payment"
              value={method.value}
              checked={isSelected}
              onChange={() => onSelect(method.value)}
              className="mt-1 w-4 h-4 text-gold border-hairline focus:ring-gold"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`h-5 w-5 ${isSelected ? 'text-gold' : 'text-ink-muted'}`} />
                <span className={`font-medium ${isSelected ? 'text-blue-900' : 'text-ink'}`}>
                  {method.label}
                </span>
              </div>
              <p className={`text-sm ${isSelected ? 'text-gold' : 'text-ink-muted'}`}>
                {method.description}
              </p>
            </div>
          </label>
        );
      })}
    </div>
  );
}
