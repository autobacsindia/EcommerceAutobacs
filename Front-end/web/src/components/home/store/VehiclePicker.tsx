'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVehicleMakes, useVehicleModels } from '@/hooks/queries/useVehicleMakes';

const STORAGE_KEY = 'roavion:vehicle';

/** Remembered vehicle (per browser, convenience only — never trusted for anything). */
export function readSavedVehicle(): { make: string; model: string } | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    return v && typeof v.make === 'string' && typeof v.model === 'string' ? v : null;
  } catch {
    return null;
  }
}
function saveVehicle(make: string, model: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ make, model }));
  } catch {
    /* private mode / blocked storage: the picker still works, it just won't remember */
  }
}

/**
 * "Select your vehicle" — the store's equivalent of Amazon's "Deliver to". Shows the
 * remembered car; opens a small make → model picker that lands on the parts that fit.
 */
export default function VehiclePicker({ variant = 'header' }: { variant?: 'header' | 'bar' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ make: string; model: string } | null>(null);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const { data: makes = [] } = useVehicleMakes();
  const { data: models = [], isFetching } = useVehicleModels(make);
  const ref = useRef<HTMLDivElement>(null);

  // Read after mount so the server HTML and the first client render agree.
  useEffect(() => setSaved(readSavedVehicle()), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = () => {
    if (!make || !model) return;
    saveVehicle(make, model);
    setSaved({ make, model });
    setOpen(false);
    router.push(`/products?${new URLSearchParams({ vehicleMake: make, vehicleModel: model }).toString()}`);
  };

  return (
    <div className={`sh-vehicle sh-vehicle-${variant}`} ref={ref}>
      <button type="button" className="sh-vehicle-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 17h14M6 17l1.5-5h9L18 17M7.5 12 9 8h6l1.5 4" /><circle cx="8" cy="17" r="1.6" /><circle cx="16" cy="17" r="1.6" /></svg>
        <span className="sh-vehicle-text">
          <span className="sh-vehicle-small">{saved ? 'Parts for' : 'Shop by'}</span>
          <span className="sh-vehicle-big">{saved ? `${saved.make} ${saved.model}` : 'Select your vehicle'}</span>
        </span>
      </button>
      {open && (
        <div className="sh-vehicle-pop" role="dialog" aria-label="Select your vehicle">
          <p className="sh-pop-title">Find parts that fit your car</p>
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
              <option value="">{!make ? 'Choose a make first' : isFetching ? 'Loading…' : 'Select model'}</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <button type="button" className="sh-btn sh-btn-primary" onClick={go} disabled={!make || !model}>Show parts that fit</button>
        </div>
      )}
    </div>
  );
}
