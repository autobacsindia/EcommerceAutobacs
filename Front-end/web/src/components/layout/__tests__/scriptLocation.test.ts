import { scriptLocation } from '../ClientErrorReporter';

// "Invalid or unexpected token" arrives with no useful stack, so the report carries
// which script it came from — our chunk vs. something an in-app browser injected.
describe('scriptLocation', () => {
  it('our own chunk → its path, without origin or the ?dpl= query', () => {
    expect(scriptLocation({
      filename: `${window.location.origin}/_next/static/chunks/app/products/page-abc.js?dpl=dpl_123`,
      lineno: 1, colno: 2045,
    })).toEqual({ script: '/_next/static/chunks/app/products/page-abc.js', line: 1, col: 2045 });
  });

  it('another site’s script → keeps its origin so it is recognisable', () => {
    expect(scriptLocation({ filename: 'https://connect.facebook.net/en_US/fbevents.js?v=2', lineno: 3, colno: 4 }))
      .toEqual({ script: 'https://connect.facebook.net/en_US/fbevents.js', line: 3, col: 4 });
  });

  it('no filename (inline / injected code) → "inline"', () => {
    expect(scriptLocation({ filename: '', lineno: 0, colno: 0 })).toEqual({ script: 'inline', line: 0, col: 0 });
  });

  it('uses a key the backend keeps (it drops any key containing "file")', () => {
    const keys = Object.keys(scriptLocation({ filename: '', lineno: 1, colno: 1 }));
    // Mirrors BLOCKED_CONTEXT_KEY in Back-end/server/utils/clientErrorScrub.js.
    const blocked = /name|email|phone|mobile|contact|address|pass|secret|token|key|sig|otp|card|cvv|upi|vpa|gstin|file|cookie|auth|session/i;
    expect(keys.filter((k) => blocked.test(k))).toEqual([]);
  });
});
