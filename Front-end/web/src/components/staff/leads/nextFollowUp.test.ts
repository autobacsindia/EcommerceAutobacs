import { fromIstInput, istAt, nextChoices, toIstInput } from './nextFollowUp';

const ist = (s: string) => new Date(`${s}+05:30`);

test('quick choices are in India time, and "this evening" only before 5 pm', () => {
  const morning = nextChoices(ist('2026-11-17T09:30:00'));
  expect(morning.map((c) => c.key)).toEqual(['hour', 'evening', 'tomorrow', 'three']);
  expect(morning[1].at.toISOString()).toBe(ist('2026-11-17T18:00:00').toISOString());
  expect(morning[2].at.toISOString()).toBe(ist('2026-11-18T11:00:00').toISOString());
  expect(morning[3].at.toISOString()).toBe(ist('2026-11-20T11:00:00').toISOString());
  expect(nextChoices(ist('2026-11-17T17:30:00')).map((c) => c.key)).toEqual(['hour', 'tomorrow', 'three']);
  // Just after midnight India time is still "today" in India.
  expect(istAt(ist('2026-11-18T00:20:00'), 0, 18).toISOString()).toBe(ist('2026-11-18T18:00:00').toISOString());
});

test('the date box reads and writes India time', () => {
  expect(toIstInput(ist('2026-11-17T16:05:00'))).toBe('2026-11-17T16:05');
  expect(fromIstInput('2026-11-17T16:05')).toBe(ist('2026-11-17T16:05:00').toISOString());
  expect(fromIstInput('')).toBe('');
  expect(fromIstInput('nonsense')).toBe('');
});
