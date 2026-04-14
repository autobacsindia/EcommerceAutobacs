/**
 * Chaos Testing Utility for Error Boundaries
 * 
 * Simulates real-world failures to verify error isolation
 * 
 * Usage:
 *   import { chaosTest } from '@/lib/chaosTesting';
 *   
 *   // In development only
 *   if (process.env.NODE_ENV === 'development') {
 *     chaosTest.enable();
 *   }
 */

interface ChaosOptions {
  crashRate?: number; // 0-1, e.g., 0.1 = 10% chance
  networkDelay?: number; // ms
  networkFailRate?: number; // 0-1
  randomComponentCrash?: boolean;
}

class ChaosTesting {
  private enabled = false;
  private options: ChaosOptions = {};

  /**
   * Enable chaos testing
   */
  enable(options: ChaosOptions = {}) {
    this.enabled = true;
    this.options = {
      crashRate: 0.05, // 5% default
      networkDelay: 0,
      networkFailRate: 0.1, // 10% default
      randomComponentCrash: true,
      ...options
    };

    console.warn('🔥 CHAOS TESTING ENABLED - Expect random failures!');
    
    this.setupInterceptors();
  }

  /**
   * Disable chaos testing
   */
  disable() {
    this.enabled = false;
    console.log('✅ Chaos testing disabled');
  }

  /**
   * Setup interceptors for various failure modes
   */
  private setupInterceptors() {
    // 1. Random component crashes
    if (this.options.randomComponentCrash) {
      this.interactComponentRender();
    }

    // 2. Network failures
    if ((this.options.networkFailRate || 0) > 0) {
      this.interceptFetch();
    }

    console.log('[Chaos] Interceptors active:', {
      componentCrash: this.options.randomComponentCrash,
      networkFailRate: this.options.networkFailRate,
      networkDelay: this.options.networkDelay
    });
  }

  /**
   * Randomly crash components during render
   */
  private interactComponentRender() {
    // Provide utility for manual testing
    (window as any).__chaosCrashComponent = () => {
      if (Math.random() < (this.options.crashRate || 0.05)) {
        throw new Error(`[CHAOS] Random component crash at ${new Date().toISOString()}`);
      }
    };
  }

  /**
   * Intercept fetch to simulate network issues
   */
  private interceptFetch() {
    const originalFetch = window.fetch;
    
    window.fetch = async (...args) => {
      // Simulate network delay
      if (this.options.networkDelay && this.options.networkDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.options.networkDelay));
      }

      // Simulate network failure
      if (Math.random() < (this.options.networkFailRate || 0)) {
        const errorType = Math.random();
        
        if (errorType < 0.33) {
          // Network error
          throw new TypeError('[CHAOS] Network request failed');
        } else if (errorType < 0.66) {
          // Timeout
          throw new TypeError('[CHAOS] The operation was aborted due to timeout');
        } else {
          // Server error (500)
          return new Response(
            JSON.stringify({ error: '[CHAOS] Internal server error' }),
            { status: 500, statusText: 'Internal Server Error' }
          );
        }
      }

      // Normal fetch
      return originalFetch.apply(window, args);
    };

    console.log('[Chaos] Fetch interceptor active');
  }

  /**
   * Manually trigger component crash
   */
  triggerCrash() {
    throw new Error(`[CHAOS] Manual crash triggered at ${new Date().toISOString()}`);
  }

  /**
   * Simulate slow network
   */
  simulateSlowNetwork(delayMs: number = 3000) {
    const originalFetch = window.fetch;
    
    window.fetch = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return originalFetch.apply(window, args);
    };

    console.log(`[Chaos] Slow network enabled (${delayMs}ms delay)`);
  }

  /**
   * Simulate offline mode
   */
  simulateOffline() {
    Object.defineProperty(navigator, 'onLine', {
      get: () => false,
      configurable: true
    });

    window.dispatchEvent(new Event('offline'));

    console.log('[Chaos] Offline mode enabled');
  }

  /**
   * Simulate back online
   */
  simulateOnline() {
    Object.defineProperty(navigator, 'onLine', {
      get: () => true,
      configurable: true
    });

    window.dispatchEvent(new Event('online'));

    console.log('[Chaos] Online mode restored');
  }
}

// Singleton instance
export const chaosTest = new ChaosTesting();

export default chaosTest;
