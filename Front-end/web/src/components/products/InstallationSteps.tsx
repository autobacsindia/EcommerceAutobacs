'use client';

import { motion } from 'framer-motion';
import { Wrench, Settings, CheckCircle } from 'lucide-react';

interface InstallationStepsProps {
  steps?: Array<{
    title: string;
    description: string;
  }>;
}

const defaultSteps = [
  {
    title: 'Unpack & Inspect',
    description: 'Remove all components from packaging. Verify you have all parts listed in the package contents. Check for any shipping damage.'
  },
  {
    title: 'Mount the Bracket',
    description: 'Position the mounting bracket at your desired location. No drilling required - use existing bolt holes or clamp system for secure attachment.'
  },
  {
    title: 'Connect Wiring',
    description: 'Connect the wiring harness to your vehicle\'s electrical system. Follow the included wiring diagram. Use waterproof connectors for outdoor installations.'
  },
  {
    title: 'Test & Adjust',
    description: 'Turn on the lights and test all functions. Adjust the angle for optimal beam pattern. Ensure secure mounting before off-road use.'
  },
  {
    title: 'Final Check',
    description: 'Double-check all bolts and connections. Verify waterproof seals are intact. Take a short test drive to ensure everything is secure.'
  }
];

const stepIcons = [
  <Wrench className="w-6 h-6" />,
  <Settings className="w-6 h-6" />,
  <Settings className="w-6 h-6" />,
  <Settings className="w-6 h-6" />,
  <CheckCircle className="w-6 h-6" />
];

export default function InstallationSteps({ steps }: InstallationStepsProps) {
  const displaySteps = steps && steps.length > 0 ? steps : defaultSteps;

  return (
    <section className="py-16">
      <div className="text-center mb-12">
        <h2 className="text-4xl lg:text-5xl font-black text-white mb-4">
          Easy DIY Installation
        </h2>
        <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
          Install in under 30 minutes with basic tools. No professional help required.
        </p>
      </div>

      <div className="space-y-8 max-w-4xl mx-auto">
        {displaySteps.map((step, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ delay: index * 0.1, duration: 0.5 }}
            className="flex gap-6 group"
          >
            {/* Step Number */}
            <div className="flex-shrink-0">
              <div className="w-14 h-14 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-orange-500/30 group-hover:scale-110 transition-transform">
                {stepIcons[index] || (index + 1)}
              </div>
              {index < displaySteps.length - 1 && (
                <div className="w-0.5 h-full bg-zinc-700 mx-auto mt-4" />
              )}
            </div>

            {/* Step Content */}
            <div className="flex-1 pb-8">
              <h3 className="text-2xl font-bold text-white mb-3">
                Step {index + 1}: {step.title}
              </h3>
              <p className="text-zinc-400 text-lg leading-relaxed">
                {step.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Installation Note */}
      <div className="mt-12 bg-zinc-800/50 border border-zinc-700 rounded-xl p-6 max-w-4xl mx-auto">
        <div className="flex items-start gap-4">
          <div className="text-orange-500 flex-shrink-0 mt-1">
            <Wrench className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-white font-bold mb-2">Need Professional Installation?</h4>
            <p className="text-zinc-400">
              Visit any authorized Autobacs service center across India. Professional installation available at ₹500-₹1000 depending on complexity.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
