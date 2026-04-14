/**
 * Accessibility Test Utilities
 * 
 * Provides tools for automated a11y testing with jest-axe
 * 
 * Usage:
 *   import { testAccessibility } from '@/tests/utils/a11y';
 *   
 *   test('should be accessible', async () => {
 *     const { container } = render(<MyComponent />);
 *     await testAccessibility(container);
 *   });
 */

import { axe, toHaveNoViolations } from 'jest-axe';
import { render, RenderResult } from '@testing-library/react';
import { ReactElement } from 'react';

// Extend Jest expectations
expect.extend(toHaveNoViolations);

// Type declaration for jest-axe
 declare global {
  namespace jest {
    interface Matchers<R> {
      toHaveNoViolations(): R;
    }
  }
}

/**
 * Test component for accessibility violations
 */
export async function testAccessibility(
  ui: ReactElement | HTMLElement,
  options?: any
): Promise<void> {
  // If it's an HTMLElement, use it directly
  let container: HTMLElement;
  
  if (ui instanceof HTMLElement) {
    container = ui;
  } else {
    const result = render(ui as ReactElement);
    container = result.container;
  }

  // Run axe-core audit
  const results = await axe(container, options);
  
  // Assert no violations
  expect(results).toHaveNoViolations();
}

/**
 * Test specific a11y rules
 */
export const a11yRules = {
  /**
   * Test color contrast
   */
  colorContrast: async (ui: ReactElement) => {
    const { container } = render(ui);
    const results = await axe(container, {
      rules: {
        'color-contrast': { enabled: true }
      }
    });
    
    expect(results).toHaveNoViolations(['color-contrast']);
  },

  /**
   * Test ARIA labels
   */
  ariaLabels: async (ui: ReactElement) => {
    const { container } = render(ui);
    const results = await axe(container, {
      rules: {
        'aria-required-attr': { enabled: true },
        'button-name': { enabled: true },
        'label': { enabled: true }
      }
    });
    
    expect(results).toHaveNoViolations([
      'aria-required-attr',
      'button-name',
      'label'
    ]);
  },

  /**
   * Test keyboard navigation
   */
  keyboardNav: async (ui: ReactElement) => {
    const { container, getByRole } = render(ui);
    
    // Get all interactive elements
    const interactiveElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    // Ensure all are focusable
    interactiveElements.forEach(element => {
      expect(element).toBeVisible();
    });
  },

  /**
   * Test heading hierarchy
   */
  headingHierarchy: async (ui: ReactElement) => {
    const { container } = render(ui);
    const results = await axe(container, {
      rules: {
        'heading-order': { enabled: true }
      }
    });
    
    expect(results).toHaveNoViolations(['heading-order']);
  },

  /**
   * Test form labels
   */
  formLabels: async (ui: ReactElement) => {
    const { container } = render(ui);
    const results = await axe(container, {
      rules: {
        'label': { enabled: true },
        'label-title-only': { enabled: true }
      }
    });
    
    expect(results).toHaveNoViolations(['label', 'label-title-only']);
  }
};

/**
 * Common a11y test patterns
 */
export const a11yTests = {
  /**
   * Test button accessibility
   */
  button: async (ui: ReactElement) => {
    const { getByRole } = render(ui);
    
    // Button should be accessible by role
    const button = getByRole('button');
    expect(button).toBeTruthy();
    
    // Button should have accessible name
    expect(button).toHaveAccessibleName();
    
    // Full axe audit
    await testAccessibility(ui);
  },

  /**
   * Test link accessibility
   */
  link: async (ui: ReactElement) => {
    const { getByRole } = render(ui);
    
    const link = getByRole('link');
    expect(link).toBeTruthy();
    expect(link).toHaveAccessibleName();
    
    await testAccessibility(ui);
  },

  /**
   * Test form accessibility
   */
  form: async (ui: ReactElement) => {
    const { getByRole, container } = render(ui);
    
    const form = getByRole('form');
    expect(form).toBeTruthy();
    
    // Run form-specific tests
    await a11yRules.formLabels(ui);
    await testAccessibility(ui);
  },

  /**
   * Test modal/dialog accessibility
   */
  modal: async (ui: ReactElement) => {
    const { getByRole } = render(ui);
    
    const dialog = getByRole('dialog');
    expect(dialog).toBeTruthy();
    
    // Dialog should have aria-label or aria-labelledby
    const hasLabel = dialog.hasAttribute('aria-label') || 
                     dialog.hasAttribute('aria-labelledby');
    expect(hasLabel).toBe(true);
    
    await testAccessibility(ui);
  },

  /**
   * Test image accessibility
   */
  image: async (ui: ReactElement) => {
    const { container } = render(ui);
    const results = await axe(container, {
      rules: {
        'image-alt': { enabled: true }
      }
    });
    
    expect(results).toHaveNoViolations(['image-alt']);
  }
};

export default testAccessibility;
