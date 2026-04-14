/**
 * Accessibility Monitoring in Production
 * 
 * Tracks a11y violations and user struggles in production
 * Integrates with Sentry for comprehensive monitoring
 * 
 * Usage: Import once in app entry point
 *   import '@/lib/a11yMonitoring';
 */

interface A11yViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  node: string;
  url: string;
  timestamp: string;
}

class A11yMonitor {
  private violationCount = 0;
  private reportedViolations = new Set<string>();

  /**
   * Initialize a11y monitoring
   */
  init() {
    if (typeof window === 'undefined') return;

    // Track focus loss (keyboard users getting "lost")
    this.trackFocusLoss();

    // Track form abandonment (users struggling)
    this.trackFormAbandonment();

    // Track keyboard-only navigation
    this.trackKeyboardNavigation();

    // Listen for runtime a11y issues
    this.listenForA11yErrors();

    console.log('♿ Accessibility monitoring enabled');
  }

  /**
   * Track focus loss (indicates a11y issue)
   */
  private trackFocusLoss() {
    let lastFocusedElement: HTMLElement | null = null;

    document.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement;
      
      // Focus moved to body (often indicates focus trap broken)
      if (target.tagName === 'BODY' && lastFocusedElement) {
        this.reportViolation({
          id: 'focus-loss',
          impact: 'serious',
          description: 'Focus lost to body element',
          node: lastFocusedElement.outerHTML.substring(0, 100),
          url: window.location.pathname,
          timestamp: new Date().toISOString()
        });
      }

      lastFocusedElement = target;
    });
  }

  /**
   * Track form abandonment (users struggling with forms)
   */
  private trackFormAbandonment() {
    const forms = document.querySelectorAll('form');
    
    forms.forEach(form => {
      let interacted = false;
      let abandoned = false;

      form.addEventListener('input', () => {
        interacted = true;
      }, { once: true });

      form.addEventListener('submit', () => {
        interacted = false;
        abandoned = false;
      });

      // Detect when user leaves page after starting form
      window.addEventListener('beforeunload', () => {
        if (interacted && !abandoned) {
          abandoned = true;
          
          this.reportViolation({
            id: 'form-abandonment',
            impact: 'moderate',
            description: 'User abandoned form after starting',
            node: `Form action: ${(form as HTMLFormElement).action}`,
            url: window.location.pathname,
            timestamp: new Date().toISOString()
          });
        }
      });
    });
  }

  /**
   * Track keyboard-only navigation patterns
   */
  private trackKeyboardNavigation() {
    let lastInputMethod: 'keyboard' | 'mouse' | 'touch' | 'unknown' = 'unknown';

    document.addEventListener('keydown', (e) => {
      // Tab key indicates keyboard navigation
      if (e.key === 'Tab') {
        lastInputMethod = 'keyboard';
        
        // Track Tab presses for analytics
        this.trackEvent('keyboard-navigation', {
          key: e.key,
          url: window.location.pathname
        });
      }
    });

    document.addEventListener('mousedown', () => {
      lastInputMethod = 'mouse';
    });

    document.addEventListener('touchstart', () => {
      lastInputMethod = 'touch';
    });

    // Store for other components to use
    (window as any).__a11yInputMethod = lastInputMethod;
  }

  /**
   * Listen for runtime accessibility errors
   */
  private listenForA11yErrors() {
    const self = this; // Capture 'this' context
    
    // Catch ARIA attribute errors
    const originalSetAttribute = Element.prototype.setAttribute;
    
    Element.prototype.setAttribute = function(name: string, value: string) {
      // Validate ARIA attributes
      if (name.startsWith('aria-') && !self.isValidAriaAttribute(name, value)) {
        self.reportViolation({
          id: 'invalid-aria',
          impact: 'serious',
          description: `Invalid ARIA attribute: ${name}="${value}"`,
          node: this.outerHTML.substring(0, 100),
          url: window.location.pathname,
          timestamp: new Date().toISOString()
        });
      }

      return originalSetAttribute.call(this, name, value);
    };
  }

  /**
   * Validate ARIA attribute
   */
  private isValidAriaAttribute(name: string, value: string): boolean {
    const validAriaAttributes = [
      'aria-label',
      'aria-labelledby',
      'aria-describedby',
      'aria-hidden',
      'aria-live',
      'aria-atomic',
      'aria-relevant',
      'aria-busy',
      'aria-disabled',
      'aria-expanded',
      'aria-haspopup',
      'aria-pressed',
      'aria-checked',
      'aria-selected',
      'aria-required',
      'aria-invalid',
      'aria-errormessage',
      'aria-readonly',
      'aria-valuemin',
      'aria-valuemax',
      'aria-valuenow',
      'aria-valuetext',
      'aria-role',
      'aria-orientation'
    ];

    return validAriaAttributes.includes(name);
  }

  /**
   * Report a11y violation to Sentry
   */
  private reportViolation(violation: A11yViolation) {
    // Deduplicate violations
    const key = `${violation.id}-${violation.url}`;
    if (this.reportedViolations.has(key)) {
      return;
    }

    this.reportedViolations.add(key);
    this.violationCount++;

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.warn(`♿ A11y Violation [${violation.impact}]:`, violation.description);
    }

    // Send to Sentry
    if ((window as any).Sentry) {
      (window as any).Sentry.captureMessage(`A11y: ${violation.description}`, {
        level: this.getSeverityLevel(violation.impact),
        tags: {
          feature: 'accessibility',
          violationId: violation.id,
          impact: violation.impact
        },
        extra: {
          ...violation,
          totalViolations: this.violationCount
        }
      });
    }

    // Track in analytics
    this.trackEvent('a11y-violation', {
      id: violation.id,
      impact: violation.impact,
      url: violation.url
    });
  }

  /**
   * Get Sentry severity level from impact
   */
  private getSeverityLevel(impact: string): string {
    switch (impact) {
      case 'critical':
        return 'error';
      case 'serious':
        return 'warning';
      case 'moderate':
        return 'info';
      case 'minor':
        return 'debug';
      default:
        return 'info';
    }
  }

  /**
   * Track custom event
   */
  private trackEvent(eventName: string, data: any) {
    // Analytics tracking (e.g., Google Analytics, Mixpanel)
    if ((window as any).gtag) {
      (window as any).gtag('event', eventName, data);
    }

    // Log in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[A11y] ${eventName}:`, data);
    }
  }

  /**
   * Get violation statistics
   */
  getStats() {
    return {
      totalViolations: this.violationCount,
      uniqueViolations: this.reportedViolations.size,
      timestamp: new Date().toISOString()
    };
  }
}

// Singleton instance
export const a11yMonitor = new A11yMonitor();

// Auto-initialize in production
if (process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
  a11yMonitor.init();
}

export default a11yMonitor;
