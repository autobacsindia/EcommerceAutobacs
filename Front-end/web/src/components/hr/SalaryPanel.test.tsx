/** Salary: history shows the server gross; a new row sends integer paise and no totals; states. */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api-types';
import SalaryPanel, { rupeesToPaise } from './SalaryPanel';
import { wrap } from './testUtils';

const salaryRows = jest.fn();
const addSalary = jest.fn();
jest.mock('@/lib/hr/api', () => ({
  hrApi: {
    salaryRows: (...a: unknown[]) => salaryRows(...a),
    addSalary: (...a: unknown[]) => addSalary(...a),
  },
}));

const row = {
  id: 'S1', employee: 'E1', effectiveFrom: '2026-04', grossMonthlyPaise: 3000000,
  components: [{ code: 'basic', label: 'Basic', kind: 'earning', monthlyPaise: 3000000, prorate: true }],
  pfApplicable: true, pfCapAtCeiling: true, esiApplicable: false, ptState: '', overtimeEligible: true, overtimeMultiplier: null,
  punctualityBonusEligible: true, tdsMonthlyPaise: 0, reason: 'Joining salary', createdAt: '2026-04-01T00:00:00Z',
};

beforeEach(() => { salaryRows.mockReset(); addSalary.mockReset(); });

it('converts typed rupees to whole paise and rejects junk', () => {
  expect(rupeesToPaise('15000')).toBe(1500000);
  expect(rupeesToPaise('15,000.5')).toBe(1500050);
  expect(rupeesToPaise('0.07')).toBe(7);
  expect(rupeesToPaise('12.345')).toBeNull();
  expect(rupeesToPaise('-5')).toBeNull();
  expect(rupeesToPaise('')).toBeNull();
});

it('shows the server gross for each row', async () => {
  salaryRows.mockResolvedValue({ items: [row], nextCursor: null });
  wrap(<SalaryPanel employeeId="E1" />);
  expect(await screen.findByText('₹30,000 gross a month')).toBeTruthy();
  expect(screen.getByText(/No ESI/)).toBeTruthy();
});

it('adds a new row from the latest one, sending paise and never a total', async () => {
  salaryRows.mockResolvedValue({ items: [row], nextCursor: null });
  addSalary.mockResolvedValue({ structure: { ...row, id: 'S2' }, replay: false });
  wrap(<SalaryPanel employeeId="E1" />);
  fireEvent.click(await screen.findByRole('button', { name: /new salary/i }));
  fireEvent.change(screen.getByLabelText('Basic monthly ₹'), { target: { value: '32000' } });
  fireEvent.click(screen.getByRole('button', { name: /save salary/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/say why/i);
  fireEvent.change(screen.getByPlaceholderText(/joining salary/i), { target: { value: 'Annual raise' } });
  fireEvent.click(screen.getByRole('button', { name: /save salary/i }));
  await waitFor(() => expect(addSalary).toHaveBeenCalled());
  const [id, input] = addSalary.mock.calls[0];
  expect(id).toBe('E1');
  expect(input.components).toEqual([{ code: 'basic', label: 'Basic', kind: 'earning', monthlyPaise: 3200000, prorate: true }]);
  expect(input).not.toHaveProperty('grossMonthlyPaise');
  expect(input.esiApplicable).toBe(false);
  expect(input.reason).toBe('Annual raise');
});

it('shows the server refusal for a month that already has a salary', async () => {
  salaryRows.mockResolvedValue({ items: [row], nextCursor: null });
  addSalary.mockRejectedValue(new ApiError(409, 'A salary from 2026-04 already exists. Pay history is never edited.', '/x'));
  wrap(<SalaryPanel employeeId="E1" />);
  fireEvent.click(await screen.findByRole('button', { name: /new salary/i }));
  fireEvent.change(screen.getByPlaceholderText(/joining salary/i), { target: { value: 'Fix' } });
  fireEvent.click(screen.getByRole('button', { name: /save salary/i }));
  expect(await screen.findByText(/pay history is never edited/i)).toBeTruthy();
});

it('shows empty and error states; no add button for someone who left', async () => {
  salaryRows.mockResolvedValue({ items: [], nextCursor: null });
  const a = wrap(<SalaryPanel employeeId="E1" readOnly />);
  expect(await screen.findByText(/no salary yet/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /add salary/i })).toBeNull();
  a.unmount();
  salaryRows.mockRejectedValue(new ApiError(500, 'x', '/x'));
  wrap(<SalaryPanel employeeId="E1" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
});
