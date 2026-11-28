import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PressPage from './page';

jest.mock('@/lib/r2SrcSet', () => ({ r2ImgProps: () => ({}), retryWithoutSrcSet: () => undefined }));

beforeEach(() => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
});

// The page had no <h1> at all: the masthead was a styled <div>.
it('the Press page masthead is its one main heading', async () => {
  render(<PressPage />);
  const h1s = screen.getAllByRole('heading', { level: 1 });
  expect(h1s).toHaveLength(1);
  expect(h1s[0]).toHaveTextContent(/in the press/);
});
