'use client';

import { Truck, Shield, Headphones, CheckCircle, ShoppingCart, Lock, Users, Award } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export default function AboutUsPage() {
  const features = [
    { icon: <CheckCircle className="h-8 w-8 text-gold" />, title: 'Guaranteed Fitted', description: 'Today our catalogue includes more than 1000 of different parts for motor cars of different brands.' },
    { icon: <Truck className="h-8 w-8 text-gold" />, title: 'Hassle Free Shipping', description: "Top-notch aftermarket car spare parts supplied from only the industry's leading manufacturers." },
    { icon: <ShoppingCart className="h-8 w-8 text-gold" />, title: 'Bulk Order Availability', description: 'We also provide bulk order for each and every products on our side.' },
    { icon: <Award className="h-8 w-8 text-gold" />, title: 'Wide Selection', description: 'We offer over 1000+ OEM-style quality auto parts to cover all your repair needs.' },
    { icon: <Headphones className="h-8 w-8 text-gold" />, title: 'Expert Advice', description: 'Our expert team will guide you to build your dream car without compromising the quality.' },
    { icon: <Lock className="h-8 w-8 text-gold" />, title: '100% Secure Payment', description: 'We use advanced encryption to keep your payment and personal data safe and secure.' },
    { icon: <Shield className="h-8 w-8 text-gold" />, title: '100% Genuine Parts', description: 'Feel confident when buying from us as our parts are all backed with a min. of 1-year warranty.' },
  ];

  const brands = [
    { name: 'Profender', logo: 'https://res.cloudinary.com/dhwxtl6l8/image/upload/v1781506399/autobacs/brand-logos/profender-logo-1.png.webp' },
    { name: 'Bushranger', logo: 'https://res.cloudinary.com/dhwxtl6l8/image/upload/v1781506401/autobacs/brand-logos/bushranger.png.webp' },
    { name: 'Ironman', logo: 'https://res.cloudinary.com/dhwxtl6l8/image/upload/v1781506403/autobacs/brand-logos/ironman.png.webp' },
    { name: 'Dr. Nano', logo: 'https://res.cloudinary.com/dhwxtl6l8/image/upload/v1781506405/autobacs/brand-logos/dr-nano-logo-1.png.webp' },
    { name: 'Lightforce', logo: 'https://res.cloudinary.com/dhwxtl6l8/image/upload/v1781506407/autobacs/brand-logos/lightforce-logo-1.png.webp' },
    { name: 'Option', logo: 'https://res.cloudinary.com/dhwxtl6l8/image/upload/v1781506408/autobacs/brand-logos/option-logo-1.png.webp' },
  ];

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <section className="relative bg-obsidian-deep">
        <div className="absolute inset-0">
          <Image
            src="https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1400&q=60&fm=webp"
            alt="Automotive background"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-20"
          />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32 text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-3">Our Story</p>
          <h1 className="text-5xl font-display font-light text-ink tracking-[-0.01em] mb-6">About Autobacs India</h1>
          <p className="text-ink/70 font-display text-xl max-w-2xl mx-auto">
            Premium automotive parts and accessories since 2010
          </p>
        </div>
      </section>

      {/* Company Overview */}
      <section className="py-16 bg-obsidian border-y border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Company</p>
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-4">Who We Are</h2>
            <div className="w-16 h-0.5 bg-gold mx-auto" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-ink/70 font-display text-lg mb-4 leading-relaxed">
                We are importers and suppliers of unique premium imported high-quality aftermarket automotive parts and accessories.
              </p>
              <p className="text-ink/70 font-display mb-4 leading-relaxed">
                We specialize in providing outstanding customization solutions to address the changing demands of automotive enthusiasts who seek to enhance their driving experience. From high-end off-road modifications to state-of-the-art facelifts and enhancements for various vehicles, our services appeal to a clientele with a keen appreciation for quality and innovation.
              </p>
              <p className="text-ink/70 font-display leading-relaxed">
                We deliver a realm of cutting-edge automotive technology directly to the people&apos;s doorsteps supported by strong technical assistance, unique promotions and dependable after-sales service.
              </p>
            </div>
            <div className="relative h-80 rounded-sm overflow-hidden border border-hairline">
              <Image
                src="https://images.unsplash.com/photo-1542362567-b07e54358753?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                alt="Autobacs India Team"
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Our Story */}
      <section className="py-16 bg-obsidian-deep">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Background</p>
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-4">Our Story</h2>
            <div className="w-16 h-0.5 bg-gold mx-auto mb-6" />
            <p className="text-ink/70 font-display max-w-2xl mx-auto">
              Our journey began with an unwavering passion for creating automotive marvels that transcend ordinary imagination.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-obsidian border border-hairline rounded-sm p-8">
              <h3 className="font-display font-light text-ink tracking-[-0.01em] mb-4">Our Journey</h3>
              <p className="text-ink/70 font-display mb-3 leading-relaxed">
                As leaders in the industry, we have set out to redefine the landscape of Indian automobiles; this endeavor requires a seamless blend of innovation, design and engineering.
              </p>
              <p className="text-ink/70 font-display leading-relaxed">
                With over 15 years in the market, we&apos;ve grown from a small specialized parts supplier to a premier destination for automotive enthusiasts seeking premium modifications and enhancements.
              </p>
            </div>
            <div className="bg-obsidian border border-hairline rounded-sm p-8">
              <h3 className="font-display font-light text-ink tracking-[-0.01em] mb-4">Our Vision</h3>
              <p className="text-ink/70 font-display leading-relaxed">
                We believe that the future of mobility lies in our hands. Our commitment remains steadfast as we continue to push boundaries and introduce innovative solutions to the Indian automotive market.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Approach */}
      <section className="py-16 bg-obsidian border-y border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Philosophy</p>
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-4">Our Approach</h2>
            <div className="w-16 h-0.5 bg-gold mx-auto" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { t: 'User-First Philosophy', d: 'Our platform provides a smooth shopping experience through a carefully curated selection of top-tier automotive products.' },
              { t: 'Transparency & Security', d: 'Transparency in pricing is critical, coupled with the highest standards of data security to ensure trust with every transaction.' },
              { t: 'Sustainability', d: 'We are committed to sustainability by integrating eco-conscious practices from product selection to packaging.' },
              { t: 'Community Collaboration', d: "Continuous feedback and collaboration with our automotive community drive our platform's evolution and excellence." },
              { t: 'Dedicated Support', d: 'Our dedicated customer service is always present, striving for utmost satisfaction.' },
              { t: 'Innovation', d: 'We continuously source the finest products globally to enable our customers to achieve their dream car transformations.' },
            ].map((item, i) => (
              <div key={i} className="bg-obsidian-raised border border-hairline rounded-sm p-6">
                <h3 className="font-display font-light text-ink tracking-[-0.01em] text-sm mb-2">{item.t}</h3>
                <p className="text-ink/70 font-display text-sm leading-relaxed">{item.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 bg-gold">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {[{ n: '15+', l: 'Years in the Market' }, { n: '1000+', l: 'Different Parts' }, { n: '50K+', l: 'Happy Clients' }].map((s, i) => (
              <div key={i}>
                <div className="text-5xl font-display font-bold text-ink mb-2">{s.n}</div>
                <div className="text-ink/80 font-display uppercase tracking-widest text-sm">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-16 bg-obsidian-deep">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Reasons</p>
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-4">Why Choose Us</h2>
            <div className="w-16 h-0.5 bg-gold mx-auto" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <div key={index} className="bg-obsidian border border-hairline hover:border-gold rounded-sm p-8 transition-colors">
                <div className="mb-4">{feature.icon}</div>
                <h3 className="font-display font-light text-ink tracking-[-0.01em] mb-2">{feature.title}</h3>
                <p className="text-ink/70 font-display text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16 bg-obsidian border-t border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Get In Touch</p>
          <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-8">Have Questions?</h2>
          <div className="flex flex-col sm:flex-row justify-center gap-6 mb-6">
            <a href="tel:+919895257905" className="text-2xl font-display font-bold text-gold hover:text-ink transition-colors">+91 9895257905</a>
            <a href="tel:+919895502139" className="text-2xl font-display font-bold text-gold hover:text-ink transition-colors">+91 9895502139</a>
          </div>
          <p className="text-ink/70 font-display text-sm">Our customer service team is available Monday to Saturday, 10:00 AM to 6:00 PM IST.</p>
        </div>
      </section>

      {/* Brands */}
      <section className="py-16 bg-obsidian-deep border-t border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Partners</p>
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-4">Premium Brands</h2>
            <div className="w-16 h-0.5 bg-gold mx-auto" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
            {brands.map((brand, index) => (
              <div key={index} className="flex items-center justify-center p-4 bg-white border border-hairline rounded-sm hover:border-gold hover:shadow-[0_0_20px_rgba(197,160,89,0.35)] transition-all">
                <div className="relative h-14 w-full flex items-center justify-center">
                  <Image src={brand.logo} alt={brand.name} fill className="object-contain transition-transform hover:scale-105" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
