import { MapPin, Warehouse, Store, Network } from 'lucide-react';

interface PublicWarehouse {
  id: string;
  name: string;
  type: 'warehouse' | 'store' | 'hub';
  city: string;
  state: string;
  serviceablePinCount: number;
  operationalStatus: string;
}

const TYPE_META: Record<string, { label: string; Icon: React.ElementType; color: string }> = {
  warehouse: { label: 'Warehouse', Icon: Warehouse, color: 'text-[#3B9EE8]' },
  hub:       { label: 'Hub',       Icon: Network,   color: 'text-[#EF9F27]' },
  store:     { label: 'Store',     Icon: Store,     color: 'text-emerald-400' },
};

async function fetchActiveWarehouses(): Promise<PublicWarehouse[]> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:8080';
    const res = await fetch(`${apiUrl}/api/v1/warehouses/public`, {
      next: { tags: ['warehouses'], revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.warehouses ?? [];
  } catch {
    return [];
  }
}

export default async function DeliveryNetwork() {
  const warehouses = await fetchActiveWarehouses();

  if (warehouses.length === 0) return null;

  return (
    <section className="py-16 bg-[#080808] border-t border-[#252525]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Heading */}
        <div className="text-center mb-12">
          <p className="text-xs font-condensed font-bold tracking-[0.2em] uppercase text-[#3B9EE8] mb-2">
            Pan-India Coverage
          </p>
          <h2 className="text-3xl font-condensed font-bold text-white uppercase mb-3">
            Our Delivery Network
          </h2>
          <p className="text-[#C4C4C4] font-body max-w-xl mx-auto text-sm">
            Strategically located warehouses and hubs ensure fast dispatch to your doorstep across India.
          </p>
        </div>

        {/* Warehouse cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {warehouses.map(w => {
            const meta = TYPE_META[w.type] ?? TYPE_META.warehouse;
            const { Icon } = meta;

            return (
              <div
                key={w.id}
                className="bg-[#0E0E0E] border border-[#252525] rounded-lg p-5 flex items-start gap-4 hover:border-[#3B9EE8] transition-colors duration-300"
              >
                {/* Icon */}
                <div className="shrink-0 w-10 h-10 rounded-full bg-[#3B9EE8]/10 border border-[#3B9EE8]/20 flex items-center justify-center">
                  <Icon className={`w-5 h-5 ${meta.color}`} />
                </div>

                {/* Info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-sm font-condensed font-bold text-white uppercase tracking-wide truncate">
                      {w.city}
                    </h3>
                    <span className={`text-xs font-condensed font-bold uppercase tracking-wider ${meta.color}`}>
                      {meta.label}
                    </span>
                  </div>

                  <p className="text-xs text-[#C4C4C4] font-body mb-2">{w.state}</p>

                  <div className="flex items-center gap-1 text-xs text-[#888] font-body">
                    <MapPin className="w-3 h-3 shrink-0" />
                    {w.serviceablePinCount > 0
                      ? `${w.serviceablePinCount} PIN code${w.serviceablePinCount !== 1 ? 's' : ''} served`
                      : 'Pan-India delivery'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary bar */}
        <div className="mt-10 grid grid-cols-3 divide-x divide-[#252525] border border-[#252525] rounded-lg overflow-hidden">
          {[
            { value: `${warehouses.length}`, label: 'Locations' },
            {
              value: `${warehouses.reduce((s, w) => s + w.serviceablePinCount, 0) || '—'}`,
              label: 'PIN Codes Covered',
            },
            {
              value: `${new Set(warehouses.map(w => w.state)).size}`,
              label: 'States',
            },
          ].map(({ value, label }) => (
            <div key={label} className="py-4 text-center bg-[#0E0E0E]">
              <p className="text-2xl font-condensed font-bold text-[#3B9EE8]">{value}</p>
              <p className="text-xs text-[#888] font-body uppercase tracking-wider mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
