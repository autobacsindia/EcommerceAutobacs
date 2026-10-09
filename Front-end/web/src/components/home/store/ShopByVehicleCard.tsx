'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useVehicleMakes, useVehicleModels } from '@/hooks/queries/useVehicleMakes';

const POPULAR = ['Toyota', 'Mahindra', 'Tata', 'Maruti Suzuki', 'Hyundai', 'Kia', 'Land Rover', 'Jeep'];

/** Make → model picker as a card, with one-tap popular makes (only ones we stock). */
export default function ShopByVehicleCard() {
  const router = useRouter();
  const { data: makes = [] } = useVehicleMakes();
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const { data: models = [], isFetching } = useVehicleModels(make);
  const popular = POPULAR.filter((n) => makes.some((m) => m.name === n)).slice(0, 6);

  const go = () => {
    if (!make) return;
    const qs = new URLSearchParams({ vehicleMake: make, ...(model && { vehicleModel: model }) });
    router.push(`/products?${qs.toString()}`);
  };

  return (
    <div className="st-card sh-quad sh-vcard">
      <div className="sh-vcard-head">
        <span className="sh-vcard-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 17h14M5 17a2 2 0 1 1-4 0v-4l2.5-5.5A2 2 0 0 1 5.3 6h13.4a2 2 0 0 1 1.8 1.5L23 13v4a2 2 0 1 1-4 0" />
            <circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" />
          </svg>
        </span>
        <div>
          <h2 className="st-h3">Parts that fit your car</h2>
          <p className="st-sub">Pick your car — we&apos;ll show only what fits.</p>
        </div>
      </div>
      <div className="sh-vcard-body">
      <label className="sh-field">
        <span>Make</span>
        <select value={make} onChange={(e) => { setMake(e.target.value); setModel(''); }} aria-label="Car make">
          <option value="">Select make</option>
          {makes.map((m) => <option key={m._id} value={m.name}>{m.name}</option>)}
        </select>
      </label>
      <label className="sh-field">
        <span>Model</span>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!make || isFetching} aria-label="Car model">
          <option value="">{!make ? 'Choose a make first' : isFetching ? 'Loading…' : 'All models'}</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <button type="button" className="sh-btn sh-btn-primary sh-vcard-go" onClick={go} disabled={!make}>Show parts</button>
      {popular.length > 0 && (
        <div className="sh-vchips">
          {popular.map((n) => (
            <Link key={n} href={`/products?vehicleMake=${encodeURIComponent(n)}`} className="sh-chip">{n}</Link>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
