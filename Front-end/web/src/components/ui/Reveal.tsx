'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Scroll-reveal primitive for the redesigned storefront. Fades/slides children
 * up as they enter the viewport — the site-wide generalization of the inline
 * IntersectionObserver the home redesign used. Honours prefers-reduced-motion.
 *
 * Use `delay` to stagger siblings (e.g. cards in a grid: index * 0.05).
 */
interface RevealProps {
  delay?: number;
  y?: number;
  className?: string;
  children: ReactNode;
}

export default function Reveal({ delay = 0, y = 28, className, children }: RevealProps) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
