import { render } from '@testing-library/react';

const push = jest.fn();
jest.mock('@/lib/gtm', () => ({ pushToGtm: (e: unknown) => push(e) }));

import NotFoundTracker from './NotFoundTracker';

describe('NotFoundTracker', () => {
  beforeEach(() => push.mockClear());

  it('sends page_not_found with the path and referrer, once', () => {
    window.history.pushState({}, '', '/model/floor-mat/?x=1');
    Object.defineProperty(document, 'referrer', { value: 'https://www.google.com/', configurable: true });
    render(<NotFoundTracker />);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({
      event: 'page_not_found',
      page_path: '/model/floor-mat/?x=1',
      page_referrer: 'https://www.google.com/',
    });
  });

  it('marks a direct visit and never throws if analytics fails', () => {
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
    push.mockImplementationOnce(() => { throw new Error('blocked'); });
    expect(() => render(<NotFoundTracker />)).not.toThrow();
    expect(push.mock.calls[0][0].page_referrer).toBe('(direct)');
  });
});
