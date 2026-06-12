'use client';

import { CloudRain, Sun, Mountain, Shield } from 'lucide-react';

interface WhyChooseSectionProps {
  whyChoose?: string[];
}

export default function WhyChooseSection({ whyChoose }: WhyChooseSectionProps) {
  const indianConditions = [
    {
      icon: <CloudRain className="w-8 h-8" />,
      title: "Monsoon Resistant",
      description: "Engineered to withstand heavy rains and high humidity during Indian monsoon season"
    },
    {
      icon: <Sun className="w-8 h-8" />,
      title: "Heat & Dust Proof",
      description: "Tested for extreme temperatures (45°C+) and dusty conditions across Indian highways"
    },
    {
      icon: <Mountain className="w-8 h-8" />,
      title: "Off-Road Ready",
      description: "Built for rough terrain, speed breakers, and challenging Indian road conditions"
    },
    {
      icon: <Shield className="w-8 h-8" />,
      title: "Long-Lasting Durability",
      description: "Premium materials and coatings ensure 5+ years of reliable performance"
    }
  ];

  return (
    <section className="bg-linear-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 md:p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
        Why Choose This Product?
      </h2>
      <p className="text-gray-600 text-center mb-8 max-w-2xl mx-auto">
        Specifically designed and tested for Indian driving conditions
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {indianConditions.map((condition, index) => (
          <div
            key={index}
            className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="text-blue-600 mb-4">
              {condition.icon}
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {condition.title}
            </h3>
            <p className="text-gray-700 text-sm leading-relaxed">
              {condition.description}
            </p>
          </div>
        ))}
      </div>

      {whyChoose && whyChoose.length > 0 && (
        <div className="mt-8 pt-6 border-t border-blue-200">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Product Highlights</h3>
          <ul className="space-y-2">
            {whyChoose.map((point, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">✓</span>
                <span className="text-gray-700">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
