'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingBag, Truck, Shield, Headphones } from 'lucide-react';
import PageLoader from '@/components/layout/PageLoader';
import useIsMounted from '@/lib/hooks/useIsMounted';
import dynamic from 'next/dynamic';

import FastMovingProducts from '@/components/products/FastMovingProducts';
import CuratedCollections from '@/components/products/CuratedCollections';
import KeepShoppingWidget from '@/components/products/KeepShoppingWidget';
import SuperCarsBanner from '@/components/layout/SuperCarsBanner';
import HeroBanner from '@/components/layout/HeroBanner';
import { FEATURED_VEHICLES } from '@/lib/vehicleData';

// Dynamically import VehicleSelector to avoid SSR issues
const VehicleSelector = dynamic(() => import('@/components/vehicles/VehicleSelector'), { ssr: false });

export default function Home() {
  const isMounted = useIsMounted();
  const [selectedVehicle, setSelectedVehicle] = useState({ make: '', model: '' });

  const handleVehicleSelect = (make: string, model: string) => {
    setSelectedVehicle({ make, model });
  };

  // Show skeleton loader until component is mounted to prevent hydration issues
  if (!isMounted) {
    return <PageLoader type="home" />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Hero Banner */}
      <HeroBanner />

      {/* Vehicle Selector Section */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Find Parts for Your Vehicle</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Select your vehicle to see compatible parts and accessories
            </p>
          </div>
          
          <div className="max-w-2xl mx-auto">
            <VehicleSelector onVehicleSelect={handleVehicleSelect} />
            
            {selectedVehicle.make && selectedVehicle.model && (
              <div className="mt-6 text-center">
                <Link 
                  href={`/products?vehicleMake=${encodeURIComponent(selectedVehicle.make)}&vehicleModel=${encodeURIComponent(selectedVehicle.model)}`}
                  className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                >
                  View {selectedVehicle.make} {selectedVehicle.model} Parts
                </Link>
              </div>
            )}
          </div>

          {/* Vehicle Images Row - 4 cars + See More */}
          <div className="mt-12">
            <div className="grid grid-cols-5 gap-4">
              {FEATURED_VEHICLES.slice(0, 4).map((vehicle) => (
                <Link 
                  key={vehicle.id} 
                  href={`/vehicles/${vehicle.make}`} 
                  className="group"
                >
                  <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300">
                    <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden">
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
                    <div className="p-3 text-center bg-gray-50">
                      <h3 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                        {vehicle.name}
                      </h3>
                    </div>
                  </div>
                </Link>
              ))}
              
              {/* See More Card */}
              <Link href="/vehicles" className="group">
                <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300 h-full flex flex-col items-center justify-center p-6">
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
                    <h3 className="text-lg font-bold mb-1">See More</h3>
                    <p className="text-sm text-blue-100">View all vehicles</p>
                  </div>
                </div>
              </Link>
            </div>
          </div>

          {/* Brand Logos Slider */}
          <div className="mt-16 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-12 bg-gradient-to-br from-gray-50 to-gray-100">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Trusted Brands</h3>
              <p className="text-gray-600">Premium automotive parts from world-class manufacturers</p>
            </div>
            <div className="relative overflow-hidden py-8">
              <div className="flex animate-scroll space-x-12 items-center">
                {/* First set of logos */}
                <Link href="/brands/profender" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/profender-logo-1.png.webp"
                    alt="Profender"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/bushranger" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/bushranger.png.webp"
                    alt="Bushranger"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/ironman" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/ironman.png.webp"
                    alt="Ironman"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/dr-nano" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/dr-nano-logo-1.png.webp"
                    alt="Dr. Nano"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/lightforce" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/lightforce-logo-1.png.webp"
                    alt="Lightforce"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/option" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/option-logo-1.png.webp"
                    alt="Option"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                {/* Duplicate set for seamless loop */}
                <Link href="/brands/profender" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/profender-logo-1.png.webp"
                    alt="Profender"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/bushranger" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/bushranger.png.webp"
                    alt="Bushranger"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/ironman" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/ironman.png.webp"
                    alt="Ironman"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/dr-nano" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/dr-nano-logo-1.png.webp"
                    alt="Dr. Nano"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/lightforce" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
                  <Image
                    src="https://autobacsindia.com/wp-content/uploads/2024/10/lightforce-logo-1.png.webp"
                    alt="Lightforce"
                    width={180}
                    height={80}
                    className="object-contain w-full h-full grayscale hover:grayscale-0 transition-all"
                  />
                </Link>
                <Link href="/brands/option" className="flex-shrink-0 w-48 h-24 flex items-center justify-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer">
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

      {/* Fast-Moving Products Section */}
      <FastMovingProducts limit={4} />

      {/* Super Cars Premium Banner */}
      <SuperCarsBanner />

      {/* Curated Collections - Three "Keep Shopping For" Widgets */}
      <div className="bg-gray-50 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Widget 1: Keep shopping for */}
            <KeepShoppingWidget
              title="Keep shopping for"
              searchKeyword="suspension performance"
              viewAllLink="/products?search=suspension performance"
            />

            {/* Widget 2: Revamp your ride in style */}
            <KeepShoppingWidget
              title="Revamp your ride in style"
              searchKeyword="body kit styling"
              viewAllLink="/products?search=body kit styling"
            />

            {/* Widget 3: Transform your vehicle */}
            <KeepShoppingWidget
              title="Transform your vehicle"
              searchKeyword="exhaust speaker accessories"
              viewAllLink="/products?search=exhaust accessories"
            />
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShoppingBag className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Wide Selection</h3>
              <p className="text-gray-600">Thousands of products for all makes and models</p>
            </div>

            <div className="text-center">
              <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Truck className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Fast Shipping</h3>
              <p className="text-gray-600">Quick delivery across India</p>
            </div>

            <div className="text-center">
              <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Quality Assured</h3>
              <p className="text-gray-600">Genuine products with warranty</p>
            </div>

            <div className="text-center">
              <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Headphones className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Expert Support</h3>
              <p className="text-gray-600">Dedicated customer service team</p>
            </div>
          </div>
        </div>
      </section>

      {/* Popular Categories */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center mb-12">Popular Categories</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Link href="/categories" className="group">
              <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow">
                <div className="h-48 bg-gradient-to-br from-blue-400 to-blue-600"></div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold mb-2 group-hover:text-blue-600">Body Kits</h3>
                  <p className="text-gray-600">Enhance your car's appearance</p>
                </div>
              </div>
            </Link>

            <Link href="/categories" className="group">
              <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow">
                <div className="h-48 bg-gradient-to-br from-red-400 to-red-600"></div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold mb-2 group-hover:text-blue-600">Performance Parts</h3>
                  <p className="text-gray-600">Boost your engine's power</p>
                </div>
              </div>
            </Link>

            <Link href="/categories" className="group">
              <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow">
                <div className="h-48 bg-gradient-to-br from-green-400 to-green-600"></div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold mb-2 group-hover:text-blue-600">Suspension Systems</h3>
                  <p className="text-gray-600">Improve ride quality and handling</p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-blue-600 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Upgrade Your Vehicle?</h2>
          <p className="text-xl mb-8 text-blue-100">
            Browse our extensive catalog and find the perfect parts for your ride
          </p>
          <Link
            href="/products"
            className="inline-block bg-white text-blue-600 px-8 py-3 rounded-lg font-semibold hover:bg-blue-50 transition-colors"
          >
            Explore Products
          </Link>
        </div>
      </section>
    </div>
  );
}