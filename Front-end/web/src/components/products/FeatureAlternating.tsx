'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';

interface Feature {
  title: string;
  description: string;
  image?: string;
}

interface FeatureAlternatingProps {
  features?: Feature[];
}

const defaultFeatures: Feature[] = [
  {
    title: 'Engineered for Indian Roads',
    description: 'Specifically designed to handle the unique challenges of Indian terrain - from potholed city streets to rugged mountain passes. Built with reinforced materials that withstand extreme vibrations and impact.',
    image: '/placeholder-product.jpg'
  },
  {
    title: 'Monsoon-Proof Construction',
    description: 'IP67 waterproof rating ensures reliable performance during heavy rains and flooding. Anti-corrosion coating protects against humidity and water damage throughout the monsoon season.',
    image: '/placeholder-product.jpg'
  },
  {
    title: 'Extreme Temperature Resistant',
    description: 'Tested for performance in temperatures ranging from -10°C to 50°C. Whether you\'re driving through Rajasthan\'s scorching summers or Kashmir\'s freezing winters, this product delivers consistent performance.',
    image: '/placeholder-product.jpg'
  }
];

export default function FeatureAlternating({ features }: FeatureAlternatingProps) {
  const displayFeatures = features && features.length > 0 ? features : defaultFeatures;

  return (
    <section className="py-24 space-y-24">
      {displayFeatures.map((feature, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className={`grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center ${
            index % 2 === 1 ? 'lg:flex-row-reverse' : ''
          }`}
        >
          {/* Image Side */}
          <div className={`relative h-[400px] lg:h-[500px] rounded-2xl overflow-hidden shadow-2xl ${
            index % 2 === 1 ? 'lg:order-2' : ''
          }`}>
            <Image
              src={feature.image || '/placeholder-product.jpg'}
              alt={feature.title}
              fill
              className="object-cover transition-transform duration-700 hover:scale-105"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/50 to-transparent" />
          </div>

          {/* Text Side */}
          <div className={`space-y-6 ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
            <h3 className="text-4xl lg:text-5xl font-black text-white leading-tight">
              {feature.title}
            </h3>
            <p className="text-zinc-400 text-lg lg:text-xl leading-relaxed">
              {feature.description}
            </p>
            <div className="w-24 h-1 bg-orange-500 rounded-full" />
          </div>
        </motion.div>
      ))}
    </section>
  );
}
