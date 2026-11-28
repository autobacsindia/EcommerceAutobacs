/** Round initials badge beside a name (no photo needed, no network). */
export default function Initials({ name }: { name: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
      {letters}
    </span>
  );
}

export function PersonCell({ name, sub }: { name: string; sub?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Initials name={name} />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-gray-900">{name}</span>
        {sub && <span className="block truncate text-xs text-gray-500">{sub}</span>}
      </span>
    </span>
  );
}
