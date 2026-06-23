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
  isDark?: boolean;
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
    answer: "Please check the vehicle compatibility section above to see if this product is designed for your specific make and model. If you're unsure, our customer support can help verify fitment."
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

export default function ProductFAQ({ faqs, isDark = true }: ProductFAQProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  
  const faqList = faqs && faqs.length > 0 ? faqs : defaultFAQs;

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className={`${isDark ? 'bg-zinc-800/50 border-zinc-700' : 'bg-white border-gray-200'} border rounded-2xl p-8`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-orange-500/20 rounded-lg">
          <HelpCircle className="w-6 h-6 text-orange-500" />
        </div>
        <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Frequently Asked Questions</h2>
      </div>
      
      <div className="space-y-3">
        {faqList.map((faq, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.05 }}
            className={`${isDark ? 'border-zinc-700 hover:border-orange-500/50' : 'border-gray-200 hover:border-orange-500'} border rounded-xl overflow-hidden transition-colors`}
          >
            <button
              onClick={() => toggleFAQ(index)}
              className={`w-full flex items-center justify-between p-5 text-left transition-colors ${isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-gray-50'}`}
              aria-expanded={openIndex === index}
            >
              <span className={`font-semibold pr-4 text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {faq.question}
              </span>
              {openIndex === index ? (
                <ChevronUp className="w-5 h-5 text-orange-500 flex-shrink-0" />
              ) : (
                <ChevronDown className={`w-5 h-5 flex-shrink-0 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`} />
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
                  <div className={`px-5 pb-5 leading-relaxed border-t pt-4 ${isDark ? 'text-zinc-300 border-zinc-700' : 'text-gray-700 border-gray-200'}`}>
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
