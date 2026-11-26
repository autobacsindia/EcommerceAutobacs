// Test-only: lets `node --test` load the app's extension-less TS imports
// ('./momentCopy' → './momentCopy.ts'). Node strips the types itself.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});
