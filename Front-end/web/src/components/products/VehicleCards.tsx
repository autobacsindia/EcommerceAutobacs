'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

interface Vehicle {
  make: string;
  model: string;
  slug?: string;
  image?: { url?: string; alt?: string };
}

// Storefront route for a vehicle's parts. Prefer the admin-set slug; otherwise
// derive the same `make-model` slug the vehicle menu builds so the link still works.
const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const vehicleHref = (vehicle: Vehicle) =>
  `/model/${vehicle.slug || `${slugify(vehicle.make)}-${slugify(vehicle.model)}`}`;

interface VehicleCardsProps {
  vehicles?: Vehicle[];
  isDark?: boolean;
}

export default function VehicleCards({ vehicles, isDark = true }: VehicleCardsProps) {
  if (!vehicles || vehicles.length === 0) {
    return (
      <section className="py-16">
        <div className={`text-center ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
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
            className={`${isDark ? 'bg-obsidian-raised/50 border-hairline hover:border-orange-500/50' : 'bg-obsidian border-hairline hover:border-orange-500'} border rounded-xl overflow-hidden transition-colors group`}
          >
            {/* Vehicle Image */}
            <div className={`relative h-48 ${isDark ? 'bg-obsidian-raised' : 'bg-obsidian-raised'} overflow-hidden`}>
              <Image
                src={vehicle.image?.url || '/placeholder-product.jpg'}
                alt={vehicle.image?.alt || `${vehicle.make} ${vehicle.model}`}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-110"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
              <div className={`absolute inset-0 ${isDark ? 'bg-linear-to-t from-obsidian' : 'bg-linear-to-t from-obsidian'} to-transparent`} />
              
              {/* Compatibility Badge */}
              <div className="absolute top-4 right-4 bg-green-500/90 backdrop-blur-sm text-ink px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                <Check className="w-3 h-3" />
                Compatible
              </div>
            </div>

            {/* Vehicle Info */}
            <div className="p-5 space-y-3">
              <h4 className={`font-bold text-lg ${isDark ? 'text-ink' : 'text-ink'}`}>
                {vehicle.make} {vehicle.model}
              </h4>

              <Link
                href={vehicleHref(vehicle)}
                className={`block w-full mt-4 text-center ${isDark ? 'bg-obsidian-raised hover:bg-orange-500' : 'bg-obsidian-raised hover:bg-orange-500 hover:text-ink'} text-ink font-semibold py-2 px-4 rounded-lg transition-colors text-sm`}
              >
                Shop Parts for This Vehicle
              </Link>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
