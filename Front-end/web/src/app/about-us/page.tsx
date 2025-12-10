'use client';

import { Truck, Shield, Headphones, CheckCircle, ShoppingCart, Lock, Users, Award } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export default function AboutUsPage() {
  const features = [
    {
      icon: <CheckCircle className="h-8 w-8 text-blue-600" />,
      title: "Guaranteed Fitted",
      description: "Today our catalogue includes more than 1000 of different parts for motor cars of different brands."
    },
    {
      icon: <Truck className="h-8 w-8 text-blue-600" />,
      title: "Hassle Free Shipping",
      description: "Top-notch aftermarket car spare parts supplied from only the industry's leading manufacturers."
    },
    {
      icon: <ShoppingCart className="h-8 w-8 text-blue-600" />,
      title: "Bulk Order Availability",
      description: "We also provide bulk order for each and every products on our side."
    },
    {
      icon: <Award className="h-8 w-8 text-blue-600" />,
      title: "Wide Selection",
      description: "We offer over 1000+ OEM-style quality auto parts to cover all your repair needs."
    },
    {
      icon: <Headphones className="h-8 w-8 text-blue-600" />,
      title: "Expert Advice",
      description: "Our expert team will guide you to build your dream car without compromising the quality."
    },
    {
      icon: <Lock className="h-8 w-8 text-blue-600" />,
      title: "100% Secure Payment",
      description: "We use advanced encryption to keep your payment and personal data safe and secure."
    },
    {
      icon: <Shield className="h-8 w-8 text-blue-600" />,
      title: "100% Genuine Parts",
      description: "Feel confident when buying from us as our parts are all backed with a min. of 1-year warranty."
    }
  ];

  const brands = [
    { name: "Profender", logo: "https://autobacsindia.com/wp-content/uploads/2024/10/profender-logo-1.png.webp" },
    { name: "Bushranger", logo: "https://autobacsindia.com/wp-content/uploads/2024/10/bushranger.png.webp" },
    { name: "Ironman", logo: "https://autobacsindia.com/wp-content/uploads/2024/10/ironman.png.webp" },
    { name: "Dr. Nano", logo: "https://autobacsindia.com/wp-content/uploads/2024/10/dr-nano-logo-1.png.webp" },
    { name: "Lightforce", logo: "https://autobacsindia.com/wp-content/uploads/2024/10/lightforce-logo-1.png.webp" },
    { name: "Option", logo: "https://autobacsindia.com/wp-content/uploads/2024/10/option-logo-1.png.webp" }
  ];

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-r from-gray-900 to-gray-700 text-white">
        <div className="absolute inset-0">
          <Image
            src="https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2000&q=80"
            alt="Automotive background"
            layout="fill"
            objectFit="cover"
            className="opacity-30"
          />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32">
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">About Autobacs India</h1>
            <p className="text-xl max-w-3xl mx-auto">
              Premium automotive parts and accessories since 2010
            </p>
          </div>
        </div>
      </section>

      {/* Company Overview */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Who We Are</h2>
            <div className="w-24 h-1 bg-blue-600 mx-auto mb-8"></div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-lg text-gray-600 mb-6">
                We are importers and suppliers of unique premium imported high-quality aftermarket automotive parts and accessories.
              </p>
              <p className="text-gray-600 mb-6">
                We specialize in providing outstanding customization solutions to address the changing demands of automotive enthusiasts who seek to enhance their driving experience. From high-end off-road modifications—like converting a Ford Endeavour into an F150, or upgrading a BMW F10 to an F90 M5—to state-of-the-art facelifts and enhancements for various vehicles, our services appeal to a clientele with a keen appreciation for quality and innovation.
              </p>
              <p className="text-gray-600">
                We deliver a realm of cutting-edge automotive technology directly to the people's doorsteps supported by strong technical assistance, unique promotions and dependable after-sales service. Our team is passionate about propelling the industry forward; continually sourcing the finest products globally to enable our customers to achieve their dream car transformations.
              </p>
            </div>
            <div className="relative h-96 rounded-lg overflow-hidden">
              <Image
                src="https://images.unsplash.com/photo-1542362567-b07e54358753?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=800&q=80"
                alt="Autobacs India Team"
                layout="fill"
                objectFit="cover"
                className="rounded-lg"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Our Story */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Story</h2>
            <div className="w-24 h-1 bg-blue-600 mx-auto mb-8"></div>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              Our journey began with an unwavering passion for creating automotive marvels that transcend ordinary imagination.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="bg-white p-8 rounded-lg shadow-md">
              <h3 className="text-xl font-semibold mb-4">Our Journey</h3>
              <p className="text-gray-600 mb-4">
                As leaders in the industry, we have set out to redefine the landscape of Indian automobiles; this endeavor requires a seamless blend of innovation, design and engineering.
              </p>
              <p className="text-gray-600">
                With over 15 years in the market, we've grown from a small specialized parts supplier to a premier destination for automotive enthusiasts seeking premium modifications and enhancements.
              </p>
            </div>
            
            <div className="bg-white p-8 rounded-lg shadow-md">
              <h3 className="text-xl font-semibold mb-4">Our Vision</h3>
              <p className="text-gray-600">
                We believe that the future of mobility lies in our hands. Our commitment remains steadfast as we continue to push boundaries and introduce innovative solutions to the Indian automotive market.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Our Approach */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Approach</h2>
            <div className="w-24 h-1 bg-blue-600 mx-auto mb-8"></div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-3">User-First Philosophy</h3>
              <p className="text-gray-600">
                Our platform provides a smooth shopping experience through a carefully curated selection of top-tier automotive products.
              </p>
            </div>
            
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-3">Transparency & Security</h3>
              <p className="text-gray-600">
                Transparency in pricing is critical, coupled with the highest standards of data security to ensure trust with every transaction.
              </p>
            </div>
            
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-3">Sustainability</h3>
              <p className="text-gray-600">
                We are committed to sustainability by integrating eco-conscious practices from product selection to packaging.
              </p>
            </div>
            
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-3">Community Collaboration</h3>
              <p className="text-gray-600">
                Continuous feedback and collaboration with our automotive community drive our platform's evolution and excellence.
              </p>
            </div>
            
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-3">Dedicated Support</h3>
              <p className="text-gray-600">
                Our dedicated customer service is always present, striving for utmost satisfaction.
              </p>
            </div>
            
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-3">Innovation</h3>
              <p className="text-gray-600">
                We continuously source the finest products globally to enable our customers to achieve their dream car transformations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Statistics Section */}
      <section className="py-16 bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-5xl font-bold mb-2">15+</div>
              <div className="text-xl">Years in the Market</div>
            </div>
            <div>
              <div className="text-5xl font-bold mb-2">1000+</div>
              <div className="text-xl">Different Parts</div>
            </div>
            <div>
              <div className="text-5xl font-bold mb-2">50K+</div>
              <div className="text-xl">Happy Clients</div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Why Choose Us</h2>
            <div className="w-24 h-1 bg-blue-600 mx-auto mb-8"></div>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              Reasons to cooperate with us
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="bg-gray-50 p-8 rounded-lg hover:shadow-lg transition-shadow">
                <div className="mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Information */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Have Questions?</h2>
            <div className="w-24 h-1 bg-blue-600 mx-auto mb-8"></div>
            <p className="text-lg text-gray-600 mb-8">
              We're here to help!
            </p>
          </div>
          
          <div className="text-center">
            <div className="flex flex-col sm:flex-row justify-center gap-6 mb-8">
              <a href="tel:+919895257905" className="text-2xl font-semibold text-blue-600 hover:text-blue-800">
                +91 9895257905
              </a>
              <a href="tel:+919895502139" className="text-2xl font-semibold text-blue-600 hover:text-blue-800">
                +91 9895502139
              </a>
            </div>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Our customer service team is available Monday to Saturday, 9:00 AM to 6:00 PM IST.
            </p>
          </div>
        </div>
      </section>

      {/* Premium Brands */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Premium Brands</h2>
            <div className="w-24 h-1 bg-blue-600 mx-auto mb-8"></div>
            <p className="text-lg text-gray-600">
              Most valuable brands are available
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
            {brands.map((brand, index) => (
              <div key={index} className="flex items-center justify-center p-4 bg-gray-50 rounded-lg">
                <div className="relative h-16 w-full flex items-center justify-center">
                  <Image
                    src={brand.logo}
                    alt={brand.name}
                    layout="fill"
                    objectFit="contain"
                    className="grayscale hover:grayscale-0 transition-all"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}