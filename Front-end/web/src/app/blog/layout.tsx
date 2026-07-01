import Link from 'next/link';
import { BookOpen, Image, Video } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/blog', label: 'Blog', icon: BookOpen, exact: true },
  { href: '/blog/gallery', label: 'Gallery', icon: Image },
  { href: '/blog/videos', label: 'Videos', icon: Video },
];

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-obsidian-deep text-ink">
      {/* Sub-nav bar */}
      <div className="bg-obsidian border-b border-hairline sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-md transition-colors whitespace-nowrap"
              >
                {Icon && <Icon className="h-4 w-4" />}
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Page content */}
      <main>{children}</main>
    </div>
  );
}
