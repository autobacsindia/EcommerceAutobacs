'use client';

import { motion } from 'framer-motion';
import { Wrench, Shield, Mountain, Clock, Package } from 'lucide-react';

interface ActionStripProps {
  features?: Array<{
    icon?: string;
    text: string;
    subtext: string;
  }>;
  isDark?: boolean;
}

const defaultFeatures = [
  { icon: 'wrench', text: 'No Drilling Required', subtext: 'Easy DIY Install' },
  { icon: 'shield', text: 'Rust Proof', subtext: 'All-Weather Protection' },
  { icon: 'mountain', text: 'Off-Road Ready', subtext: 'Extreme Durability' },
  { icon: 'clock', text: '2-Year Warranty', subtext: 'Peace of Mind' },
  { icon: 'package', text: 'Complete Kit', subtext: 'Everything Included' }
];

const iconMap: Record<string, React.ReactNode> = {
  'wrench': <Wrench className="w-8 h-8" />,
  'shield': <Shield className="w-8 h-8" />,
  'mountain': <Mountain className="w-8 h-8" />,
  'clock': <Clock className="w-8 h-8" />,
  'package': <Package className="w-8 h-8" />,
};

export default function ActionStrip({ features, isDark = true }: ActionStripProps) {
  const displayFeatures = features && features.length > 0 ? features : defaultFeatures;

  return (
    <section className={`${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-200'} border-y py-12`}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {displayFeatures.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.05, y: -4 }}
              className="flex flex-col items-center text-center p-4 cursor-default"
            >
              <div className="text-orange-500 mb-4">
                {iconMap[feature.icon || 'shield']}
              </div>
              <p className={`${isDark ? 'text-white' : 'text-gray-900'} font-bold mb-2`}>{feature.text}</p>
              <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>{feature.subtext}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
