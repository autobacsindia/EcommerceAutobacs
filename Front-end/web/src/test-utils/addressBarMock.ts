/**
 * A tiny address bar for testing lists that keep their search / filters in the
 * page address (lib/hooks/useListParams.ts): `replace()` changes it and
 * re-renders whoever reads it, like Next's router does.
 *
 *   jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
 *   import { addressBar } from '@/test-utils/addressBarMock';
 *   beforeEach(() => addressBar.reset('/team/payments'));
 *   addressBar.search = 'status=paid';   // open the page from a link
 */
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let search = '';

export const addressBar = {
  pathname: '/',
  /** Like Next, the new address can land a render later — set true to test that. */
  defer: false,
  get search() { return search; },
  set search(value: string) { search = value; listeners.forEach((l) => l()); },
  replace: jest.fn((url: string) => {
    const apply = () => { addressBar.search = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''; };
    if (addressBar.defer) setTimeout(apply, 0); else apply();
  }),
  push: jest.fn(),
  reset(pathname: string, initial = '') {
    addressBar.pathname = pathname;
    addressBar.defer = false;
    search = initial;
    addressBar.replace.mockClear();
    addressBar.push.mockClear();
  },
};

export const nextNavigation = {
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => search,
  )),
  useRouter: () => ({ replace: addressBar.replace, push: addressBar.push }),
  usePathname: () => addressBar.pathname,
};
