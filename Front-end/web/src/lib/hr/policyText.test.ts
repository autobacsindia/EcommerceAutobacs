import { addMinutes, hoursText, policyText } from './policyText';
import { daysLabel } from './format';
import { csvCell, toCsv } from './csv';

it('clock maths wraps and words are plain', () => {
  expect(addMinutes('10:00', 10)).toBe('10:10');
  expect(addMinutes('19:00', -10)).toBe('18:50');
  expect(addMinutes('23:55', 10)).toBe('00:05');
  expect(hoursText(270)).toBe('4 h 30 min');
  expect(hoursText(540)).toBe('9 h');
  expect(hoursText(45)).toBe('45 min');
});

it('marks and bonus examples', () => {
  expect(policyText.marksPerHalfDay(3)).toBe('3 marks = ½ day salary cut. 6 marks = 1 day. 2 marks = no cut.');
  expect(policyText.marksPerHalfDay(0)).toBe('Marks never cut salary.');
  expect(policyText.bonus('₹500', 2, 4)).toBe('₹500 a month. Full for 0–2 marks. Half for 3–4 marks. None for 5+ marks or any absence without approved leave.');
  expect(policyText.bonus('₹500', 2, 2)).toBe('₹500 a month. Full for 0–2 marks. None for 3+ marks or any absence without approved leave.');
  expect(policyText.bonus('₹500', 2, 3)).toContain('Half for 3 marks.');
});

it('day labels', () => {
  expect(daysLabel(0.5)).toBe('½ day');
  expect(daysLabel(1)).toBe('1 day');
  expect(daysLabel(1.5)).toBe('1½ days');
  expect(daysLabel(0)).toBe('0 days');
});

it('csv quotes and blocks formulas', () => {
  expect(csvCell('a,b')).toBe('"a,b"');
  expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  expect(csvCell(-3)).toBe('-3');
  expect(toCsv(['A', 'B'], [[1, null]])).toBe('A,B\r\n1,');
});
