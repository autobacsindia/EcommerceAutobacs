import {
  RETURN_REASONS,
  ORIGINAL_REASONS,
  CUSTOMER_REASONS,
  STAFF_ONLY_REASONS,
  REASON_FAULT,
  RETURN_REASON_LABELS,
  claimedFaultFor,
  effectiveFault,
  windowDaysFor,
  VIDEO_MAX_MB,
  VIDEO_LINK_HOSTS,
  LONGEST_RETURN_WINDOW_DAYS,
  RETURN_WINDOW_DAYS,
} from '../../../config/returnPolicy.js';

describe('return policy — fault rules (2026-10-30)', () => {
  it('keeps every July reason valid, so old rows still validate', () => {
    for (const r of ORIGINAL_REASONS) expect(RETURN_REASONS).toContain(r);
  });

  it('maps every reason to a fault and a label', () => {
    for (const r of RETURN_REASONS) {
      expect(['ours', 'customer']).toContain(REASON_FAULT[r]);
      expect(RETURN_REASON_LABELS[r]).toEqual(expect.any(String));
    }
    expect(claimedFaultFor('ordered_wrong')).toBe('customer');
    expect(claimedFaultFor('changed_mind')).toBe('customer');
    expect(claimedFaultFor('missing_part')).toBe('ours');
    expect(claimedFaultFor('something_else')).toBe('ours');
  });

  it('never lets a customer self-certify installer damage', () => {
    expect(STAFF_ONLY_REASONS).toContain('installer_damage');
    expect(CUSTOMER_REASONS).not.toContain('installer_damage');
  });

  it("operations' confirmation beats the claim, the claim beats the reason", () => {
    expect(effectiveFault({ reason: 'changed_mind' })).toBe('customer');
    expect(effectiveFault({ reason: 'changed_mind', fault: { claimed: 'ours' } })).toBe('ours');
    expect(effectiveFault({ reason: 'wrong_item', fault: { claimed: 'ours', confirmed: 'customer' } })).toBe('customer');
    expect(effectiveFault({ reason: 'wrong_item', fault: { claimed: 'ours', confirmed: null } })).toBe('ours');
  });

  it('gives our-fault returns 7 days and customer reasons 4', () => {
    expect(windowDaysFor('ours')).toBe(7);
    expect(windowDaysFor('customer')).toBe(4);
    expect(RETURN_WINDOW_DAYS).toBe(4);
    expect(LONGEST_RETURN_WINDOW_DAYS).toBe(7);
  });

  it('caps the unboxing video upload at 100 MB and allows only Drive / Photos / YouTube links', () => {
    expect(VIDEO_MAX_MB).toBe(100);
    expect([...VIDEO_LINK_HOSTS].sort()).toEqual([
      'drive.google.com', 'm.youtube.com', 'photos.app.goo.gl', 'photos.google.com', 'www.youtube.com', 'youtu.be', 'youtube.com',
    ]);
  });
});
