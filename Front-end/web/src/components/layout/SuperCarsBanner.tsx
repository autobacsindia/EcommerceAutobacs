'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';

export default function SuperCarsBanner() {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <section className="relative w-full overflow-hidden bg-black">
      <div className="relative w-full h-[500px] md:h-[600px] lg:h-[700px]">
        {/* Background Image with Parallax Effect */}
        <div 
          className={`absolute inset-0 transition-transform duration-700 ease-out ${
            isHovered ? 'scale-110' : 'scale-105'
          }`}
        >
          <Image
            src="https://res.cloudinary.com/dhwxtl6l8/image/upload/v1781506411/autobacs/banners/liberty-walk-nissan-gt-r-r35.jpg"
            alt="Liberty Walk Nissan GT-R R35 - Premium Series"
            fill
            className="object-cover object-center"
            priority
            sizes="100vw"
          />
          {/* Gradient Overlay for Better Text Visibility */}
          <div className="absolute inset-0 bg-linear-to-r from-black/80 via-black/50 to-transparent" />
          
          {/* Animated Shine Effect */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/10 to-transparent transform -skew-x-12 animate-shine" />
          </div>
        </div>

        {/* Content Container */}
        <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-center h-full py-16">
            {/* Small Label with Slide-in Animation */}
            <div className="mb-4 animate-slide-in-left">
              <span className="inline-block px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-xs md:text-sm font-medium uppercase tracking-wider">
                Complete Solution
              </span>
            </div>

            {/* Main Heading with Staggered Animation */}
            <h2 className="text-4xl md:text-5xl lg:text-7xl font-bold text-white mb-4 animate-slide-in-left animation-delay-100">
              Premium Series
            </h2>

            {/* Subheading with Gradient Text */}
            <p className="text-2xl md:text-3xl lg:text-5xl font-semibold mb-8 animate-slide-in-left animation-delay-200">
              <span className="bg-linear-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
                Give New Look
              </span>
            </p>

            <p className="text-xl md:text-2xl lg:text-4xl font-light text-white/90 mb-12 animate-slide-in-left animation-delay-300">
              For Your Super Cars
            </p>

            {/* CTA Button with Hover Effects */}
            <div className="animate-slide-in-left animation-delay-400">
              <Link
                href="/super-cars"
                className="group inline-flex items-center gap-3 px-8 py-4 bg-white text-black font-semibold text-lg rounded-full hover:bg-linear-to-r hover:from-orange-500 hover:to-red-600 hover:text-white transition-all duration-300 shadow-lg hover:shadow-2xl hover:scale-105"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
              >
                <span>Contact For More</span>
                <ArrowRight className="h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
              </Link>
            </div>

            {/* Floating Elements */}
            <div className="absolute bottom-8 right-8 hidden lg:block animate-float">
              <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 shadow-xl">
                <p className="text-white text-sm font-medium mb-1">Premium Customization</p>
                <p className="text-white/70 text-xs">Liberty Walk & More</p>
              </div>
            </div>
          </div>
        </div>

        {/* Animated Border Lines */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-linear-to-r from-transparent via-white/50 to-transparent animate-pulse" />
      </div>

      {/* Custom CSS for Animations */}
      <style jsx>{`
        @keyframes slideInLeft {
          from {
            opacity: 0;
            transform: translateX(-50px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes shine {
          0% {
            transform: translateX(-100%) skewX(-12deg);
          }
          100% {
            transform: translateX(200%) skewX(-12deg);
          }
        }

        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-20px);
          }
        }

        .animate-slide-in-left {
          animation: slideInLeft 0.8s ease-out forwards;
        }

        .animation-delay-100 {
          animation-delay: 0.1s;
          opacity: 0;
        }

        .animation-delay-200 {
          animation-delay: 0.2s;
          opacity: 0;
        }

        .animation-delay-300 {
          animation-delay: 0.3s;
          opacity: 0;
        }

        .animation-delay-400 {
          animation-delay: 0.4s;
          opacity: 0;
        }

        .animate-shine {
          animation: shine 3s ease-in-out infinite;
        }

        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>
    </section>
  );
}
