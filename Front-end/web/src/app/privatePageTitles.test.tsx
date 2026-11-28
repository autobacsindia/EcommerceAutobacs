import { metadata as cart } from './cart/layout';
import { metadata as login } from './login/layout';
import { metadata as register } from './register/layout';

// These pages showed the generic "Autobacs India | Premium Automotive Accessories"
// in the browser tab. Each now has its own name (the root layout adds
// "| Autobacs India") and stays out of search results.
describe('private page titles', () => {
  it.each([
    ['/cart', cart, 'Your cart'],
    ['/login', login, 'Sign in'],
    ['/register', register, 'Create your account'],
  ])('%s has its own title and is noindex', (_path, meta, title) => {
    expect(meta.title).toBe(title);
    expect(meta.robots).toEqual({ index: false, follow: true });
  });
});
