import { readableSheetLabel, readableSheetValue } from './metaLeadTypes';

describe('readable Meta sheet text', () => {
  it('turns a long column name into words the browser can wrap', () => {
    expect(readableSheetLabel('which_suspension_brand_are_you_interested_in?')).toBe('Which suspension brand are you interested in?');
    expect(readableSheetLabel('are_you_a_vehicle_owner_or_automotive_dealer_?')).toBe('Are you a vehicle owner or automotive dealer?');
  });
  it('leaves ordinary and empty labels alone', () => {
    expect(readableSheetLabel('Sales person')).toBe('Sales person');
    expect(readableSheetLabel('')).toBe('');
  });
  it('makes token answers readable', () => {
    expect(readableSheetValue('automotive_dealer_/_reseller')).toBe('Automotive dealer / reseller');
    expect(readableSheetValue('just_exploring_options')).toBe('Just exploring options');
  });
  it('never rewrites a link, an e-mail or normal text', () => {
    const url = 'https://business.facebook.com/latest/1?nav_ref=thread_view_by_psid';
    expect(readableSheetValue(url)).toBe(url);
    expect(readableSheetValue('first_last@example.com')).toBe('first_last@example.com');
    expect(readableSheetValue('What which?')).toBe('What which?');
    expect(readableSheetValue('f:2356984095136063')).toBe('f:2356984095136063');
  });
});
