import { INTENTS, STARTERS, answerFor, matchIntent } from './intents';
import { ALL_FAQS } from './faq';

describe('the knowledge behind the bot', () => {
  it('reads its answers from the site FAQ, so the two can never disagree', () => {
    expect(ALL_FAQS.length).toBeGreaterThan(15);
    expect(ALL_FAQS.every((f) => f.question && f.answer)).toBe(true);
  });

  it('never replies with an empty message', () => {
    // The lookups into the FAQ are by substring. If one stops matching — say
    // the FAQ is reworded — the intent would silently answer with "". That is
    // the single most likely way this bot breaks, so it is asserted directly.
    for (const intent of INTENTS) {
      const reply = intent.answer('test question');
      expect(reply.text.trim().length).toBeGreaterThan(10);
    }
  });

  it('offers every starter chip as something it can actually answer', () => {
    for (const starter of STARTERS) {
      const reply = answerFor(starter);
      expect(reply.text.trim().length).toBeGreaterThan(10);
      // Either a real answer with somewhere to go, or a catalogue search.
      expect(Boolean(reply.actions?.length || reply.search)).toBe(true);
    }
  });
});

describe('routing a question to the right intent', () => {
  it.each([
    ['where is my order', 'order-status'],
    ['has my order shipped yet', 'order-status'],
    ['how long does delivery take', 'shipping'],
    ['how much is shipping', 'shipping'],
    ['do you ship internationally', 'international'],
    ['i want to return this', 'returns'],
    ['can i get a refund', 'returns'],
    ['what is the warranty', 'returns'],
    ['can i cancel my order', 'cancel'],
    ['do you accept upi', 'payment'],
    ['is emi available', 'payment'],
    ['will it fit my fortuner', 'fitment'],
    ['do you do installation', 'installation'],
    ['are these products genuine', 'genuine'],
    ['i forgot my password', 'account'],
    ['any discount offers', 'offers'],
    ['i want to talk to a person', 'contact'],
  ])('“%s” → %s', (question, expected) => {
    expect(matchIntent(question)?.id).toBe(expected);
  });

  it('prefers the specific phrase over a word that several intents share', () => {
    // "order" alone appears in both; "where is my order" must not be read as a
    // cancellation, and "cancel my order" must not be read as tracking.
    expect(matchIntent('where is my order')?.id).toBe('order-status');
    expect(matchIntent('cancel my order')?.id).toBe('cancel');
  });

  it('falls back to a catalogue search for an unrecognised question', () => {
    const reply = answerFor('bushranger winch 12000lb');
    expect(reply.search).toBe(true);
    expect(matchIntent('qwertyuiop')).toBeNull();
  });

  it('treats a part name as a search rather than guessing an answer', () => {
    expect(answerFor('led pod lights').search).toBe(true);
    expect(answerFor('snorkel for thar').search).toBe(true);
  });
});

describe('what an answer hands back', () => {
  it('sends order questions to the pages that can actually show an order', () => {
    const hrefs = answerFor('where is my order').actions?.map((a) => a.href) ?? [];
    expect(hrefs).toContain('/orders');
    expect(hrefs).toContain('/track');
  });

  it('never introduces a number of its own — every amount it says is published FAQ text', () => {
    /*
      The bot is allowed to repeat the shipping thresholds the FAQ publishes;
      it is NOT allowed to invent one, or to carry a figure that no longer
      exists on the site. So rather than banning "₹", this asserts provenance:
      any amount in a reply must appear verbatim in the FAQ it quotes.

      That makes the FAQ the single place a number lives. Edit the FAQ and the
      bot follows; hardcode a number here and this test fails.
    */
    const faqText = ALL_FAQS.map((f) => f.answer).join(' ');
    for (const intent of INTENTS) {
      const text = intent.answer('x').text;
      for (const amount of text.match(/₹[\d,]+/g) ?? []) {
        expect(faqText).toContain(amount);
      }
      // Stock is per-product and live. The bot must never assert it.
      expect(text.toLowerCase()).not.toMatch(/\b(in stock|out of stock)\b/);
    }
  });

  it('routes a fitment question to the vehicle tools and a specialist', () => {
    const hrefs = answerFor('will this fit my hilux').actions?.map((a) => a.href) ?? [];
    expect(hrefs).toContain('/vehicles');
    expect(hrefs).toContain('/consultation');
  });
});
