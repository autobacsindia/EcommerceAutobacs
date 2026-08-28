/**
 * The gate on the internal preview tools.
 *
 * This is a security-shaped test, not a behaviour test: the failure it guards against is
 * a debug route appearing on the live storefront. The flag is a build-time constant, so
 * each case re-imports the module with a fresh env via jest.isolateModulesAsync.
 */

const load = async (env: Record<string, string | undefined>) => {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  let enabled = false;
  await jest.isolateModulesAsync(async () => {
    ({ PREVIEW_TOOLS_ENABLED: enabled } = await import('./previewTools'));
  });
  process.env = prev;
  return enabled;
};

describe('PREVIEW_TOOLS_ENABLED', () => {
  it('is OFF on the production deployment', async () => {
    await expect(load({
      NODE_ENV: 'production',
      NEXT_PUBLIC_VERCEL_ENV: 'production',
      NEXT_PUBLIC_ENABLE_PREVIEW_TOOLS: undefined,
    })).resolves.toBe(false);
  });

  it('is ON for the Vercel preview tier, with no configuration', async () => {
    // The whole point: the test tier gets the tools without anyone remembering to
    // set a variable, while production stays shut by default.
    await expect(load({
      NODE_ENV: 'production',
      NEXT_PUBLIC_VERCEL_ENV: 'preview',
      NEXT_PUBLIC_ENABLE_PREVIEW_TOOLS: undefined,
    })).resolves.toBe(true);
  });

  it('is ON in local development', async () => {
    await expect(load({
      NODE_ENV: 'development',
      NEXT_PUBLIC_VERCEL_ENV: undefined,
      NEXT_PUBLIC_ENABLE_PREVIEW_TOOLS: undefined,
    })).resolves.toBe(true);
  });

  it('opens only for the exact string "true", never a stray truthy value', async () => {
    // A half-set variable ("1", "yes", "") must not open a debug route in production.
    for (const v of ['1', 'yes', 'TRUE', '', 'false']) {
      await expect(load({
        NODE_ENV: 'production',
        NEXT_PUBLIC_VERCEL_ENV: 'production',
        NEXT_PUBLIC_ENABLE_PREVIEW_TOOLS: v,
      })).resolves.toBe(false);
    }
    await expect(load({
      NODE_ENV: 'production',
      NEXT_PUBLIC_VERCEL_ENV: 'production',
      NEXT_PUBLIC_ENABLE_PREVIEW_TOOLS: 'true',
    })).resolves.toBe(true);
  });

  it('an unknown VERCEL_ENV value does not open the gate', async () => {
    await expect(load({
      NODE_ENV: 'production',
      NEXT_PUBLIC_VERCEL_ENV: 'staging',
      NEXT_PUBLIC_ENABLE_PREVIEW_TOOLS: undefined,
    })).resolves.toBe(false);
  });
});
