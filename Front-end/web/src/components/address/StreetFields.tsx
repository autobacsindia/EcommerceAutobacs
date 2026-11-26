'use client';

/**
 * House / Flat no. + Street / Area + Landmark — the three boxes every staff
 * address form shares (offline order, sales order / quotation). The rule and
 * the words come from lib/deliveryAddress.ts, the website mirror of the
 * server's utils/deliveryAddress.js; the server re-checks every save.
 *
 * A box shows its message once the person has left it (or `showErrors`), so
 * nobody is shouted at while still typing.
 */

import { useState } from 'react';
import { ADDRESS_FIELD_TEXT, ADDRESS_LIMITS, deliveryAddressProblems, type StreetField } from '@/lib/deliveryAddress';

export type StreetValues = { houseNumber: string; addressLine1: string; landmark: string };

const MAX: Record<StreetField, number> = {
  houseNumber: ADDRESS_LIMITS.houseNumber,
  addressLine1: ADDRESS_LIMITS.street,
  landmark: ADDRESS_LIMITS.landmark,
};
const ORDER: StreetField[] = ['houseNumber', 'addressLine1', 'landmark'];

export default function StreetFields({ value, onChange, inputClassName, labelClassName = 'mb-1 block text-gray-600', showErrors = false, idPrefix = 'addr' }: {
  value: StreetValues;
  onChange: (field: StreetField, v: string) => void;
  inputClassName: string;
  labelClassName?: string;
  showErrors?: boolean;
  idPrefix?: string;
}) {
  const [touched, setTouched] = useState<Partial<Record<StreetField, boolean>>>({});
  const problems = deliveryAddressProblems(value);

  return (
    <>
      {ORDER.map((field) => {
        const text = ADDRESS_FIELD_TEXT[field];
        const id = `${idPrefix}-${field}`;
        const error = (showErrors || touched[field]) ? problems[field] : undefined;
        const required = field !== 'landmark';
        return (
          <div key={field} className="text-sm sm:col-span-2">
            <label htmlFor={id} className={labelClassName}>
              {required ? <>{text.label} <span className="text-red-500">*</span></> : text.label}
            </label>
            <input
              id={id}
              value={value[field]}
              maxLength={MAX[field]}
              placeholder={text.placeholder}
              onChange={(e) => onChange(field, e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, [field]: true }))}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className={`${inputClassName}${error ? ' !border-red-500' : ''}`}
            />
            {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        );
      })}
    </>
  );
}
