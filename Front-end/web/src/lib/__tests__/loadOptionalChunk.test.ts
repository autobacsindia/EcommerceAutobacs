import { loadOptionalChunk } from '../loadOptionalChunk';

const Comp = () => null;

describe('loadOptionalChunk', () => {
  it('returns the real module when the chunk loads', async () => {
    const loader = jest.fn().mockResolvedValue({ default: Comp });
    const mod = await loadOptionalChunk(loader, { retryDelayMs: 0 })();
    expect(mod.default).toBe(Comp);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and then succeeds', async () => {
    const loader = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Loading chunk 23330 failed.'), { name: 'ChunkLoadError' }))
      .mockResolvedValue({ default: Comp });
    const mod = await loadOptionalChunk(loader, { retryDelayMs: 0 })();
    expect(mod.default).toBe(Comp);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('never rejects: after every attempt fails it resolves to a component that renders nothing', async () => {
    const err = Object.assign(new Error('Loading chunk 23330 failed.'), { name: 'ChunkLoadError' });
    const loader = jest.fn().mockRejectedValue(err);
    const onGiveUp = jest.fn();
    const mod = await loadOptionalChunk(loader, { retries: 2, retryDelayMs: 0, onGiveUp })();
    expect(loader).toHaveBeenCalledTimes(3);
    expect(onGiveUp).toHaveBeenCalledWith(err);
    expect((mod.default as () => unknown)()).toBeNull();
  });

  it('a throwing onGiveUp cannot turn the contained failure back into a crash', async () => {
    const loader = jest.fn().mockRejectedValue(new Error('offline'));
    const mod = await loadOptionalChunk(loader, {
      retries: 0,
      onGiveUp: () => { throw new Error('logger broke'); },
    })();
    expect((mod.default as () => unknown)()).toBeNull();
  });
});
