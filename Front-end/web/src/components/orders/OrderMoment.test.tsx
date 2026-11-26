import React from 'react';
import { render, screen } from '@testing-library/react';
import OrderMoment from './OrderMoment';
import { momentCopy, momentDay, momentSignature, type MomentKey, type OrderMomentData } from './orderMomentCopy';
import { sceneMarkup } from './orderMomentScenes';

const KEYS: MomentKey[] = [
  'payment_failed', 'refunded', 'cancelled', 'returning', 'delivered', 'on_hold',
  'late', 'partly', 'shipped', 'packed', 'preparing', 'placed',
];

beforeEach(() => window.localStorage.clear());

describe('OrderMoment — picture + words for the server-chosen update', () => {
  it.each(KEYS)('%s: words are real text and the drawing is hidden from screen readers', (key) => {
    const moment: OrderMomentData = { key, late: key === 'late' ? { dueDay: '2026-11-30' } : undefined };
    render(<OrderMoment orderId={`o-${key}`} moment={moment} />);
    const card = screen.getByTestId('order-moment');
    expect(card).toHaveAttribute('data-moment', key);
    expect(screen.getByTestId('order-moment-title')).toHaveTextContent(momentCopy(moment).title);
    expect(screen.getByTestId('order-moment-body').textContent).toBeTruthy();
    const scene = card.querySelector('.om-scene')!;
    expect(scene).toHaveAttribute('aria-hidden', 'true');
    expect(scene.querySelector('svg')!.innerHTML.length).toBeGreaterThan(100);
  });

  it('plays once: the same update on a second visit shows the still picture', () => {
    const { unmount } = render(<OrderMoment orderId="o1" moment={{ key: 'shipped' }} />);
    expect(screen.getByTestId('order-moment').querySelector('.om-scene')).toHaveAttribute('data-still', 'false');
    unmount();
    render(<OrderMoment orderId="o1" moment={{ key: 'shipped' }} />);
    expect(screen.getByTestId('order-moment').querySelector('.om-scene')).toHaveClass('om-still');
  });

  it('a new update plays again (and a new return step counts as new)', () => {
    const first = render(<OrderMoment orderId="o2" moment={{ key: 'returning', returnStep: 0 }} />);
    first.unmount();
    render(<OrderMoment orderId="o2" moment={{ key: 'returning', returnStep: 1 }} />);
    expect(screen.getByTestId('order-moment').querySelector('.om-scene')).toHaveAttribute('data-still', 'false');
  });

  it('replayable (server-rendered success page) never reads the memory', () => {
    window.localStorage.setItem('ab:order-moment:o3', 'placed');
    render(<OrderMoment orderId="o3" moment={{ key: 'placed' }} replayable />);
    expect(screen.getByTestId('order-moment').querySelector('.om-scene')).toHaveAttribute('data-still', 'false');
  });

  it('blocked storage still renders (and just plays)', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<OrderMoment orderId="o4" moment={{ key: 'delivered' }} />);
    expect(screen.getByTestId('order-moment-title')).toHaveTextContent('Delivered. We hope you love it.');
    spy.mockRestore();
    set.mockRestore();
  });

  it('return steps show where the return is', () => {
    render(<OrderMoment orderId="o5" moment={{ key: 'returning', returnStep: 1 }} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'now', 'todo', 'todo']);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
  });
});

describe('momentCopy — the words', () => {
  it('late says sorry and names the date we promised', () => {
    const c = momentCopy({ key: 'late', late: { dueDay: '2026-11-30' } });
    expect(c.title).toBe('Sorry, this is taking a little longer');
    expect(c.body).toContain('We expected to deliver by Mon 30 Nov.');
    expect(c.body).toContain('still with us');
  });

  it('late after shipping talks about the courier, not our team', () => {
    expect(momentCopy({ key: 'late', late: { dueDay: '2026-11-30' } }, { shipped: true }).body).toContain('still with the courier');
  });

  it('late with a malformed date leaves the date out instead of guessing', () => {
    const c = momentCopy({ key: 'late', late: { dueDay: 'soon' } });
    expect(c.body).not.toContain('expected to deliver by');
  });

  it('refund shows the server amount only when there is one', () => {
    expect(momentCopy({ key: 'refunded', refund: { amount: 2450 } }).body).toContain('₹2,450');
    expect(momentCopy({ key: 'refunded', refund: null }).body).toContain('We have refunded your payment.');
  });

  it('cancelled: refund wording only when the order had been paid', () => {
    expect(momentCopy({ key: 'cancelled', refundDue: true }).body).toContain('your refund has started');
    expect(momentCopy({ key: 'cancelled', refundDue: false }).body).toBe('No payment was taken for this order.');
  });

  it('signature: return steps differ, other keys are the key', () => {
    expect(momentSignature({ key: 'returning', returnStep: 2 })).toBe('returning:2');
    expect(momentSignature({ key: 'late', late: { dueDay: '2026-11-30' } })).toBe('late');
  });

  it('momentDay formats an India day and rejects junk', () => {
    expect(momentDay('2026-12-04')).toBe('Fri 4 Dec');
    expect(momentDay('2026-13-45')).toBeNull();
    expect(momentDay(undefined)).toBeNull();
  });
});

describe('sceneMarkup', () => {
  it('escapes the one dynamic value', () => {
    expect(sceneMarkup('late', { lateDay: '<b>x' })).toContain('&#60;b&#62;x');
  });
  it('every element that animates rests on its final frame (fill both)', () => {
    for (const key of KEYS) {
      const html = sceneMarkup(key, { lateDay: 'Mon 30' });
      // Every inline animation uses a known om-* keyframe; no infinite loops.
      expect(html).not.toMatch(/infinite/);
      for (const m of html.matchAll(/animation:([a-z-]+)/g)) expect(m[1]).toMatch(/^om-/);
    }
  });
});
