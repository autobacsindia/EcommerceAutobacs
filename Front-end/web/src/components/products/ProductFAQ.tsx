'use client';

import { useState } from 'react';
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
    <section className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <HelpCircle className="w-6 h-6 text-blue-600" />
        <h2 className="text-xl font-bold text-gray-900">Frequently Asked Questions</h2>
      </div>
      
      <div className="space-y-3">
        {faqList.map((faq, index) => (
          <div
            key={index}
            className="border border-gray-200 rounded-xl overflow-hidden hover:border-blue-300 transition-colors"
          >
            <button
              onClick={() => toggleFAQ(index)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
              aria-expanded={openIndex === index}
            >
              <span className="font-medium text-gray-900 pr-4">
                {faq.question}
              </span>
              {openIndex === index ? (
                <ChevronUp className="w-5 h-5 text-gray-600 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-600 flex-shrink-0" />
              )}
            </button>
            
            {openIndex === index && (
              <div className="px-4 pb-4 text-gray-700 leading-relaxed border-t border-gray-100 pt-3">
                {faq.answer}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
