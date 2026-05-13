/**
 * Global type declarations for testing libraries
 * 
 * This file ensures TypeScript recognizes custom module declarations
 */

declare module 'jest-axe' {
  export interface AxeViolation {
    id: string;
    impact: string | null;
    description: string;
    nodes: unknown[];
    [key: string]: unknown;
  }

  export interface JestAxeResults {
    passes: unknown[];
    violations: AxeViolation[];
    incomplete: unknown[];
    inapplicable: unknown[];
    [key: string]: unknown;
  }

  export function axe(
    html: HTMLElement | string,
    options?: Record<string, unknown>
  ): Promise<JestAxeResults>;

  export const toHaveNoViolations: {
    toHaveNoViolations(rulesToIgnore?: string[]): { pass: boolean; message(): string };
  };
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

declare namespace jest {
  interface Matchers<R> {
    toHaveNoViolations(rulesToIgnore?: string[]): R;
  }
}
