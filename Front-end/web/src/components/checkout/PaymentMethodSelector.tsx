import { CalendarClock, CreditCard } from 'lucide-react';
import { PAYMENT_CHOICES, PAYMENT_CHOICE_LABELS } from '@/lib/paymentChoices';

interface PaymentMethodSelectorProps {
  /** A PaymentChoice value (see lib/paymentChoices). */
  selectedMethod: string;
  onSelect: (method: string) => void;
}

/**
 * The checkout payment step. Both choices pay through Razorpay; EMI simply opens the
 * Razorpay window on its EMI section. It exists as a separate, visible choice because a
 * single "Card/UPI/Wallet" option hid the fact that EMI was available at all.
 *
 * No rates or bank names are hardcoded: the banks, tenures, minimum amounts and interest
 * are configured on the Razorpay account and change over time, so the copy points to the
 * next step where Razorpay shows the live terms.
 */
export default function PaymentMethodSelector({ selectedMethod, onSelect }: PaymentMethodSelectorProps) {
  const methods = [
    {
      value: PAYMENT_CHOICES.RAZORPAY,
      label: PAYMENT_CHOICE_LABELS[PAYMENT_CHOICES.RAZORPAY],
      icon: CreditCard,
      description: 'Pay in full with a credit or debit card, UPI, netbanking or a wallet.',
    },
    {
      value: PAYMENT_CHOICES.RAZORPAY_EMI,
      label: PAYMENT_CHOICE_LABELS[PAYMENT_CHOICES.RAZORPAY_EMI],
      icon: CalendarClock,
      description:
        'Split the amount into monthly instalments on your credit or debit card. Available banks, ' +
        'tenures and interest are shown in the next step — the interest is charged by your bank.',
    },
  ];

  return (
    <div className="space-y-4" role="radiogroup" aria-label="Payment method">
      {methods.map((method) => {
        const Icon = method.icon;
        const isSelected = selectedMethod === method.value;

        return (
          <label
            key={method.value}
            className={`flex items-start gap-4 border rounded-lg p-4 cursor-pointer transition-all ${
              isSelected ? 'border-gold bg-gold/10 ring-1 ring-gold' : 'border-hairline hover:bg-obsidian-deep'
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
                <span className={`font-medium ${isSelected ? 'text-gold' : 'text-ink'}`}>
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
