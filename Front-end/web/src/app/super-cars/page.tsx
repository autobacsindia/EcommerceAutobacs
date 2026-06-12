'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Zap, Wind, Disc, Gauge, Activity, Settings, Armchair, CircleDashed, Move3d } from 'lucide-react';

const upgrades = [
  {
    title: "Performance Exhaust Systems",
    purpose: "Improve engine efficiency, boost horsepower, and create a unique exhaust sound.",
    features: "Made from lightweight materials such as titanium or stainless steel to minimize weight and enhance corrosion resistance.",
    icon: Wind
  },
  {
    title: "Carbon Fiber Body Panels",
    purpose: "Decrease total vehicle weight to enhance speed and handling.",
    features: "High-strength, lightweight carbon fiber components, including hoods, spoilers, and diffusers.",
    icon: Move3d
  },
  {
    title: "High-Performance Brake Kits",
    purpose: "Deliver enhanced stopping power crucial for high-speed driving.",
    features: "Incorporates larger rotors, multi-piston calipers, and high-friction brake pads engineered to endure extreme conditions.",
    icon: Disc
  },
  {
    title: "Advanced Suspension Systems",
    purpose: "Enhance handling, stability, and ride comfort.",
    features: "Adjustable coilovers, active suspension components, and performance bushings designed for precise control.",
    icon: Activity
  },
  {
    title: "Engine Tuning and ECU Remapping",
    purpose: "Enhance engine performance to improve power output and efficiency.",
    features: "Tailored software modifications to the Engine Control Unit (ECU) to optimize parameters such as fuel injection and ignition timing.",
    icon: Settings
  },
  {
    title: "Aerodynamic Improvements",
    purpose: "Enhance airflow, decrease drag, and elevate downforce for improved stability at high speeds.",
    features: "Components like front splitters, rear diffusers, and side skirts designed to improve aerodynamic efficiency.",
    icon: Wind
  },
  {
    title: "Interior Upgrades",
    purpose: "Improve driver comfort and vehicle appearance.",
    features: "Customizable options, including carbon fiber trim, Alcantara upholstery, and advanced infotainment systems.",
    icon: Armchair
  },
  {
    title: "Lightweight Alloy Wheels",
    purpose: "Decrease unsprung weight to enhance acceleration, braking, and handling.",
    features: "Forged aluminum or magnesium wheels engineered for enhanced strength and reduced weight.",
    icon: CircleDashed
  },
  {
    title: "High-Performance Tires",
    purpose: "To deliver optimal grip and handling characteristics tailored for supercar performance.",
    features: "Rubber compounds and tread patterns specifically formulated for high-speed performance.",
    icon: CircleDashed
  },
  {
    title: "Diagnostic and Monitoring Tools",
    purpose: "Enable owners to monitor vehicle performance and detect potential issues.",
    features: "Advanced diagnostic scanners and telemetry systems that are compatible with supercar electronics.",
    icon: Gauge
  }
];

export default function SuperCarsPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Hero Section */}
      <section className="relative min-h-[80vh] flex items-center justify-center overflow-hidden">
        {/* Background with overlay */}
        <div className="absolute inset-0 bg-[url('/images/vehicles/A240553_web_2880-scaled.jpg')] bg-cover bg-center bg-no-repeat">
           <div className="absolute inset-0 bg-linear-to-b from-black/80 via-black/60 to-black"></div>
        </div>
        
        {/* Animated grid background effect */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:100px_100px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_70%)]"></div>

        <div className="relative container mx-auto px-4 py-20 text-center z-10">
          <div className="animate-slide-up-enter">
            <span className="inline-block px-4 py-1 mb-6 border border-red-500/50 rounded-full bg-red-500/10 text-red-400 text-sm font-tracking-wider uppercase">
              ROAVION - Powered by AutoBacs India
            </span>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 bg-linear-to-r from-white via-gray-200 to-gray-500 bg-clip-text text-transparent">
              DISCOVER A NEW IMMERSIVE EXPERIENCE
              <br />
              <span className="text-2xl md:text-4xl lg:text-5xl font-light text-gray-400 mt-2 block">
                BUILT AROUND YOUR SUPERCAR
              </span>
            </h1>
            
            <p className="text-lg md:text-xl text-gray-300 max-w-4xl mx-auto mb-10 leading-relaxed animation-delay-100 animate-slide-up-enter opacity-0">
              YOU CAN ENJOY THE BEAUTY OF YOUR CAR EVEN WHEN YOU DON’T HIT THE ROAD.
            </p>
            
            <p className="text-gray-400 max-w-3xl mx-auto mb-12 text-base md:text-lg animation-delay-200 animate-slide-up-enter opacity-0">
              Owning a supercar isn’t just about the ride—it’s about making a statement. With AUTOBACS INDIA’s cutting-edge concepts, you can now display your prized vehicle in a space as remarkable as the car itself, turning storage into a masterpiece of style.
            </p>

            <div className="animation-delay-300 animate-slide-up-enter opacity-0">
              <Link 
                href="/contact" 
                className="inline-flex items-center gap-2 px-8 py-4 bg-linear-to-r from-red-600 to-red-800 rounded-full text-white font-semibold tracking-wide hover:shadow-[0_0_20px_rgba(220,38,38,0.5)] transition-all duration-300 hover:scale-105"
              >
                Start Your Journey
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Upgrades Section */}
      <section className="py-20 bg-zinc-900">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16 animate-fade-in-slow">
            <h2 className="text-3xl md:text-5xl font-bold mb-6 text-white">
              Redefining Speed
            </h2>
            <p className="text-xl text-red-500 font-medium mb-4">
              Essential Upgrades for Supercar Enthusiasts
            </p>
            <p className="text-gray-400 max-w-3xl mx-auto">
              Supercars exemplify the highest standards of automotive engineering, integrating outstanding performance with advanced technology. To sustain and improve the performance of these high-performance vehicles, a variety of specialized automotive parts is necessary.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {upgrades.map((upgrade, index) => (
              <div
                key={index}
                className="group bg-zinc-800/50 border border-zinc-700/50 p-8 rounded-2xl hover:bg-zinc-800 hover:border-red-500/30 transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
              >
                <div className="mb-6 inline-flex p-3 rounded-lg bg-red-500/10 text-red-500 group-hover:bg-red-500 group-hover:text-white transition-colors duration-300">
                  <upgrade.icon className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-white mb-4 group-hover:text-red-400 transition-colors">
                  {upgrade.title}
                </h3>
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Purpose</span>
                    <p className="text-gray-300 mt-1">{upgrade.purpose}</p>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Features</span>
                    <p className="text-gray-400 mt-1 text-sm">{upgrade.features}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-r from-red-900 to-black opacity-50"></div>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <h2 className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-linear-to-b from-white to-gray-400 mb-8 tracking-tight animate-fade-in-slow">
            SKY IS THE LIMIT
          </h2>
          <div className="hover:scale-105 transition-transform duration-300 inline-block">
            <Link 
              href="/contact"
              className="inline-flex items-center gap-3 px-10 py-5 bg-white text-black text-lg font-bold rounded-full hover:bg-gray-200 transition-colors shadow-2xl"
            >
              Contact us for Expert Suggestions
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
