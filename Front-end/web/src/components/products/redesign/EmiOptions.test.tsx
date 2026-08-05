/**
 * EMI affordability widget mount contract.
 *
 * This suite exists because of a silent production failure: the component rendered a
 * per-instance `useId()` container and passed a `containerId` option to the widget.
 * Razorpay's bundle ignores `containerId` entirely and mounts into a HARDCODED
 * `#razorpay-affordability-widget`, so the widget loaded, built its iframe, found no
 * container and rendered nothing — with no console error. The EMI strip was dead on
 * every PDP and nothing caught it.
 *
 * The assertions below are the contract with Razorpay's bundle. If they fail, the
 * widget will not mount, whatever else looks fine.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import EmiOptions from './EmiOptions';

const WIDGET_ID = 'razorpay-affordability-widget';

type SuiteOpts = { key: string; amount: number };
let constructedWith: SuiteOpts | null = null;
let renderCalls = 0;
/** Set by a test to make the fake widget paint into whatever container it finds. */
let paintOnRender = false;

class FakeSuite {
  constructor(opts: SuiteOpts) {
    constructedWith = opts;
  }
  render() {
    renderCalls += 1;
    if (!paintOnRender) return;
    // Mirror the real bundle: mount into the fixed id, or do nothing if absent.
    const el = document.getElementById(WIDGET_ID);
    if (el) el.appendChild(document.createElement('iframe'));
  }
}

const TEST_KEY = 'rzp_test_unit';
let realKey: string | undefined;

beforeEach(() => {
  constructedWith = null;
  renderCalls = 0;
  paintOnRender = false;
  jest.useFakeTimers();

  // The component renders nothing without a key, and CI has no Razorpay env var —
  // so supply one here rather than letting every assertion pass vacuously against
  // an empty DOM. (next/jest puts NEXT_PUBLIC_* on process.env at runtime, it does
  // not inline them, so a plain assignment is enough.)
  realKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = TEST_KEY;

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
  if (realKey === undefined) delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  else process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = realKey;
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete (window as unknown as { RazorpayAffordabilitySuite?: unknown }).RazorpayAffordabilitySuite;
});

describe('EmiOptions — widget mount contract', () => {
  it('renders the container with the exact id Razorpay hardcodes', () => {
    const { container } = render(<EmiOptions price={130000} />);
    // Not `toBeInTheDocument` on a query by test id — the ID ITSELF is the contract.
    expect(container.querySelector(`#${WIDGET_ID}`)).not.toBeNull();
  });

  it('constructs the widget with key + amount in PAISE', async () => {
    render(<EmiOptions price={130000} />);
    await waitFor(() => expect(constructedWith).not.toBeNull());
    expect(constructedWith).toEqual({
      key: TEST_KEY,
      amount: 13000000, // ₹1,30,000 → paise
    });
    expect(renderCalls).toBe(1);
  });

  it('never passes containerId — the widget ignores it and the id must be fixed', async () => {
    render(<EmiOptions price={130000} />);
    await waitFor(() => expect(constructedWith).not.toBeNull());
    expect(constructedWith).not.toHaveProperty('containerId');
  });

  it('shows the fallback copy when the widget paints nothing', async () => {
    paintOnRender = false;
    render(<EmiOptions price={130000} />);
    await waitFor(() => expect(renderCalls).toBe(1));
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(await screen.findByText(/pay-later options are shown at checkout/i)).toBeInTheDocument();
  });

  it('stays quiet when the widget does paint', async () => {
    paintOnRender = true;
    render(<EmiOptions price={130000} />);
    await waitFor(() => expect(renderCalls).toBe(1));
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.queryByText(/pay-later options are shown at checkout/i)).not.toBeInTheDocument();
  });

  it('renders nothing below the EMI floor — no lender, so no promise', () => {
    const { container } = render(<EmiOptions price={500} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('always offers the "How EMI works" explainer — that part is ours, not Razorpay\'s', () => {
    render(<EmiOptions price={130000} />);
    expect(screen.getByText(/how emi works/i)).toBeInTheDocument();
  });
});
