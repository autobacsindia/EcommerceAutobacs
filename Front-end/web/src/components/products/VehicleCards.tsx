'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

interface Vehicle {
  make: string;
  model: string;
  year: string;
  variant: string;
}

interface VehicleCardsProps {
  vehicles?: Vehicle[];
}

export default function VehicleCards({ vehicles }: VehicleCardsProps) {
  if (!vehicles || vehicles.length === 0) {
    return (
      <section className="py-16">
        <div className="text-center text-zinc-400">
          <p>Universal fitment or specific compatibility data not available.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {vehicles.map((vehicle, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ scale: 1.02, y: -4 }}
            className="bg-zinc-800/50 border border-zinc-700 rounded-xl overflow-hidden hover:border-orange-500/50 transition-colors group"
          >
            {/* Vehicle Image */}
            <div className="relative h-48 bg-zinc-700 overflow-hidden">
              <Image
                src="/placeholder-product.jpg"
                alt={`${vehicle.make} ${vehicle.model}`}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-110"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent" />
              
              {/* Compatibility Badge */}
              <div className="absolute top-4 right-4 bg-green-500/90 backdrop-blur-sm text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                <Check className="w-3 h-3" />
                Compatible
              </div>
            </div>

            {/* Vehicle Info */}
            <div className="p-5 space-y-3">
              <h4 className="text-white font-bold text-lg">
                {vehicle.make} {vehicle.model}
              </h4>
              <div className="flex items-center gap-3 text-zinc-400 text-sm">
                <span>{vehicle.year}</span>
                <span>•</span>
                <span>{vehicle.variant}</span>
              </div>
              
              <button className="w-full mt-4 bg-zinc-700 hover:bg-orange-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm">
                Shop Parts for This Vehicle
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
