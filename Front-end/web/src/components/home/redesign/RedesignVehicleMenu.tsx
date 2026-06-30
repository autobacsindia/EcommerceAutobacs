'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { useCachedData, CACHE_KEYS } from '@/lib/cacheService';

interface NamedItem {
  _id: string;
  name: string;
}

const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

/**
 * Vehicle Makes selector for the redesigned nav — same behaviour as the legacy
 * HeaderVehicleSelector (pick make → model → browse parts at /model/[slug]),
 * restyled in the home redesign's obsidian/gold theme + Montserrat.
 *
 * `variant`:
 *   - "dropdown" (desktop): trigger opens an absolutely-positioned panel.
 *   - "inline"  (mobile menu): panel renders in-flow, full width.
 */
export default function RedesignVehicleMenu({
  variant = 'dropdown',
}: {
  variant?: 'dropdown' | 'inline';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(variant === 'inline');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<NamedItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: makesData } = useCachedData<NamedItem[]>(
    CACHE_KEYS.VEHICLE_MAKES,
    async () => {
      const res = await apiClient.get<{ makes: string[] }>('/vehicles/makes');
      return res.makes.map((m) => ({ _id: m, name: m }));
    },
    24 * 60 * 60 * 1000
  );
  const makes = makesData ?? [];

  // Fetch models for the chosen make.
  useEffect(() => {
    if (!make) {
      setModels([]);
      return;
    }
    let active = true;
    setLoadingModels(true);
    apiClient
      .get<{ models: string[] }>(`/vehicles/models/${encodeURIComponent(make)}`)
      .then((res) => {
        if (!active) return;
        const list = res.models ?? [];
        setModels(list.map((m) => ({ _id: m, name: m })));
      })
      .catch((err) => console.error('Failed to fetch vehicle models:', err))
      .finally(() => active && setLoadingModels(false));
    return () => {
      active = false;
    };
  }, [make]);

  // Close the dropdown on outside click (dropdown variant only).
  useEffect(() => {
    if (variant !== 'dropdown') return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [variant]);

  const browse = () => {
    if (!make || !model) return;
    setOpen(variant === 'inline');
    router.push(`/model/${slugify(make)}-${slugify(model)}`);
  };

  return (
    <div className={`veh veh-${variant}`} ref={ref}>
      {variant === 'dropdown' && (
        <button
          type="button"
          className="veh-trigger"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((v) => !v)}
        >
          Vehicle Makes
          <svg
            className={`veh-caret${open ? ' open' : ''}`}
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}

      {open && (
        <div className="veh-panel">
          <div className="veh-eyebrow">Select Your Vehicle</div>

          <div className="veh-field">
            <label htmlFor={`veh-make-${variant}`}>Vehicle Make</label>
            <select
              id={`veh-make-${variant}`}
              className="veh-select"
              value={make}
              onChange={(e) => {
                setMake(e.target.value);
                setModel('');
              }}
            >
              <option value="">Select Make</option>
              {makes.map((m) => (
                <option key={m._id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="veh-field">
            <label htmlFor={`veh-model-${variant}`}>Vehicle Model</label>
            <select
              id={`veh-model-${variant}`}
              className="veh-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!make || loadingModels}
            >
              <option value="">
                {!make ? 'Select Make First' : loadingModels ? 'Loading…' : 'Select Model'}
              </option>
              {models.map((m) => (
                <option key={m._id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="veh-browse"
            onClick={browse}
            disabled={!make || !model}
          >
            Browse {model || 'Parts'}
          </button>

          <button
            type="button"
            className="veh-all"
            onClick={() => {
              setOpen(variant === 'inline');
              router.push('/vehicles');
            }}
          >
            View All Vehicles →
          </button>
        </div>
      )}
    </div>
  );
}
