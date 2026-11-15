'use client';

import { useId } from 'react';
import {
  MAX_PARTNER_NAME, MAX_PARTNER_URL, OTHER_PARTNER, safeHttpUrl,
  type DeliveryPartnerOption, type DeliveryPartnerValue,
} from '@/lib/deliveryPartners';

const baseInput = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

/**
 * "Delivery partner" dropdown, set beside the tracking number field. "Other" opens
 * a name box and a tracking-page box (http/https only — the server checks again).
 * Options come from useDeliveryPartners(); the dropdown is disabled while they load.
 */
export default function DeliveryPartnerField({
  value, onChange, options, loading = false, required = false, label = 'Delivery partner', inputClassName = baseInput,
}: {
  value: DeliveryPartnerValue;
  onChange: (v: DeliveryPartnerValue) => void;
  options: DeliveryPartnerOption[];
  loading?: boolean;
  required?: boolean;
  label?: string;
  inputClassName?: string;
}) {
  const id = useId();
  const isOther = value.code === OTHER_PARTNER;
  const badUrl = isOther && !!value.url.trim() && !safeHttpUrl(value.url);
  return (
    <div className="space-y-2">
      <label className="block" htmlFor={`${id}-partner`}>
        <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
        <select id={`${id}-partner`} className={inputClassName} required={required} disabled={loading}
          value={value.code}
          onChange={(e) => onChange({ code: e.target.value, name: e.target.value === OTHER_PARTNER ? value.name : '', url: e.target.value === OTHER_PARTNER ? value.url : '' })}>
          <option value="">{loading ? 'Loading…' : required ? 'Choose…' : 'Not known yet'}</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>{o.code === OTHER_PARTNER ? 'Other' : o.name}</option>
          ))}
        </select>
      </label>
      {isOther && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Partner name</span>
            <input className={inputClassName} required maxLength={MAX_PARTNER_NAME} placeholder="e.g. Professional Couriers"
              value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
          </label>
          <div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Tracking page link (optional)</span>
              <input className={inputClassName} type="url" inputMode="url" maxLength={MAX_PARTNER_URL} placeholder="https://…"
                aria-invalid={badUrl || undefined} aria-describedby={badUrl ? `${id}-url-error` : undefined}
                value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} />
            </label>
            {badUrl && <p id={`${id}-url-error`} className="mt-1 text-xs text-red-700">Use a web link starting with http:// or https://</p>}
          </div>
        </>
      )}
    </div>
  );
}
