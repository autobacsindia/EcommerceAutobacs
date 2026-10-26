/** "Pop-ups on this device": each state says what to do; nothing shows without server keys. */
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
  disablePush: () => disable(),
  sendTestPush: () => test(),
  needsHomeScreen: () => homeScreen,
}));

beforeEach(() => { state.mockReset(); enable.mockReset(); disable.mockReset(); test.mockReset(); homeScreen = false; });

it('off → "Turn on" asks the browser and becomes On', async () => {
  state.mockResolvedValue('off');
  enable.mockResolvedValue('on');
  render(<PushToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
  await waitFor(() => expect(enable).toHaveBeenCalled());
  expect(await screen.findByText('On')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/you will get pop-ups/);
});

it('on → send a test, or turn off', async () => {
  state.mockResolvedValue('on');
  test.mockResolvedValue({ sent: 1 });
  disable.mockResolvedValue('off');
  render(<PushToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send a test' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/Sent\. No pop-up.*System Settings/);
  fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
  expect(await screen.findByRole('button', { name: 'Turn on' })).toBeInTheDocument();
});

it('blocked → explains how to allow it in the browser', async () => {
  state.mockResolvedValue('blocked');
  render(<PushToggle />);
  expect(await screen.findByText(/blocked for this site/)).toBeInTheDocument();
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

it('says so when the server reached no device, instead of "sent"', async () => {
  state.mockResolvedValue('on');
  test.mockResolvedValue({ sent: 0 });
  render(<PushToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send a test' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/could not be reached/);
});
