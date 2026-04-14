/**
 * Type declarations for accessibility testing libraries
 * 
 * This file provides TypeScript types for:
 * - jest-axe
 * - @axe-core/react
 * 
 * After installing packages, these types will be provided automatically
 */

declare module 'jest-axe' {
  import { ConfigOptions, AxeResults } from 'axe-core';

  // axe function accepts HTMLElement or string HTML
  export function axe(html: HTMLElement | string, options?: ConfigOptions): Promise<AxeResults>;
  
  // toHaveNoViolations returns a Jest matcher
  export function toHaveNoViolations(): jest.CustomMatcher;
  
  // Helper type for AxeResults
  export interface JestAxeResults extends AxeResults {
    passes: any[];
    violations: any[];
    incomplete: any[];
    incompleteFallbackMessage: string;
  }
}

declare module '@axe-core/react' {
  // Dynamic import returns default function
  function axe(
    React: any,
    ReactDOM: any,
    timeout?: number,
    options?: any
  ): void;
  
  export default axe;
}

// Extend Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      // toHaveNoViolations can optionally take array of rule IDs to ignore
      toHaveNoViolations(rulesToIgnore?: string[]): R;
    }
  }
}

export {};
