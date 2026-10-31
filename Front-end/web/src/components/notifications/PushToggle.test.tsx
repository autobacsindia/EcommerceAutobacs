/**
 * "Pop-ups on this browser": each state says what to do, in this browser's own
 * words; the test says how far a pop-up got; nothing shows without server keys.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PushToggle from './PushToggle';

const state = jest.fn();
const enable = jest.fn();
const disable = jest.fn();
const test = jest.fn();
let homeScreen = false;
jest.mock('@/lib/push', () => ({
  pushState: () => state(),
  enablePush: () => enable(),
  disablePush: (...a: unknown[]) => disable(...a),
  testThisBrowser: () => test(),
  needsHomeScreen: () => homeScreen,
}));
let mockPath = '/team';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const WIN_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const as = (ua: string, brave = false) => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
  if (brave) Object.defineProperty(navigator, 'brave', { configurable: true, value: { isBrave: async () => true } });
  else delete (navigator as unknown as { brave?: unknown }).brave;
};

beforeEach(() => {
  state.mockReset(); enable.mockReset(); disable.mockReset(); test.mockReset();
  homeScreen = false; mockPath = '/team';
  as(MAC_CHROME);
});

it('off → "Turn on" asks the browser and becomes ON, naming this browser', async () => {
  state.mockResolvedValue('off');
  enable.mockResolvedValue('on');
  render(<PushToggle />);
  expect(await screen.findByText('OFF')).toBeInTheDocument();
  expect(screen.getByText('Chrome on Mac')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
  await waitFor(() => expect(enable).toHaveBeenCalled());
  expect(await screen.findByText('ON')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/pop-ups are on for this browser/);
});

it('turning on fails in Brave → says exactly which Brave setting to switch on', async () => {
  as(MAC_CHROME, true);
  state.mockResolvedValue('off');
  enable.mockRejectedValue(new Error('Registration failed - push service error'));
  render(<PushToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/Use Google services for push messaging/);
});

it('the test arrived → "received", and if nothing showed, the Mac settings to check', async () => {
  state.mockResolvedValue('on');
  test.mockResolvedValue('received');
  render(<PushToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send me a test pop-up' }));
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent(/This browser received the test pop-up/);
  expect(status).toHaveTextContent(/System Settings → Notifications → Chrome/);
});

it('on Windows the same result points at the Windows settings', async () => {
  as(WIN_EDGE);
  state.mockResolvedValue('on');
  test.mockResolvedValue('received');
  render(<PushToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send me a test pop-up' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/Settings → System → Notifications.*Edge.*Do not disturb/);
});

it('the test never arrived / was refused / the service is down: each says so', async () => {
  state.mockResolvedValue('on');
  render(<PushToggle />);
  const press = async () => fireEvent.click(await screen.findByRole('button', { name: 'Send me a test pop-up' }));
  test.mockResolvedValueOnce('not-received');
  await press();
  expect(await screen.findByRole('status')).toHaveTextContent(/did not reach this browser/);
  test.mockResolvedValueOnce('refused');
  await press();
  expect(await screen.findByText(/refused this browser even after signing it up again/)).toBeInTheDocument();
  test.mockResolvedValueOnce('failed');
  await press();
  expect(await screen.findByText(/having trouble right now/)).toBeInTheDocument();
});

it('turn off is remembered, so the panel does not quietly sign this browser up again', async () => {
  state.mockResolvedValue('on');
  disable.mockResolvedValue('off');
  render(<PushToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
  expect(await screen.findByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  expect(disable).toHaveBeenCalledWith({ remember: true });
});

it('blocked → this browser\'s own steps, plus incognito and office-computer notes', async () => {
  as(WIN_EDGE);
  state.mockResolvedValue('blocked');
  render(<PushToggle />);
  expect(await screen.findByText('Blocked')).toBeInTheDocument();
  expect(screen.getByText(/blocked for this website in Edge on Windows/)).toBeInTheDocument();
  expect(screen.getByText(/Permissions for this site → Notifications → Allow/)).toBeInTheDocument();
  expect(screen.getByText(/incognito/)).toBeInTheDocument();
});

it('iPhone without Home Screen → says how; no server keys → hidden', async () => {
  state.mockResolvedValue('unsupported');
  homeScreen = true;
  const { unmount } = render(<PushToggle />);
  expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument();
  unmount();
  state.mockResolvedValue('unavailable');
  const { container } = render(<PushToggle />);
  await waitFor(() => expect(state).toHaveBeenCalledTimes(2));
  expect(container).toBeEmptyDOMElement();
});

it('the admin gets a link to the pop-up check; staff do not', async () => {
  state.mockResolvedValue('on');
  const { unmount } = render(<PushToggle />);
  await screen.findByText('ON');
  expect(screen.queryByRole('link', { name: /Who has pop-ups working/ })).toBeNull();
  unmount();
  mockPath = '/admin/orders';
  render(<PushToggle />);
  expect(await screen.findByRole('link', { name: /Who has pop-ups working/ })).toHaveAttribute('href', '/admin/pop-ups');
});
