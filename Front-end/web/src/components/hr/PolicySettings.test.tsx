/** Attendance rules: example lines follow the typed value, only changed fields are sent, server errors shown. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@/lib/api-types';
import PolicySettings from './PolicySettings';
import { wrap } from './testUtils';

const listShifts = jest.fn();
const updateShift = jest.fn();
const getSettings = jest.fn();
const updatePolicy = jest.fn();
jest.mock('@/lib/hr/api', () => ({
  hrApi: {
    listShifts: (...a: unknown[]) => listShifts(...a),
    updateShift: (...a: unknown[]) => updateShift(...a),
    getSettings: (...a: unknown[]) => getSettings(...a),
    updatePolicy: (...a: unknown[]) => updatePolicy(...a),
  },
}));

const shift = {
  id: 'S1', name: 'Showroom', start: '10:00', end: '19:00', graceMinutes: 10, earlyGraceMinutes: 10, absentBelowMinutes: 120,
  halfDayMinMinutes: 270, overtimeAfterMinutes: 540, latesPerHalfDayLop: 3, weeklyOff: [0], isDefault: true, active: true, rev: 4,
};
const settings = {
  marksPerHalfDayLop: 3, overtimeMultiplier: 2, punctualityBonusPaise: 50000, punctualityFullMaxMarks: 2, punctualityHalfMaxMarks: 4, rev: 7,
};

beforeEach(() => {
  [listShifts, updateShift, getSettings, updatePolicy].forEach((m) => m.mockReset());
  listShifts.mockResolvedValue({ items: [shift], nextCursor: null });
  getSettings.mockResolvedValue({ settings });
});

it('shows each rule with a plain example', async () => {
  wrap(<PolicySettings />);
  expect(await screen.findByText('Shift starts 10:00. Coming in after 10:10 = 1 mark.')).toBeTruthy();
  expect(screen.getByText('Shift ends 19:00. Leaving before 18:50 = 1 mark.')).toBeTruthy();
  expect(await screen.findByText(/^3 marks = ½ day salary cut\. 6 marks = 1 day/)).toBeTruthy();
  expect(screen.getByText(/₹500 a month\. Full for 0–2 marks\. Half for 3–4 marks\. None for 5\+ marks/)).toBeTruthy();
  expect(screen.getByText(/paid as 2 hours of normal pay/)).toBeTruthy();
});

it('the example follows what HR types', async () => {
  wrap(<PolicySettings />);
  fireEvent.change(await screen.findByLabelText('Marks per ½ day cut'), { target: { value: '4' } });
  expect(screen.getByText(/^4 marks = ½ day salary cut/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Late grace'), { target: { value: '15' } });
  expect(screen.getByText(/after 10:15 = 1 mark/)).toBeTruthy();
});

it('saves only the month rules that changed, bonus in paise, with the rev', async () => {
  updatePolicy.mockResolvedValue({ settings: { ...settings, punctualityBonusPaise: 60000, rev: 8 } });
  wrap(<PolicySettings />);
  fireEvent.change(await screen.findByLabelText('Punctuality bonus'), { target: { value: '600' } });
  fireEvent.click(screen.getByRole('button', { name: /save month rules/i }));
  await waitFor(() => expect(updatePolicy).toHaveBeenCalledWith(7, { punctualityBonusPaise: 60000 }));
  expect(await screen.findByText('Saved.')).toBeTruthy();
});

it('refuses a half-bonus limit below the full-bonus limit without calling the server', async () => {
  wrap(<PolicySettings />);
  fireEvent.change(await screen.findByLabelText('Half bonus up to'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: /save month rules/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/half bonus limit/i);
  expect(updatePolicy).not.toHaveBeenCalled();
});

it('saves changed shift rules with the shift rev and shows a server conflict', async () => {
  updateShift.mockRejectedValue(new ApiError(409, 'Changed by someone else. Reload.', '/x'));
  wrap(<PolicySettings />);
  const form = await screen.findByRole('form', { name: /rules for showroom/i });
  fireEvent.change(within(form).getByLabelText('Overtime after'), { target: { value: '570' } });
  fireEvent.click(within(form).getByRole('button', { name: /save shift rules/i }));
  await waitFor(() => expect(updateShift).toHaveBeenCalledWith('S1', 4, { overtimeAfterMinutes: 570 }));
  expect(await within(form).findByRole('alert')).toHaveTextContent(/someone else/i);
});

it('shows loading, empty and error states', async () => {
  listShifts.mockReturnValue(new Promise(() => {}));
  getSettings.mockRejectedValue(new ApiError(500, 'x', '/x'));
  const { unmount } = wrap(<PolicySettings />);
  expect(screen.getAllByRole('status')[0]).toHaveTextContent(/loading/i);
  expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  unmount();
  listShifts.mockResolvedValue({ items: [], nextCursor: null });
  wrap(<PolicySettings />);
  expect(await screen.findByText(/no shifts yet/i)).toBeTruthy();
});
