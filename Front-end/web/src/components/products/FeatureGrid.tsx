'use client';

import { Shield, Wrench, Droplets, Thermometer, Zap, Gauge } from 'lucide-react';

interface FeatureGridProps {
  features?: string[];
}

const iconMap: Record<string, React.ReactNode> = {
  'shield': <Shield className="w-6 h-6" />,
  'wrench': <Wrench className="w-6 h-6" />,
  'droplets': <Droplets className="w-6 h-6" />,
  'thermometer': <Thermometer className="w-6 h-6" />,
  'zap': <Zap className="w-6 h-6" />,
  'gauge': <Gauge className="w-6 h-6" />,
};

export default function FeatureGrid({ features }: FeatureGridProps) {
  if (!features || features.length === 0) {
    return null;
  }

  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Key Features</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {features.map((feature, index) => {
          const iconKey = Object.keys(iconMap)[index % Object.keys(iconMap).length];
          return (
            <div
              key={index}
              className="flex flex-col items-center text-center p-4 bg-gray-50 rounded-xl hover:bg-blue-50 transition-colors"
            >
              <div className="text-blue-600 mb-2">
                {iconMap[iconKey]}
              </div>
              <span className="text-sm font-medium text-gray-900">
                {feature}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
