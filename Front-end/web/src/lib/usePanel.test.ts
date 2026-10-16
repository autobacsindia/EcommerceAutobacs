import { renderHook } from '@testing-library/react';
import { usePanel, MARKETING_BASE } from './usePanel';

let pathname: string | null = '/admin/coupons';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));

describe('usePanel', () => {
  it('on an admin screen: admin links and admin controls', () => {
    pathname = '/admin/coupons';
    expect(renderHook(() => usePanel()).result.current).toEqual({ base: '/admin', isAdmin: true });
  });

  it('in the marketing panel: team links, no admin-only controls', () => {
    pathname = '/team/marketing/coupons/edit/1';
    expect(renderHook(() => usePanel()).result.current).toEqual({ base: MARKETING_BASE, isAdmin: false });
  });

  it('a path that only starts with "team" is not the team panel', () => {
    pathname = '/teamwork';
    expect(renderHook(() => usePanel()).result.current.isAdmin).toBe(true);
  });

  it('with no router context it falls back to the admin view', () => {
    pathname = null;
    expect(renderHook(() => usePanel()).result.current.base).toBe('/admin');
  });
});
