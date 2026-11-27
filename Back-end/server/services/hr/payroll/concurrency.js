/** Run `fn` over `items`, at most `n` at a time; results keep the input order. */
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i; i += 1; out[k] = await fn(items[k]); }
  }));
  return out;
}
