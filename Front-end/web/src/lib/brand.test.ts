import { ORGANISATION } from './jsonLd';
import { SOCIAL_LINKS, BRAND_NAME } from './constants';
import { brand, footer } from '@/components/home/redesign/homeContent';

describe('Autobacs brand wiring', () => {
  it('uses the official social profiles', () => {
    expect(SOCIAL_LINKS).toEqual({
      instagram: 'https://www.instagram.com/autobacsindia/',
      youtube: 'https://www.youtube.com/channel/UCsaXH8a2Ci1P85hOZWGDQcw',
      facebook: 'https://www.facebook.com/autobacsindia/',
      linkedin: 'https://www.linkedin.com/company/autobacs-india/',
    });
  });

  it('tells Google exactly the profiles the footer links to', () => {
    const footerLinks = footer.social.map((s) => s.href).sort();
    expect([...ORGANISATION.sameAs].sort()).toEqual(footerLinks);
    expect(footerLinks).toEqual(Object.values(SOCIAL_LINKS).sort());
  });

  it('shows the Autobacs logo and name, not Roavion', () => {
    expect(brand.logo).toBe('/images/autobacs-logo-white.png');
    expect(brand.logoOnLight).toBe('/images/autobacs-logo.png');
    expect(ORGANISATION.logo).toMatch(/\/images\/autobacs-logo\.png$/);
    expect(footer.copyright).toContain(BRAND_NAME);
    const { ownership, ...rest } = footer;
    expect(JSON.stringify({ brand, footer: rest, sameAs: ORGANISATION.sameAs })).not.toMatch(/roavion/i);
  });

  it('names the company behind the brand in the footer', () => {
    expect(footer.ownership).toBe('Autobacs India is a brand of Roavion Automotive Private Limited.');
  });
});
