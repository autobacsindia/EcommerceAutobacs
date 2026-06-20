import Link from 'next/link';

interface Props {
  name: string;
  type: 'news' | 'blog';
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

const TYPE_ROUTE: Record<string, string> = { blog: 'blogs', news: 'news' };

export default function AuthorCard({ name, type }: Props) {
  const displayName = name || 'Autobacs Team';
  const abbr = initials(displayName);
  const listRoute = TYPE_ROUTE[type] ?? type;

  return (
    <div className="mt-6 bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
      <div
        className="flex-shrink-0 w-14 h-14 rounded-full bg-red-600 flex items-center justify-center text-white font-bold text-lg select-none"
        aria-hidden="true"
      >
        {abbr}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs uppercase tracking-widest text-gray-400 font-medium mb-0.5">Written by</p>
        <p className="font-bold text-gray-900 text-base leading-snug">{displayName}</p>
        <Link
          href={`/media/${listRoute}?search=${encodeURIComponent(displayName)}`}
          className="text-xs text-red-600 hover:underline mt-1 inline-block"
        >
          More articles by {displayName} →
        </Link>
      </div>
    </div>
  );
}
