'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, X } from 'lucide-react';
import warehouseService, { WarehouseFormData } from '@/services/warehouseService';

interface Props {
  initialData?: Partial<WarehouseFormData>;
  warehouseId?: string;
  mode: 'create' | 'edit';
  onSuccess: () => void;
}

const EMPTY_FORM: WarehouseFormData = {
  name: '',
  code: '',
  type: 'warehouse',
  location: { address: '', city: '', state: '', postalCode: '', country: 'India', latitude: '', longitude: '' },
  serviceablePinCodes: [],
  operationalStatus: 'active',
  contactInfo: { phone: '', email: '', manager: '' },
  capacity: 10000,
};

export default function WarehouseForm({ initialData, warehouseId, mode, onSuccess }: Props) {
  const [form, setForm] = useState<WarehouseFormData>({ ...EMPTY_FORM, ...initialData });
  const [pinInput, setPinInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const set = (path: string, value: unknown) => {
    setForm(prev => {
      const next = { ...prev } as any;
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) {
        cur[keys[i]] = { ...cur[keys[i]] };
        cur = cur[keys[i]];
      }
      cur[keys[keys.length - 1]] = value;
      return next as WarehouseFormData;
    });
  };

  const addPin = () => {
    const pin = pinInput.trim();
    if (!pin || form.serviceablePinCodes.includes(pin)) return;
    set('serviceablePinCodes', [...form.serviceablePinCodes, pin]);
    setPinInput('');
  };

  const removePin = (pin: string) => {
    set('serviceablePinCodes', form.serviceablePinCodes.filter(p => p !== pin));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (mode === 'create') {
        await warehouseService.createWarehouse(form);
      } else {
        await warehouseService.updateWarehouse(warehouseId!, form);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to save warehouse');
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/warehouses" className="text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">
          {mode === 'create' ? 'Add Warehouse' : 'Edit Warehouse'}
        </h1>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-700">Basic Information</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                required
                value={form.name}
                onChange={e => set('name', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Main Warehouse Delhi"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
              <input
                required
                value={form.code}
                onChange={e => set('code', e.target.value.toUpperCase())}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="WH-DEL-01"
                maxLength={20}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select
                value={form.type}
                onChange={e => set('type', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="warehouse">Warehouse</option>
                <option value="store">Store</option>
                <option value="hub">Hub</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
              <select
                value={form.operationalStatus}
                onChange={e => set('operationalStatus', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Capacity (units)</label>
              <input
                type="number"
                min={0}
                value={form.capacity}
                onChange={e => set('capacity', Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
        </section>

        {/* Location */}
        <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-700">Location</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Street Address *</label>
            <input
              required
              value={form.location.address}
              onChange={e => set('location.address', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Plot 12, Industrial Area, Phase II"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
              <input
                required
                value={form.location.city}
                onChange={e => set('location.city', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">State *</label>
              <input
                required
                value={form.location.state}
                onChange={e => set('location.state', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PIN Code *</label>
              <input
                required
                value={form.location.postalCode}
                onChange={e => set('location.postalCode', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                maxLength={10}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <input
                value={form.location.country}
                onChange={e => set('location.country', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude *</label>
              <input
                required
                type="number"
                step="any"
                min={-90}
                max={90}
                value={form.location.latitude}
                onChange={e => set('location.latitude', e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="28.6139"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude *</label>
              <input
                required
                type="number"
                step="any"
                min={-180}
                max={180}
                value={form.location.longitude}
                onChange={e => set('location.longitude', e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="77.2090"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Used for nearest-warehouse routing. Look up coordinates from any map service (right-click a location → copy lat/lng).
          </p>
        </section>

        {/* Contact */}
        <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-700">Contact Information</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manager</label>
              <input
                value={form.contactInfo.manager}
                onChange={e => set('contactInfo.manager', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Rajesh Kumar"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={form.contactInfo.phone}
                onChange={e => set('contactInfo.phone', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.contactInfo.email}
                onChange={e => set('contactInfo.email', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
        </section>

        {/* Serviceable PIN Codes */}
        <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-700">Serviceable PIN Codes</h2>
          <p className="text-xs text-gray-500">Leave empty to serve all PIN codes.</p>

          <div className="flex gap-2">
            <input
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addPin())}
              className="border rounded-lg px-3 py-2 text-sm font-mono w-32"
              placeholder="110001"
              maxLength={10}
            />
            <button
              type="button"
              onClick={addPin}
              className="bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg text-sm flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>

          {form.serviceablePinCodes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.serviceablePinCodes.map(pin => (
                <span
                  key={pin}
                  className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-mono px-2 py-1 rounded"
                >
                  {pin}
                  <button type="button" onClick={() => removePin(pin)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {submitting ? 'Saving...' : mode === 'create' ? 'Create Warehouse' : 'Save Changes'}
          </button>
          <Link
            href="/admin/warehouses"
            className="px-6 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
