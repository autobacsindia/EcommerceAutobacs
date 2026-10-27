/** The "turn on pop-ups" strip: shows only when the person can do something, and remembers "Not now". */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PushPrompt from './PushPrompt';

const resync = jest.fn();
const enable = jest.fn();
let optedOut = false;
let homeScreen = false;
jest.mock('@/lib/push', () => ({
  resyncPush: () => resync(),
  enablePush: () => enable(),
  pushOptedOut: () => optedOut,
  needsHomeScreen: () => homeScreen,
}));

beforeEach(() => {
  resync.mockReset();
  enable.mockReset();
  optedOut = false;
  homeScreen = false;
  localStorage.clear();
});

it('off → asks; "Turn on" asks the browser and says how to check', async () => {
  resync.mockResolvedValue('off');
  enable.mockResolvedValue('on');
  render(<PushPrompt />);
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
  await waitFor(() => expect(enable).toHaveBeenCalled());
  expect(await screen.findByRole('status')).toHaveTextContent(/Pop-ups are on.*Send a test.*System Settings/);
});

it('the browser\'s "Block" answer turns the strip into how to unblock', async () => {
  resync.mockResolvedValue('off');
  enable.mockResolvedValue('blocked');
  render(<PushPrompt />);
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
  expect(await screen.findByText(/blocked for this website/)).toBeInTheDocument();
});

it('"Not now" hides it for a week', async () => {
  resync.mockResolvedValue('off');
  const { unmount } = render(<PushPrompt />);
  fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  unmount();
  const { container } = render(<PushPrompt />);
  await waitFor(() => expect(resync).toHaveBeenCalledTimes(2));
  expect(container).toBeEmptyDOMElement();
});

it('nothing to do → nothing shown: already on, no server keys, or the person turned it off', async () => {
  for (const [state, out] of [['on', false], ['unavailable', false], ['off', true]] as const) {
    resync.mockResolvedValue(state);
    optedOut = out;
    const { container, unmount } = render(<PushPrompt />);
    await waitFor(() => expect(resync).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    unmount();
    resync.mockClear();
  }
});

it('blocked → how to unblock; iPhone without Home Screen → how to add it', async () => {
  resync.mockResolvedValue('blocked');
  const { unmount } = render(<PushPrompt />);
  expect(await screen.findByText(/blocked for this website/)).toBeInTheDocument();
  unmount();
  resync.mockResolvedValue('unsupported');
  homeScreen = true;
  render(<PushPrompt />);
  expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument();
});
