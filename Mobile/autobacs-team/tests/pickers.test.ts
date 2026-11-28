import { clampDate, dateToPicker, formatTime12, pickerToDate, pickerToTime, timeToPicker } from '../src/lib/pickers';

describe('picker conversions', () => {
  test('a date round-trips through the picker without shifting a day', () => {
    for (const d of ['2026-01-01', '2026-02-28', '2028-02-29', '2026-12-31', '2026-03-29']) {
      expect(pickerToDate(dateToPicker(d))).toBe(d);
    }
  });
  test('a bad date opens the picker on today rather than crashing', () => {
    expect(dateToPicker('2026-02-30')).toBeInstanceOf(Date);
  });
  test('time round-trips; 24-hour in, 12-hour shown', () => {
    expect(pickerToTime(timeToPicker('19:05'))).toBe('19:05');
    expect(pickerToTime(timeToPicker('7:05'))).toBe('07:05');
    expect(formatTime12('19:05')).toBe('7:05 pm');
    expect(formatTime12('00:30')).toBe('12:30 am');
    expect(formatTime12('12:00')).toBe('12:00 pm');
    expect(formatTime12('junk')).toBe('junk');
  });
  test('clampDate keeps a date inside the allowed range', () => {
    expect(clampDate('2026-11-30', '2026-12-01')).toBe('2026-12-01');
    expect(clampDate('2027-01-05', undefined, '2026-12-31')).toBe('2026-12-31');
    expect(clampDate('2026-12-10', '2026-12-01', '2026-12-31')).toBe('2026-12-10');
  });
});
