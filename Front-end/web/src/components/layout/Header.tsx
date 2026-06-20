import BrandLogo from './BrandLogo';
import LocationDisplay from '@/components/location/LocationDisplay';
import ClientSearchSuggestions from './ClientSearchSuggestions';
import HeaderInteractiveBar from './HeaderInteractiveBar';
import HeaderNav from './HeaderNav';
import type { NavCategory } from '@/lib/navCategories';

export default function Header({ navCategories }: { navCategories: NavCategory[] }) {
  return (
    <header className="bg-black sticky top-0 z-50 shadow-md w-full">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        {/* Top Row */}
        <div className="flex items-center h-16 border-b border-gray-800 gap-4">
          <div className="shrink-0">
            <BrandLogo variant="full" />
          </div>

          <div className="hidden lg:block shrink-0">
            <LocationDisplay compact={true} />
          </div>

          <div className="hidden md:block flex-1 max-w-4xl">
            <ClientSearchSuggestions />
          </div>

          {/* Auth, cart/wishlist badges, mobile toggles — all interactive */}
          <HeaderInteractiveBar navCategories={navCategories} />
        </div>

        {/* Bottom Row — needs usePathname for active underlines */}
        <HeaderNav categories={navCategories} />
      </div>
    </header>
  );
}
