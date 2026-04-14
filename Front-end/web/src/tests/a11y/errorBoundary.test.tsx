/**
 * Accessibility Test Example
 * 
 * Demonstrates how to test components for accessibility
 */

import { render, screen, act } from '@testing-library/react';
import { testAccessibility, a11yRules, a11yTests } from '@/tests/utils/a11y';
import AccessibleErrorBoundary from '@/components/AccessibleErrorBoundary';

// ── Basic Accessibility Tests ────────────────────────────────────────────────

describe('AccessibleErrorBoundary - Accessibility', () => {
  test('should have no accessibility violations when showing error', async () => {
    // Force error state
    const TestComponent = () => {
      throw new Error('Test error');
    };

    const { container } = render(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );

    // Run full axe-core audit
    await testAccessibility(container);
  });

  test('should have proper ARIA attributes on error state', async () => {
    const TestComponent = () => {
      throw new Error('Test error');
    };

    render(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );

    // Error container should have role="alert"
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();

    // Should have aria-live="assertive"
    expect(alert).toHaveAttribute('aria-live', 'assertive');

    // Should have aria-atomic="true"
    expect(alert).toHaveAttribute('aria-atomic', 'true');
  });

  test('should have accessible retry button', async () => {
    const TestComponent = () => {
      throw new Error('Test error');
    };

    render(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );

    // Button should be accessible
    await a11yTests.button(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );
  });
});

// ── Color Contrast Tests ─────────────────────────────────────────────────────

describe('Color Contrast', () => {
  test('error boundary should meet WCAG AA contrast requirements', async () => {
    const TestComponent = () => {
      throw new Error('Test error');
    };

    await a11yRules.colorContrast(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );
  });
});

// ── ARIA Label Tests ─────────────────────────────────────────────────────────

describe('ARIA Labels', () => {
  test('all interactive elements should have accessible names', async () => {
    const TestComponent = () => {
      throw new Error('Test error');
    };

    await a11yRules.ariaLabels(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );
  });
});

// ── Keyboard Navigation Tests ────────────────────────────────────────────────

describe('Keyboard Navigation', () => {
  test('error boundary should be keyboard accessible', async () => {
    const TestComponent = () => {
      throw new Error('Test error');
    };

    const { container, getByRole } = render(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );

    // Get the retry button from the rendered component
    const retryButton = getByRole('button', { name: 'Try again' });
    expect(retryButton).toBeTruthy();
    
    // Verify it's focusable
    expect(retryButton).toBeVisible();
  });

  test('should support Enter key for retry', async () => {
    const TestComponent = () => {
      throw new Error('Test error');
    };

    const { container, getByRole } = render(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );

    // Get the retry button
    const retryButton = getByRole('button', { name: 'Try again' });
    
    // Simulate Enter key press wrapped in act()
    await act(async () => {
      retryButton.focus();
      const enterEvent = new KeyboardEvent('keydown', { 
        key: 'Enter',
        bubbles: true,
        cancelable: true
      });
      retryButton.dispatchEvent(enterEvent);
    });

    // Error boundary should have reset (alert should be gone)
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeNull();
  });

  test('should support Space key for retry', async () => {
    const TestComponent = () => {
      throw new Error('Test error');
    };

    const { container, getByRole } = render(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );

    // Get the retry button
    const retryButton = getByRole('button', { name: 'Try again' });
    
    // Simulate Space key press wrapped in act()
    await act(async () => {
      retryButton.focus();
      const spaceEvent = new KeyboardEvent('keydown', { 
        key: ' ',
        bubbles: true,
        cancelable: true
      });
      retryButton.dispatchEvent(spaceEvent);
    });

    // Error boundary should have reset
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeNull();
  });
});

// ── Screen Reader Tests ──────────────────────────────────────────────────────

describe('Screen Reader Support', () => {
  test('error message should be announced to screen readers', () => {
    const TestComponent = () => {
      throw new Error('Critical error occurred');
    };

    render(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );

    // Error container should be visible to screen readers
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Critical error occurred');
  });

  test('error should have descriptive heading', () => {
    const TestComponent = () => {
      throw new Error('Test error');
    };

    render(
      <AccessibleErrorBoundary feature="test">
        <TestComponent />
      </AccessibleErrorBoundary>
    );

    // Should have h2 heading
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toBeTruthy();
    expect(heading).toHaveTextContent(/something went wrong/i);
  });
});

// ── Example: Testing Other Components ────────────────────────────────────────

describe('Product Card - Accessibility Example', () => {
  // test('should be accessible', async () => {
  //   await testAccessibility(
  //     <ProductCard
  //       product={{
  //         _id: '123',
  //         name: 'Test Product',
  //         price: 99.99,
  //         images: [{ url: '/test.jpg' }]
  //       }}
  //     />
  //   );
  // });

  // test('should have proper image alt text', async () => {
  //   await a11yTests.image(
  //     <ProductCard product={testProduct} />
  //   );
  // });

  // test('"Add to Cart" button should be accessible', async () => {
  //   await a11yTests.button(
  //     <ProductCard product={testProduct} />
  //   );
  // });
});
