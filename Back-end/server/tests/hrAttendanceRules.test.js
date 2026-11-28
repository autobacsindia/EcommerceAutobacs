/**
 * Attendance + face rules as pure functions (no DB): day computation (late,
 * half day, breaks, overtime, overnight, auto-close, weekly off, holiday,
 * leave), punch sequence, workday of a punch, geofence, impossible jump,
 * liveness motion and the score mapping.
 */
import {
  computeDay, isValidSequence, stateAfter, FALLBACK_SHIFT,
} from '../services/hr/attendance/dayRules.js';
import { fenceVerdict, haversineM, isImpossibleJump } from '../services/hr/attendance/geo.js';
import {
  istDate, istInstant, addDays, weekday, monthDates, shiftWindow,
} from '../services/hr/attendance/time.js';
import {
  motionMatches, scoreOf, yawOf, cosine,
} from '../services/hr/face/liveness.js';
import { _workdayFor as workdayFor } from '../services/hr/attendance/punchService.js';
import { encodeTemplate, decodeTemplate, isImage } from '../services/hr/face/faceService.js';

const D = '2026-12-02'; // a Wednesday
const at = (hhmm, date = D) => istInstant(date, hhmm);
const p = (type, hhmm, extra = {}) => ({ type, at: at(hhmm, extra.date), status: 'accepted', source: 'app', ...extra });
const day = (punches, extra = {}) => computeDay({
  date: D, shift: FALLBACK_SHIFT, punches, today: '2026-12-10', ...extra,
});

describe('IST time helpers', () => {
  test('dates, weekdays and month lengths', () => {
    expect(istDate(new Date('2026-12-01T19:00:00Z'))).toBe('2026-12-02'); // 00:30 IST
    expect(weekday(D)).toBe(3);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(monthDates('2028-02')).toHaveLength(29);
    expect(at('10:00').toISOString()).toBe('2026-12-02T04:30:00.000Z');
  });
  test('overnight shift ends the next day', () => {
    const w = shiftWindow(D, { start: '22:00', end: '06:00' });
    expect(w.end - w.start).toBe(8 * 3600000);
  });
});

describe('computeDay', () => {
  test('on time, full day: present, not late, no overtime', () => {
    const d = day([p('in', '10:05'), p('out', '19:05')]);
    expect(d).toMatchObject({ status: 'present', isLate: false, lateMinutes: 0, workedMinutes: 540, overtimeMinutes: 0 });
  });
  test('after the grace period is a late mark with the minutes from shift start', () => {
    const d = day([p('in', '10:25'), p('out', '19:30')]);
    expect(d).toMatchObject({ isLate: true, lateMinutes: 25 });
  });
  test('under halfDayMinMinutes worked is a half day', () => {
    expect(day([p('in', '10:00'), p('out', '13:00')]).status).toBe('half_day');
  });
  test('breaks within the allowance are paid; only the excess is deducted', () => {
    const within = day([p('in', '10:00'), p('break_start', '13:00'), p('break_end', '13:45'), p('out', '19:00')]);
    expect(within).toMatchObject({ workedMinutes: 540, breakMinutes: 45 });
    const over = day([p('in', '10:00'), p('break_start', '13:00'), p('break_end', '14:30'), p('out', '19:00')]);
    expect(over).toMatchObject({ workedMinutes: 510, breakMinutes: 90 });
  });
  test('overtime is worked minutes beyond overtimeAfterMinutes', () => {
    expect(day([p('in', '09:00'), p('out', '21:00')]).overtimeMinutes).toBe(180);
  });
  test('an auto-closed day never counts overtime', () => {
    const d = day([p('in', '08:00'), p('out', '22:00', { source: 'auto_close' })]);
    expect(d).toMatchObject({ autoClosed: true, overtimeMinutes: 0 });
  });
  test('two sessions in a day add up', () => {
    expect(day([p('in', '10:00'), p('out', '12:00'), p('in', '14:00'), p('out', '18:00')]).workedMinutes).toBe(360);
  });
  test('no punches on a working day is absent; weekly off / holiday / leave are not', () => {
    expect(day([]).status).toBe('absent');
    expect(computeDay({ date: '2026-12-06', punches: [], today: '2026-12-10' }).status).toBe('weekly_off'); // Sunday
    expect(day([], { holiday: true }).status).toBe('holiday');
    expect(day([], { leave: { halves: 2 } }).status).toBe('leave');
    expect(day([p('in', '14:00'), p('out', '19:00')], { leave: { halves: 1 } })).toMatchObject({ status: 'half_leave', isLate: false });
  });
  test('punches on a holiday are holiday_worked', () => {
    expect(day([p('in', '10:00'), p('out', '19:00')], { holiday: true }).status).toBe('holiday_worked');
  });
  test('pending punches do not count but flag the day; an open past day needs review', () => {
    const d = day([p('in', '10:00'), p('out', '19:00', { status: 'pending_review' })]);
    expect(d).toMatchObject({ needsReview: true, workedMinutes: 0 });
    expect(day([p('in', '10:00')]).needsReview).toBe(true);
    expect(day([p('in', '10:00')], { today: D })).toMatchObject({ needsReview: false, status: 'present' });
  });
});

describe('sequence rules', () => {
  test.each([
    [['in'], true], [['in', 'in'], false], [['break_start'], false], [['in', 'break_end'], false],
    [['in', 'break_start', 'break_end', 'out'], true], [['in', 'break_start', 'out'], true],
    [['in', 'out', 'in', 'out'], true], [['out'], false], [['in', 'break_start', 'break_start'], false],
  ])('%j valid=%s', (types, ok) => {
    expect(isValidSequence(types.map((type) => ({ type })))).toBe(ok);
  });
  test('stateAfter', () => {
    expect(stateAfter([{ type: 'in' }, { type: 'break_start' }])).toBe('break');
    expect(stateAfter([])).toBe('none');
  });
  test('an out after midnight belongs to the open overnight day before', () => {
    const y = '2026-12-01';
    const byDate = { [y]: [p('in', '22:00', { date: y })] };
    expect(workdayFor('out', at('02:00'), byDate)).toBe(y);
    expect(workdayFor('in', at('09:00'), byDate)).toBe(D);
    expect(workdayFor('out', at('19:00'), { [D]: [p('in', '10:00')] })).toBe(D);
  });
});

describe('geofence', () => {
  const site = { _id: 's1', lat: 12.9716, lng: 77.5946, radiusM: 100 };
  test('haversine is right to within a metre over ~1.1 km', () => {
    expect(Math.round(haversineM(12.9716, 77.5946, 12.9816, 77.5946))).toBeGreaterThan(1100);
    expect(Math.round(haversineM(12.9716, 77.5946, 12.9816, 77.5946))).toBeLessThan(1115);
  });
  test('inside, outside, anywhere allowed, no sites', () => {
    expect(fenceVerdict({ lat: 12.9717, lng: 77.5946 }, [site])).toMatchObject({ verdict: 'inside', site: 's1' });
    expect(fenceVerdict({ lat: 12.9816, lng: 77.5946 }, [site])).toMatchObject({ verdict: 'outside', site: null });
    expect(fenceVerdict({ lat: 12.9816, lng: 77.5946 }, [site], { anywhereAllowed: true }).verdict).toBe('anywhere_allowed');
    expect(fenceVerdict({ lat: 1, lng: 1 }, []).verdict).toBe('outside');
  });
  test('impossible jump: 300 km in 30 minutes, but not 2 km in 1 minute (GPS noise)', () => {
    const t = new Date('2026-12-02T05:00:00Z');
    expect(isImpossibleJump({ lat: 12.97, lng: 77.59, at: t }, { lat: 13.08, lng: 80.27, at: new Date(t.getTime() + 1800000) })).toBe(true);
    expect(isImpossibleJump({ lat: 12.97, lng: 77.59, at: t }, { lat: 12.99, lng: 77.59, at: new Date(t.getTime() + 60000) })).toBe(false);
    expect(isImpossibleJump(null, { lat: 1, lng: 1, at: t })).toBe(false);
  });
});

describe('face: liveness motion and score', () => {
  const lm = (yaw) => [[300, 200], [360, 200], [330 + yaw * 60, 230], [310, 260], [350, 260]];
  const face = (yaw, w = 200) => ({ landmarks: lm(yaw), box: { w } });
  test('yaw from landmarks', () => {
    expect(yawOf(lm(0))).toBeCloseTo(0);
    expect(yawOf(lm(0.3))).toBeCloseTo(0.3);
  });
  test('turn left / right / closer, and mirrored frames flip the turn', () => {
    expect(motionMatches('turn_left', face(0), face(0.3))).toBe(true);
    expect(motionMatches('turn_left', face(0), face(-0.3))).toBe(false);
    expect(motionMatches('turn_right', face(0), face(-0.3))).toBe(true);
    expect(motionMatches('turn_left', face(0), face(-0.3), { mirrored: true })).toBe(true);
    expect(motionMatches('turn_left', face(0), face(0.05))).toBe(false);
    expect(motionMatches('move_closer', face(0, 200), face(0, 240))).toBe(true);
    expect(motionMatches('move_closer', face(0, 200), face(0, 205))).toBe(false);
    expect(motionMatches('blink', face(0), face(0))).toBe(false);
  });
  test('score maps the engine cut-off to the anchor, monotonic, bounded', () => {
    expect(scoreOf(0.363, 0.363, 0.6)).toBe(0.6);
    expect(scoreOf(1, 0.363, 0.6)).toBe(1);
    expect(scoreOf(-1, 0.363, 0.6)).toBe(0);
    expect(scoreOf(0.5, 0.363, 0.6)).toBeGreaterThan(scoreOf(0.4, 0.363, 0.6));
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  test('template round-trips through encryption and is not readable at rest', () => {
    const enc = encodeTemplate([0.1, 0.2, -0.3], 'm1');
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(enc).not.toContain('0.1');
    const t = decodeTemplate(enc);
    expect(t.modelVersion).toBe('m1');
    expect(Array.from(t.embedding).map((x) => Math.round(x * 10) / 10)).toEqual([0.1, 0.2, -0.3]);
  });
  test('only JPEG/PNG bytes count as images', () => {
    expect(isImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]))).toBe(true);
    expect(isImage(Buffer.from('GIF89a-------'))).toBe(false);
  });
});

describe('ONNX engine helpers (synthetic numbers, no model)', () => {
  let eng;
  beforeAll(async () => { eng = await import('../services/hr/face/engines/onnxEngine.js'); });

  test('similarity transform recovers a known scale + rotation + shift', () => {
    const src = [[10, 10], [30, 12], [20, 25], [12, 35], [28, 36]];
    const [a0, b0, tx0, ty0] = [1.5 * Math.cos(0.2), 1.5 * Math.sin(0.2), 7, -3];
    const dst = src.map(([x, y]) => [a0 * x - b0 * y + tx0, b0 * x + a0 * y + ty0]);
    const [a, b, tx, ty] = eng.similarityTransform(src, dst);
    expect(a).toBeCloseTo(a0, 6);
    expect(b).toBeCloseTo(b0, 6);
    expect(tx).toBeCloseTo(tx0, 6);
    expect(ty).toBeCloseTo(ty0, 6);
  });

  test('aligned input samples the image through the inverse transform', () => {
    const width = 4; const height = 4;
    const rgb = new Uint8Array(width * height * 3).fill(200);
    const out = eng.alignedInput({ rgb, width, height }, [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]]);
    expect(out).toHaveLength(3 * 112 * 112);
    expect(Math.max(...out)).toBeLessThanOrEqual(200);
  });

  test('detections decode from YuNet-shaped outputs, with NMS and padding filtered', () => {
    const outputs = {};
    for (const s of [8, 16, 32]) {
      const cells = (640 / s) ** 2;
      outputs[`cls_${s}`] = { data: new Float32Array(cells) };
      outputs[`obj_${s}`] = { data: new Float32Array(cells) };
      outputs[`bbox_${s}`] = { data: new Float32Array(cells * 4) };
      outputs[`kps_${s}`] = { data: new Float32Array(cells * 10) };
    }
    const put = (s, r, c, score) => {
      const i = r * (640 / s) + c;
      outputs[`cls_${s}`].data[i] = score; outputs[`obj_${s}`].data[i] = score;
      outputs[`bbox_${s}`].data.set([0.5, 0.5, Math.log(4), Math.log(4)], i * 4);
    };
    put(32, 5, 5, 0.95); // a face centred at (176,176), 128 px
    put(32, 5, 6, 0.9); // overlapping duplicate → suppressed
    put(32, 15, 15, 0.99); // in the letterbox padding of a 400×400 image → dropped
    const faces = eng.decodeDetections(outputs, { width: 400, height: 400 });
    expect(faces).toHaveLength(1);
    const { x, y, w, h } = faces[0].box;
    expect([x, y, w, h].map(Math.round)).toEqual([112, 112, 128, 128]);
    expect(faces[0].landmarks).toHaveLength(5);
  });
});
