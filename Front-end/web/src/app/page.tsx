import Link from 'next/link';
import Image from 'next/image';
import { ShoppingBag, Truck, Shield, Headphones } from 'lucide-react';
import dynamic from 'next/dynamic';
import HeroBanner from '@/components/layout/HeroBanner';
import { FEATURED_VEHICLES } from '@/lib/vehicleData';
import { ProductGridSkeleton } from '@/components/skeletons/ProductCardSkeleton';
import { Skeleton } from '@/components/ui/Skeleton';
import { VehicleSelectorSection, RecentlyViewedSection } from './HomeClientSection';

const FastMovingProducts = dynamic(() => import('@/components/products/FastMovingProducts'), {
  loading: () => (
    <div className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <Skeleton className="h-8 w-64 mx-auto mb-4" />
          <Skeleton className="h-4 w-48 mx-auto" />
        </div>
        <ProductGridSkeleton count={5} />
      </div>
    </div>
  )
});

const ModernFastMovingSection = dynamic(() => import('@/components/products/ModernFastMovingSection'), {
  loading: () => (
    <div className="py-16 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <Skeleton className="h-8 w-64 mx-auto mb-2" />
          <Skeleton className="h-4 w-48 mx-auto" />
        </div>
        <ProductGridSkeleton count={4} />
      </div>
    </div>
  )
});

const KeepShoppingWidget = dynamic(() => import('@/components/products/KeepShoppingWidget'), {
  loading: () => <Skeleton className="h-64 rounded-lg w-full" />
});

const SuperCarsBanner = dynamic(() => import('@/components/layout/SuperCarsBanner'), {
  loading: () => <Skeleton className="h-80 w-full" />
});

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Hero Banner */}
      <HeroBanner />

      {/* Vehicle Selector Section */}
      <section className="py-12 bg-[#080808]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <p className="text-xs font-condensed font-bold tracking-[0.2em] uppercase text-[#3B9EE8] mb-2">Find Your Fit</p>
            <h2 className="text-3xl font-condensed font-bold text-white mb-3 uppercase">Find Parts for Your Vehicle</h2>
            <p className="text-[#C4C4C4] max-w-2xl mx-auto font-body">
              Select your vehicle to see compatible parts and accessories
            </p>
          </div>

          <VehicleSelectorSection />

          {/* Vehicle Images Row - 4 cars + See More */}
          <div className="mt-12">
            <div className="grid grid-cols-5 gap-4">
              {FEATURED_VEHICLES.slice(0, 4).map((vehicle) => (
                <Link
                  key={vehicle.id}
                  href={`/model/${vehicle.slug}`}
                  className="group"
                >
                  <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg overflow-hidden hover:border-[#3B9EE8] transition-all duration-300">
                    <div className="aspect-square bg-[#161616] flex items-center justify-center overflow-hidden">
                      {vehicle.image && (
                        <Image
                          src={vehicle.image}
                          alt={vehicle.name}
                          width={300}
                          height={300}
                          className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                        />
                      )}
                    </div>
                    <div className="p-3 text-center bg-[#0E0E0E] border-t border-[#252525]">
                      <h3 className="text-sm font-condensed font-bold text-white group-hover:text-[#3B9EE8] transition-colors uppercase tracking-wide">
                        {vehicle.name}
                      </h3>
                    </div>
                  </div>
                </Link>
              ))}

              {/* See More Card */}
              <Link href="/vehicles" className="group">
                <div className="bg-[#3B9EE8] rounded-lg overflow-hidden hover:bg-[#1A6FB5] transition-all duration-300 h-full flex flex-col items-center justify-center p-6">
                  <div className="text-white text-center">
                    <svg
                      className="w-12 h-12 mx-auto mb-3 group-hover:scale-110 transition-transform"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    <h3 className="text-lg font-condensed font-bold mb-1 uppercase tracking-wider">See More</h3>
                    <p className="text-sm text-white/80 font-body">View all vehicles</p>
                  </div>
                </div>
              </Link>
            </div>
          </div>

          {/* Brand Logos Slider */}
          <div className="mt-16 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-12 bg-gray-50 border-y border-gray-200">
            <div className="text-center mb-8">
              <p className="text-xs font-condensed font-bold tracking-[0.2em] uppercase text-[#3B9EE8] mb-2">Our Partners</p>
              <h3 className="text-2xl font-condensed font-bold text-gray-900 mb-2 uppercase">Trusted Brands</h3>
              <p className="text-gray-500 font-body">Premium automotive parts from world-class manufacturers</p>
            </div>
            <div className="relative overflow-hidden py-8">
              <div className="flex animate-scroll space-x-12 items-center">
                {/* First set of logos */}
                <Link href="/brands/profender" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/profender-logo-1.png.webp"
                    alt="Profender"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/bushranger" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/bushranger.png.webp"
                    alt="Bushranger"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/ironman-4x4" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/ironman.png.webp"
                    alt="Ironman"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/dr-nano" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/dr-nano-logo-1.png.webp"
                    alt="Dr. Nano"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/lightforce" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/lightforce-logo-1.png.webp"
                    alt="Lightforce"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/option4wd" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/option-logo-1.png.webp"
                    alt="Option"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                {/* Duplicate set for seamless loop */}
                <Link href="/brands/profender" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/profender-logo-1.png.webp"
                    alt="Profender"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/bushranger" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/bushranger.png.webp"
                    alt="Bushranger"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/ironman-4x4" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/ironman.png.webp"
                    alt="Ironman"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/dr-nano" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/dr-nano-logo-1.png.webp"
                    alt="Dr. Nano"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/lightforce" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/lightforce-logo-1.png.webp"
                    alt="Lightforce"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/option4wd" className="shrink-0 w-48 h-24 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:border-[#3B9EE8] hover:shadow-md transition-all p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/option-logo-1.png.webp"
                    alt="Option"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Fast Moving Products Section - Modern Design */}
      <ModernFastMovingSection />

      {/* Featured Products Section */}
      <FastMovingProducts limit={4} />

      {/* Super Cars Premium Banner */}
      <SuperCarsBanner />

      {/* Curated Collections - Three "Keep Shopping For" Widgets */}
      <div className="bg-[#080808] py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            <KeepShoppingWidget
              title="Keep shopping for"
              searchKeyword="suspension performance"
              categorySlug="suspension,performance"
              viewAllLink="/products?search=suspension performance"
            />
            <KeepShoppingWidget
              title="Revamp your ride in style"
              searchKeyword="exterior"
              categorySlug="exterior"
              viewAllLink="/products?search=exterior"
            />
            <KeepShoppingWidget
              title="Transform your vehicle"
              searchKeyword="accessories"
              categorySlug="interior"
              viewAllLink="/products?search=accessories"
            />
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section className="py-16 bg-[#0E0E0E] border-y border-[#252525]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShoppingBag className="h-8 w-8 text-[#3B9EE8]" />
              </div>
              <h3 className="text-base font-condensed font-bold text-white mb-2 uppercase tracking-wide">Wide Selection</h3>
              <p className="text-[#C4C4C4] font-body text-sm">Thousands of products for all makes and models</p>
            </div>

            <div className="text-center">
              <div className="bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Truck className="h-8 w-8 text-[#3B9EE8]" />
              </div>
              <h3 className="text-base font-condensed font-bold text-white mb-2 uppercase tracking-wide">Fast Shipping</h3>
              <p className="text-[#C4C4C4] font-body text-sm">Quick delivery across India — 28+ states served</p>
            </div>

            <div className="text-center">
              <div className="bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="h-8 w-8 text-[#3B9EE8]" />
              </div>
              <h3 className="text-base font-condensed font-bold text-white mb-2 uppercase tracking-wide">Quality Assured</h3>
              <p className="text-[#C4C4C4] font-body text-sm">Genuine products with manufacturer warranty</p>
            </div>

            <div className="text-center">
              <div className="bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Headphones className="h-8 w-8 text-[#3B9EE8]" />
              </div>
              <h3 className="text-base font-condensed font-bold text-white mb-2 uppercase tracking-wide">Expert Support</h3>
              <p className="text-[#C4C4C4] font-body text-sm">Dedicated customer service team</p>
            </div>
          </div>
        </div>
      </section>

      {/* Popular Categories */}
      <section className="py-16 bg-[#080808]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-condensed font-bold tracking-[0.2em] uppercase text-[#3B9EE8] mb-2">Shop By Category</p>
            <h2 className="text-3xl font-condensed font-bold text-white uppercase">Popular Categories</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Link href="/categories/bodykit" className="group">
              <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg overflow-hidden hover:border-[#3B9EE8] transition-all duration-300">
                <div className="h-48 bg-gradient-to-br from-[#0E0E0E] to-[#1A6FB5]/30 flex items-center justify-center">
                  <span className="text-white text-2xl font-condensed font-bold uppercase tracking-wider">Body Kits</span>
                </div>
                <div className="p-5 border-t border-[#252525]">
                  <h3 className="text-base font-condensed font-bold text-white mb-1 uppercase group-hover:text-[#3B9EE8] transition-colors">Body Kits</h3>
                  <p className="text-[#C4C4C4] text-sm font-body">Enhance your car&apos;s appearance</p>
                </div>
              </div>
            </Link>

            <Link href="/categories/performance" className="group">
              <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg overflow-hidden hover:border-[#3B9EE8] transition-all duration-300">
                <div className="h-48 bg-gradient-to-br from-[#0E0E0E] to-[#EF9F27]/20 flex items-center justify-center">
                  <span className="text-white text-2xl font-condensed font-bold uppercase tracking-wider">Performance</span>
                </div>
                <div className="p-5 border-t border-[#252525]">
                  <h3 className="text-base font-condensed font-bold text-white mb-1 uppercase group-hover:text-[#3B9EE8] transition-colors">Performance Parts</h3>
                  <p className="text-[#C4C4C4] text-sm font-body">Boost your engine&apos;s power</p>
                </div>
              </div>
            </Link>

            <Link href="/categories/suspension" className="group">
              <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg overflow-hidden hover:border-[#3B9EE8] transition-all duration-300">
                <div className="h-48 bg-gradient-to-br from-[#0E0E0E] to-[#3B9EE8]/20 flex items-center justify-center">
                  <span className="text-white text-2xl font-condensed font-bold uppercase tracking-wider">Suspension</span>
                </div>
                <div className="p-5 border-t border-[#252525]">
                  <h3 className="text-base font-condensed font-bold text-white mb-1 uppercase group-hover:text-[#3B9EE8] transition-colors">Suspension Systems</h3>
                  <p className="text-[#C4C4C4] text-sm font-body">Improve ride quality and handling</p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Recently Viewed Section */}
      <RecentlyViewedSection />

      {/* CTA Section */}
      <section className="bg-[#0E0E0E] border-y border-[#252525] text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs font-condensed font-bold tracking-[0.2em] uppercase text-[#3B9EE8] mb-3">India&apos;s No.1 Aftermarket Destination</p>
          <h2 className="text-4xl font-condensed font-bold mb-2 uppercase">Where Machines Meet Mastery.</h2>
          <p className="text-lg mb-6 text-[#C4C4C4] font-body max-w-xl mx-auto">
            500+ premium brands · 10,000+ happy builds · 28+ states served
          </p>
          <Link
            href="/products"
            className="inline-block bg-[#3B9EE8] text-white px-8 py-3 rounded-sm font-condensed font-bold hover:bg-[#1A6FB5] transition-colors uppercase tracking-widest text-sm"
          >
            Build Your Car →
          </Link>
        </div>
      </section>
    </div>
  );
}
