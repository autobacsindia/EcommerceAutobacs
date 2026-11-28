'use client';

/**
 * "Edit address" on the admin order page.
 *
 * Only name, phone, alternate phone, street lines and city change. PIN code and
 * state are shown read-only: they set the delivery charge the customer already
 * paid, so the server refuses to change them (cancel and re-order instead).
 * The server also refuses once anything has shipped; this form only mirrors that.
 */

import { useState } from 'react';
import apiClient from '@/lib/api-client';
import { ADDRESS_FIELD_TEXT, deliveryAddressProblems } from '@/lib/deliveryAddress';

export type OrderShippingAddress = {
  fullName: string;
  phone: string;
  alternatePhone?: string;
  /** Absent on orders placed before the house-number rule. */
  houseNumber?: string;
  addressLine1: string;
  landmark?: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

type Saved = { shippingAddress: OrderShippingAddress; addressEditable: boolean };

const FIELDS: Array<{ key: keyof OrderShippingAddress; label: string; required?: boolean; inputMode?: 'tel'; placeholder?: string }> = [
  { key: 'fullName', label: 'Full name', required: true },
  { key: 'phone', label: 'Mobile number', required: true, inputMode: 'tel' },
  { key: 'alternatePhone', label: 'Alternate number', inputMode: 'tel' },
  { key: 'houseNumber', label: ADDRESS_FIELD_TEXT.houseNumber.label, required: true, placeholder: ADDRESS_FIELD_TEXT.houseNumber.placeholder },
  { key: 'addressLine1', label: 'Street / Area', required: true, placeholder: ADDRESS_FIELD_TEXT.addressLine1.placeholder },
  { key: 'landmark', label: 'Landmark', placeholder: ADDRESS_FIELD_TEXT.landmark.placeholder },
  { key: 'addressLine2', label: 'Address line 2' },
  { key: 'city', label: 'City', required: true },
];

// apiClient puts the server's JSON body on `rawData`; its message is written for the admin.
const errorText = (err: unknown) =>
  (err as { rawData?: { message?: string } })?.rawData?.message
  || 'Could not save the address. Please try again.';

export default function EditOrderAddress({ orderId, address, onSaved, onCancel }: {
  orderId: string;
  address: OrderShippingAddress;
  onSaved: (saved: Saved) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<OrderShippingAddress>({
    ...address, alternatePhone: address.alternatePhone ?? '', addressLine2: address.addressLine2 ?? '',
    houseNumber: address.houseNumber ?? '', landmark: address.landmark ?? '',
  });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    // Same rule as the server (which re-checks): an old order without a house
    // number must have it added here.
    const problems = deliveryAddressProblems(draft);
    const problem = problems.houseNumber || problems.addressLine1 || problems.landmark;
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      const body = {
        address: Object.fromEntries(FIELDS.map(({ key }) => [key, draft[key] ?? ''])),
        reason: reason.trim(),
      };
      const res = await apiClient.patch<Saved>(`/orders/${encodeURIComponent(orderId)}/shipping-address`, body);
      onSaved(res);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Edit delivery address">
      {FIELDS.map(({ key, label, required, inputMode, placeholder }) => (
        <label key={key} className="block text-sm">
          <span className="text-gray-700">{label}{required ? ' *' : ''}</span>
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={draft[key] ?? ''}
            required={required}
            maxLength={200}
            inputMode={inputMode}
            placeholder={placeholder}
            onChange={(ev) => setDraft((d) => ({ ...d, [key]: ev.target.value }))}
          />
        </label>
      ))}
      <div className="rounded bg-gray-50 p-3 text-sm text-gray-600">
        <p>PIN code {address.postalCode} · {address.state} · {address.country}</p>
        <p className="mt-1">PIN code and state can&apos;t be changed here — they set the delivery charge. For a wrong PIN, cancel and re-order.</p>
      </div>
      <label className="block text-sm">
        <span className="text-gray-700">Why are you changing it? *</span>
        <input
          className="mt-1 w-full rounded border px-3 py-2"
          value={reason}
          required
          minLength={3}
          maxLength={300}
          placeholder="e.g. Customer called with the right flat number"
          onChange={(ev) => setReason(ev.target.value)}
        />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save address'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="rounded border px-4 py-2 text-sm">Cancel</button>
      </div>
    </form>
  );
}
