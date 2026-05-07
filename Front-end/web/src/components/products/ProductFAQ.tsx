'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';

interface FAQ {
  question: string;
  answer: string;
}

interface ProductFAQProps {
  faqs?: FAQ[];
}

const defaultFAQs: FAQ[] = [
  {
    question: "Does this require drilling for installation?",
    answer: "Most of our products are designed for bolt-on installation without drilling. However, some specific applications may require minor modifications. Please check the product description or contact our support team for your specific vehicle."
  },
  {
    question: "Is it rust-proof?",
    answer: "Yes, our products come with rust-proof coating (powder coating/galvanization) specifically designed to withstand Indian monsoon conditions and high humidity."
  },
  {
    question: "Will it fit my car?",
    answer: "Please check the vehicle compatibility section above to see if this product is designed for your specific make, model, and year. If you're unsure, our customer support can help verify fitment."
  },
  {
    question: "Is installation easy?",
    answer: "Most products can be installed with basic hand tools in 1-2 hours. We provide detailed installation instructions. For complex installations, we recommend professional fitting at our authorized service centers."
  },
  {
    question: "What is the warranty period?",
    answer: "We offer a 1-year warranty on most products against manufacturing defects. Some premium products come with extended warranty. Please check the product description for specific warranty terms."
  },
  {
    question: "Do you provide installation services?",
    answer: "Yes, we have authorized service centers in major cities across India. You can book an installation service during checkout or contact us to find the nearest center."
  }
];

export default function ProductFAQ({ faqs }: ProductFAQProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  
  const faqList = faqs && faqs.length > 0 ? faqs : defaultFAQs;

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="bg-zinc-800/50 border border-zinc-700 rounded-2xl p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-orange-500/20 rounded-lg">
          <HelpCircle className="w-6 h-6 text-orange-500" />
        </div>
        <h2 className="text-2xl font-bold text-white">Frequently Asked Questions</h2>
      </div>
      
      <div className="space-y-3">
        {faqList.map((faq, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.05 }}
            className="border border-zinc-700 rounded-xl overflow-hidden hover:border-orange-500/50 transition-colors"
          >
            <button
              onClick={() => toggleFAQ(index)}
              className="w-full flex items-center justify-between p-5 text-left hover:bg-zinc-700/50 transition-colors"
              aria-expanded={openIndex === index}
            >
              <span className="font-semibold text-white pr-4 text-lg">
                {faq.question}
              </span>
              {openIndex === index ? (
                <ChevronUp className="w-5 h-5 text-orange-500 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-zinc-400 flex-shrink-0" />
              )}
            </button>
            
            <AnimatePresence>
              {openIndex === index && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 text-zinc-300 leading-relaxed border-t border-zinc-700 pt-4">
                    {faq.answer}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
