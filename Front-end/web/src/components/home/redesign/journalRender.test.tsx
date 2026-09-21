/**
 * Proves the duplicate-key warning is gone by rendering the real component with
 * the fallback data — the exact condition that broke production.
 */
import React from 'react';
import { render } from '@testing-library/react';
import Journal from '@/components/home/redesign/Journal';

describe('Journal renders the fallback without duplicate-key warnings', () => {
  it('logs no "same key" error when posts are empty (fallback path)', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<Journal posts={[]} />);
    const dupWarnings = spy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => /same key|Keys should be unique/i.test(m));
    spy.mockRestore();
    expect(dupWarnings).toEqual([]);
  });
});
