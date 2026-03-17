import Link from 'next/link';
import { Newspaper, BookOpen, Image, Video, ChevronRight } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/media', label: 'Media Center', icon: null, exact: true },
  { href: '/media/news', label: 'News', icon: Newspaper },
  { href: '/media/blogs', label: 'Blog', icon: BookOpen },
  { href: '/media/gallery', label: 'Gallery', icon: Image },
  { href: '/media/videos', label: 'Videos', icon: Video },
];

export default function MediaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sub-nav bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors whitespace-nowrap"
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
