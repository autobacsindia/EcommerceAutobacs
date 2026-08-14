import { jest } from '@jest/globals';
import {
  PERSIST_MODES,
  DEFAULT_PERSIST_MODE,
  getPersistMode,
  getHitSampleRate,
  shouldPersistEvent,
  normalizeEndpoint,
} from '../config/rateLimitTelemetry.js';
import { validateEnvironment } from '../config/validateEnv.js';

/**
 * Guards the change that stopped ~200k telemetry inserts/day.
 *
 * The invariant that matters most here: a `block` event is NEVER dropped, in any
 * mode. Blocks are the security signal — losing one to a cost optimisation would
 * be a silent regression, so it is asserted for every mode explicitly.
 */
describe('rate-limit telemetry persistence policy', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('getPersistMode', () => {
    it('defaults to blocks-only when unset', () => {
      delete process.env.RATE_LIMIT_EVENT_PERSIST;
      expect(getPersistMode()).toBe('blocks-only');
      expect(DEFAULT_PERSIST_MODE).toBe('blocks-only');
    });

    it('falls back to the default for an unrecognised value', () => {
      process.env.RATE_LIMIT_EVENT_PERSIST = 'everything';
      expect(getPersistMode()).toBe('blocks-only');
    });

    it('trims surrounding whitespace', () => {
      process.env.RATE_LIMIT_EVENT_PERSIST = '  all  ';
      expect(getPersistMode()).toBe('all');
    });

    it.each(PERSIST_MODES)('accepts the documented mode %s', (mode) => {
      process.env.RATE_LIMIT_EVENT_PERSIST = mode;
      expect(getPersistMode()).toBe(mode);
    });
  });

  describe('shouldPersistEvent', () => {
    it('drops hit events in blocks-only mode', () => {
      expect(shouldPersistEvent('hit', { mode: 'blocks-only' })).toBe(false);
    });

    it('persists hit events in all mode', () => {
      expect(shouldPersistEvent('hit', { mode: 'all' })).toBe(true);
    });

    // The invariant. If this ever fails, the security log has a hole in it.
    it.each(PERSIST_MODES)('ALWAYS persists block events in %s mode', (mode) => {
      expect(shouldPersistEvent('block', { mode })).toBe(true);
    });

    it.each(['retry_success', 'retry_failure', 'threshold_change'])(
      'always persists %s regardless of mode',
      (eventType) => {
        for (const mode of PERSIST_MODES) {
          expect(shouldPersistEvent(eventType, { mode })).toBe(true);
        }
      }
    );

    describe('sampled mode', () => {
      it('keeps a hit when the draw falls under the rate', () => {
        process.env.RATE_LIMIT_EVENT_HIT_SAMPLE_RATE = '0.1';
        expect(shouldPersistEvent('hit', { mode: 'sampled', rng: () => 0.05 })).toBe(true);
      });

      it('drops a hit when the draw is above the rate', () => {
        process.env.RATE_LIMIT_EVENT_HIT_SAMPLE_RATE = '0.1';
        expect(shouldPersistEvent('hit', { mode: 'sampled', rng: () => 0.5 })).toBe(false);
      });

      it('drops every hit at rate 0 without consulting the rng', () => {
        process.env.RATE_LIMIT_EVENT_HIT_SAMPLE_RATE = '0';
        const rng = jest.fn(() => 0);
        expect(shouldPersistEvent('hit', { mode: 'sampled', rng })).toBe(false);
        expect(rng).not.toHaveBeenCalled();
      });

      it('keeps every hit at rate 1', () => {
        process.env.RATE_LIMIT_EVENT_HIT_SAMPLE_RATE = '1';
        expect(shouldPersistEvent('hit', { mode: 'sampled', rng: () => 0.999 })).toBe(true);
      });

      it('clamps a rate above 1 rather than throwing', () => {
        process.env.RATE_LIMIT_EVENT_HIT_SAMPLE_RATE = '7';
        expect(getHitSampleRate()).toBe(1);
      });

      it('does not silently degrade to blocks-only when the rate is unset', () => {
        delete process.env.RATE_LIMIT_EVENT_HIT_SAMPLE_RATE;
        expect(getHitSampleRate()).toBeGreaterThan(0);
        expect(shouldPersistEvent('hit', { mode: 'sampled', rng: () => 0 })).toBe(true);
      });
    });
  });

  describe('normalizeEndpoint', () => {
    it('strips the query string that made endpoint near-unique per request', () => {
      expect(normalizeEndpoint('/api/v1/products?category=exterior&sortBy=averageRating&limit=4'))
        .toBe('/api/v1/products');
    });

    it('leaves a bare path untouched', () => {
      expect(normalizeEndpoint('/api/v1/cart')).toBe('/api/v1/cart');
    });

    it('collapses a query-only url to /', () => {
      expect(normalizeEndpoint('?foo=bar')).toBe('/');
    });

    it.each([['', '/'], [null, '/'], [undefined, '/'], [{}, '/']])(
      'returns / for the non-string input %p',
      (input, expected) => {
        expect(normalizeEndpoint(input)).toBe(expected);
      }
    );

    it('bounds length so a hostile url cannot bloat the index', () => {
      const long = `/api/v1/${'a'.repeat(500)}`;
      expect(normalizeEndpoint(long)).toHaveLength(200);
    });
  });

  describe('boot-time env validation', () => {
    let exitSpy;
    let errorSpy;
    let logSpy;

    beforeEach(() => {
      exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      process.env.JWT_SECRET = 'x'.repeat(64);
      process.env.MONGO_URI = 'mongodb://localhost:27017/test';
      process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('accepts a valid mode', () => {
      process.env.RATE_LIMIT_EVENT_PERSIST = 'blocks-only';
      expect(() => validateEnvironment()).not.toThrow();
    });

    it('fails boot on a typo instead of silently defaulting', () => {
      process.env.RATE_LIMIT_EVENT_PERSIST = 'block-only'; // missing the s
      expect(() => validateEnvironment()).toThrow('process.exit called');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('RATE_LIMIT_EVENT_PERSIST must be one of')
      );
    });

    it('fails boot on an out-of-range sample rate', () => {
      process.env.RATE_LIMIT_EVENT_HIT_SAMPLE_RATE = '50';
      expect(() => validateEnvironment()).toThrow('process.exit called');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('RATE_LIMIT_EVENT_HIT_SAMPLE_RATE must be a number between 0 and 1')
      );
    });

    it('fails boot on a non-numeric sample rate', () => {
      process.env.RATE_LIMIT_EVENT_HIT_SAMPLE_RATE = 'half';
      expect(() => validateEnvironment()).toThrow('process.exit called');
    });
  });
});
