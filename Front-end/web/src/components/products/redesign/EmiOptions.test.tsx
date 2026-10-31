/**
 * EMI affordability widget — mount contract, key source, and the honest fallback.
 *
 * This suite exists because of TWO silent production failures, both of which left a
 * blank strip on every PDP with nothing in the console a human would notice:
 *
 * 1. The component rendered a per-instance `useId()` container and passed a
 *    `containerId` option. Razorpay's bundle ignores `containerId` and mounts into a
 *    HARDCODED `#razorpay-affordability-widget`, so the widget found no container.
 *
 * 2. The key was a build-time NEXT_PUBLIC_RAZORPAY_KEY_ID that went stale after a key
 *    rotation. Razorpay answered it with 401, the widget collapsed its iframe to 0×0 —
 *    and because "painted" meant "an iframe was inserted", the fallback line was
 *    suppressed too. The key now comes from the backend (the one checkout uses), and
 *    "painted" means Razorpay REPORTED a visible height.
 *
 * The fake widget below mirrors what the real bundle does to the DOM: insert an iframe
 * at a default 105px, then later write the reported height (0 → also `display:none` on
 * the container).
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmiOptions from './EmiOptions';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
const get = apiClient.get as jest.Mock;

const WIDGET_ID = 'razorpay-affordability-widget';
const FALLBACK = /pay-later options are shown at checkout/i;
const SERVED_KEY = 'rzp_live_aaaaaa';
/** How long after render() the fake frame "reports" its height. */
const REPORT_DELAY_MS = 300;

type SuiteOpts = { key: string; amount: number };
/**
 * - none:     render() does nothing (CDN/script edge cases)
 * - silent:   inserts the iframe at its default 105px and never reports
 * - collapse: inserts, then reports 0 (what a 401 / no-lender / disabled account does)
 * - paint:    inserts, then reports a real height
 * - zeroWide: inserts at width 0 (container measured 0px wide), then reports a height
 */
type Mode = 'none' | 'silent' | 'collapse' | 'paint' | 'zeroWide';

let constructedWith: SuiteOpts | null = null;
let renderCalls = 0;
let mode: Mode = 'none';

function reportHeight(px: number) {
  const el = document.getElementById(WIDGET_ID);
  const iframe = el?.querySelector('iframe');
  if (!el || !iframe) return;
  iframe.height = `${px ? px + 5 : px}px`;
  el.style.display = px === 0 ? 'none' : 'block';
}

class FakeSuite {
  constructor(opts: SuiteOpts) {
    constructedWith = opts;
  }
  render() {
    renderCalls += 1;
    if (mode === 'none') return;
    const el = document.getElementById(WIDGET_ID);
    if (!el) return; // the real bundle silently does nothing without its container
    const iframe = document.createElement('iframe');
    iframe.setAttribute('loading', 'lazy'); // the real bundle does this
    iframe.height = '105px';
    iframe.width = mode === 'zeroWide' ? '0px' : '400px';
    el.appendChild(iframe);
    if (mode === 'collapse') setTimeout(() => reportHeight(0), REPORT_DELAY_MS);
    if (mode === 'paint' || mode === 'zeroWide') setTimeout(() => reportHeight(80), REPORT_DELAY_MS);
  }
}

function renderEmi(price = 130000) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EmiOptions price={price} />
    </QueryClientProvider>
  );
}

let realEnvKey: string | undefined;

beforeEach(() => {
  constructedWith = null;
  renderCalls = 0;
  mode = 'none';
  jest.useFakeTimers();
  get.mockReset();
  get.mockResolvedValue({ success: true, data: { keyId: SERVED_KEY } });

  // A stale build-time key must be IGNORED. Set one so a regression back to reading
  // it shows up as the wrong key in `constructedWith`, not as a vacuous pass.
  realEnvKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = 'rzp_live_bbbbbb';

  // The component injects the CDN <script> itself; stub the load so onload fires
  // and the constructor is available, without touching the network.
  //
  // Intercept ONLY <script>. Everything else must reach the real appendChild —
  // React Testing Library mounts its own container through document.body, so
  // swallowing all appends silently unmounts the component under test and turns
  // "element not found" assertions into false passes.
  (window as unknown as { RazorpayAffordabilitySuite?: unknown }).RazorpayAffordabilitySuite = FakeSuite;
  const realAppendChild = document.body.appendChild.bind(document.body);
  jest
    .spyOn(document.body, 'appendChild')
    .mockImplementation((node) => {
      if ((node as HTMLElement).tagName === 'SCRIPT') {
        queueMicrotask(() => (node as HTMLScriptElement).onload?.(new Event('load')));
        return node;
      }
      return realAppendChild(node);
    });
});

afterEach(() => {
  if (realEnvKey === undefined) delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  else process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = realEnvKey;
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete (window as unknown as { RazorpayAffordabilitySuite?: unknown }).RazorpayAffordabilitySuite;
});

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('EmiOptions — widget mount contract', () => {
  it('renders the container with the exact id Razorpay hardcodes', async () => {
    const { container } = renderEmi();
    await waitFor(() => expect(constructedWith).not.toBeNull());
    // Not `toBeInTheDocument` on a query by test id — the ID ITSELF is the contract.
    expect(container.querySelector(`#${WIDGET_ID}`)).not.toBeNull();
  });

  it('constructs the widget with key + amount in PAISE', async () => {
    renderEmi();
    await waitFor(() => expect(constructedWith).not.toBeNull());
    expect(constructedWith).toEqual({
      key: SERVED_KEY,
      amount: 13000000, // ₹1,30,000 → paise
    });
    expect(renderCalls).toBe(1);
  });

  it('never passes containerId — the widget ignores it and the id must be fixed', async () => {
    renderEmi();
    await waitFor(() => expect(constructedWith).not.toBeNull());
    expect(constructedWith).not.toHaveProperty('containerId');
  });

  // Razorpay sizes its iframe from container.clientWidth at mount. Anything that
  // zeroes the width before the widget paints (w-0, display:none, position:absolute)
  // produces a 0px-wide iframe that never becomes visible, no matter what we do
  // afterwards. Only the height may collapse while we wait.
  it('never zeroes the container width while the widget is still loading', async () => {
    const { container } = renderEmi();
    await waitFor(() => expect(container.querySelector(`#${WIDGET_ID}`)).not.toBeNull());
    const wrapper = container.querySelector(`#${WIDGET_ID}`)!.parentElement!;
    // Compare exact class TOKENS — a regex like /\bhidden\b/ also matches inside
    // `overflow-hidden`, which is legitimate and must stay.
    const tokens = wrapper.className.split(/\s+/);
    expect(tokens).not.toContain('w-0');
    expect(tokens).not.toContain('hidden');
    expect(tokens).not.toContain('absolute');
    expect(tokens).not.toContain('fixed');
  });

  it('always offers the "How EMI works" explainer — that part is ours, not Razorpay\'s', async () => {
    renderEmi();
    expect(screen.getByText(/how emi works/i)).toBeInTheDocument();
    await waitFor(() => expect(constructedWith).not.toBeNull());
  });
});

describe('EmiOptions — key source (single source: the backend checkout uses)', () => {
  it('takes the key from /payment-config/razorpay, ignoring any baked-in env key', async () => {
    renderEmi();
    await waitFor(() => expect(constructedWith).not.toBeNull());
    expect(get).toHaveBeenCalledWith('/payment-config/razorpay', expect.anything());
    expect(constructedWith!.key).toBe(SERVED_KEY);
    expect(constructedWith!.key).not.toBe(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID);
  });

  it('renders nothing — not even the fallback line — when the backend has no key (503)', async () => {
    get.mockRejectedValue(Object.assign(new Error('Payment configuration unavailable'), { status: 503 }));
    const { container } = renderEmi();
    // The hook retries once; give it time to settle.
    await waitFor(() => expect(container).toBeEmptyDOMElement(), { timeout: 5000 });
    advance(5000);
    expect(container).toBeEmptyDOMElement();
    expect(constructedWith).toBeNull();
  });

  it('renders nothing when the backend answers with a value that is not a Razorpay key id', async () => {
    get.mockResolvedValue({ success: true, data: { keyId: '<html>proxy error</html>' } });
    const { container } = renderEmi();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(constructedWith).toBeNull();
  });

  it('renders nothing below the EMI floor — no lender, so no promise', async () => {
    const { container } = renderEmi(500);
    expect(container).toBeEmptyDOMElement();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(container).toBeEmptyDOMElement();
    expect(constructedWith).toBeNull();
  });
});

describe('EmiOptions — honest fallback (painted only when Razorpay reports a visible height)', () => {
  it('stays quiet and reveals the strip when the widget reports a real height', async () => {
    mode = 'paint';
    const { container } = renderEmi();
    await waitFor(() => expect(renderCalls).toBe(1));
    advance(REPORT_DELAY_MS + 10);
    const wrapper = container.querySelector(`#${WIDGET_ID}`)!.parentElement!;
    await waitFor(() => expect(wrapper.className).toContain('opacity-100'));
    advance(4000);
    expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
    expect(wrapper.className).toContain('opacity-100');
  });

  // THE production bug: Razorpay rejected the key (401), inserted its iframe and then
  // collapsed it to 0×0. Inserting an iframe used to count as "painted".
  it('shows the fallback as soon as the widget collapses to 0×0 — without waiting for the timeout', async () => {
    mode = 'collapse';
    const { container } = renderEmi();
    await waitFor(() => expect(renderCalls).toBe(1));
    advance(REPORT_DELAY_MS + 10);
    expect(await screen.findByText(FALLBACK)).toBeInTheDocument();
    // The strip itself stays collapsed: no blank gap above the fallback line.
    const wrapper = container.querySelector(`#${WIDGET_ID}`)!.parentElement!;
    expect(wrapper.className.split(/\s+/)).toContain('h-0');
  });

  // Razorpay marks the frame loading="lazy"; inside our collapsed wrapper it is clipped
  // to zero area, so the browser never loads it, it never reports, and we never reveal
  // it. The component must un-lazy it.
  it('switches the widget frame to eager loading so the collapsed wrapper cannot starve it', async () => {
    mode = 'silent';
    const { container } = renderEmi();
    await waitFor(() => expect(renderCalls).toBe(1));
    const iframe = container.querySelector(`#${WIDGET_ID} iframe`)!;
    expect(iframe.getAttribute('loading')).toBe('eager');
  });

  it('shows the fallback when the iframe sits at its default size and never reports', async () => {
    mode = 'silent';
    renderEmi();
    await waitFor(() => expect(renderCalls).toBe(1));
    advance(1000);
    // Still deciding — an inserted iframe is not a verdict.
    expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
    advance(4000);
    expect(await screen.findByText(FALLBACK)).toBeInTheDocument();
  });

  it('shows the fallback when the widget paints nothing at all', async () => {
    mode = 'none';
    renderEmi();
    await waitFor(() => expect(renderCalls).toBe(1));
    advance(4000);
    expect(await screen.findByText(FALLBACK)).toBeInTheDocument();
  });

  it('treats a zero-width iframe as not painted', async () => {
    mode = 'zeroWide';
    renderEmi();
    await waitFor(() => expect(renderCalls).toBe(1));
    advance(REPORT_DELAY_MS + 10);
    expect(await screen.findByText(FALLBACK)).toBeInTheDocument();
  });

  it('lets a late paint (after the timeout) replace the fallback line', async () => {
    mode = 'silent';
    const { container } = renderEmi();
    await waitFor(() => expect(renderCalls).toBe(1));
    advance(4000);
    expect(await screen.findByText(FALLBACK)).toBeInTheDocument();

    act(() => reportHeight(80));
    await waitFor(() => expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument());
    const wrapper = container.querySelector(`#${WIDGET_ID}`)!.parentElement!;
    expect(wrapper.className).toContain('opacity-100');
  });
});
