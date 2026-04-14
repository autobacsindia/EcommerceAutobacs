/**
 * Global type declarations for testing libraries
 * 
 * This file ensures TypeScript recognizes custom module declarations
 */

declare module 'jest-axe' {
  import { ConfigOptions, AxeResults } from 'axe-core';

  export function axe(html: HTMLElement | string, options?: ConfigOptions): Promise<AxeResults>;
  export function toHaveNoViolations(): jest.CustomMatcher;
  
  export interface JestAxeResults extends AxeResults {
    passes: any[];
    violations: any[];
    incomplete: any[];
    incompleteFallbackMessage: string;
  }
}

declare module '@axe-core/react' {
  function axe(
    React: any,
    ReactDOM: any,
    timeout?: number,
    options?: any
  ): void;
  
  export default axe;
}

declare global {
  namespace jest {
    interface Matchers<R> {
      toHaveNoViolations(rulesToIgnore?: string[]): R;
    }
  }
}

export {};
