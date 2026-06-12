'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { CloudRain, Sun, Mountain, Gauge } from 'lucide-react';

interface StoryCard {
  title: string;
  description: string;
}

interface ProductStoryProps {
  productName?: string;
  storyText?: string;
  storyCards?: StoryCard[];
  isDark?: boolean;
}

const defaultIcons = [
  <CloudRain className="w-10 h-10" />,
  <Sun className="w-10 h-10" />,
  <Mountain className="w-10 h-10" />,
  <Gauge className="w-10 h-10" />,
];

const defaultCards: StoryCard[] = [
  { title: 'Monsoon Durability',  description: 'Engineered to withstand heavy rains and high humidity during Indian monsoon season' },
  { title: 'Heat Resistant',      description: 'Tested for extreme temperatures (45°C+) across Indian highways' },
  { title: 'Off-Road Toughness',  description: 'Built for Ladakh passes, desert trails, and rugged mountain terrain' },
  { title: 'Highway Performance', description: 'Superior visibility and reliability on long-distance Indian highway drives' },
];

export default function ProductStory({ productName, storyText, storyCards, isDark = true }: ProductStoryProps) {
  const displayCards = storyCards && storyCards.length > 0 ? storyCards : defaultCards;

  return (
    <section className="relative h-[600px] rounded-2xl overflow-hidden my-24">
      {/* Background */}
      <Image
        src="/placeholder-product.jpg"
        alt="Engineered for Indian Trails"
        fill
        className="object-cover"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-black/80" />
      <div className="absolute inset-0 bg-linear-to-b from-zinc-950/50 via-transparent to-zinc-950/50" />

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-4xl space-y-8"
        >
          {/* Heading */}
          <div className="space-y-4">
            <h2 className="text-5xl lg:text-6xl font-black text-white leading-tight">
              Engineered for Indian Trails
            </h2>
            <p className="text-xl text-zinc-300 leading-relaxed max-w-2xl mx-auto">
              {storyText || 'From highway glare to monsoon downpours, from Ladakh passes to desert trails. Built to perform when Indian roads demand the most.'}
            </p>
          </div>

          {/* Condition Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-12">
            {displayCards.map((card, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15 }}
                className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-6 hover:bg-white/15 transition-colors"
              >
                <div className="text-orange-500 mb-4 flex justify-center">
                  {defaultIcons[index] ?? defaultIcons[0]}
                </div>
                <h3 className="text-white font-bold mb-2">{card.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{card.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
