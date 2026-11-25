/**
 * What a visitor may write in a public box (config/publicTextLimits.js).
 *
 * The rule for every box: a long piece of writing (well past the old 1,000 /
 * 2,000) is saved WORD FOR WORD; one over 5,000 characters is REFUSED with a
 * clear message and nothing is saved — never shortened. These routes are open
 * to anyone, so the cap itself must hold on the server.
 *
 * Covers the blog comment (used to be silently cut at 2,000) and the
 * consultation form (used to have no server cap at all).
 */
import request from 'supertest';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import Article from '../models/Article.js';
import ArticleComment from '../models/ArticleComment.js';
import Consultation from '../models/Consultation.js';
import * as dbHandler from './db-handler.js';
import { CUSTOMER_TEXT_MAX } from '../config/publicTextLimits.js';
import { ADMIN_COMMENT_MAX, CUSTOMER_COMMENT_MAX } from '../config/reviewLimits.js';

const BASE = '/api/v1';

async function visitor() {
  const agent = request.agent(app);
  const res = await agent.get('/ping');
  const xsrf = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  const csrf = xsrf ? xsrf.split(';')[0].split('=')[1] : '';
  return { post: (url, body) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body) };
}

/** Real-looking writing of exactly `n` characters, ending in a letter (nothing to trim). */
const writing = (n) => 'The seat covers fit our Creta perfectly and the stitching is neat. '.repeat(Math.ceil(n / 67)).slice(0, n - 1) + 'x';

describe('public text limits', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterEach(async () => { await dbHandler.clearDatabase(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  it('one cap of 5,000 for visitors; staff entering a review still get more', () => {
    expect(CUSTOMER_TEXT_MAX).toBe(5000);
    expect(CUSTOMER_COMMENT_MAX).toBe(CUSTOMER_TEXT_MAX);
    expect(ADMIN_COMMENT_MAX).toBeGreaterThan(CUSTOMER_COMMENT_MAX);
  });

  describe('blog comment', () => {
    beforeEach(async () => {
      await Article.create({ title: 'Fitting guide', slug: 'fitting-guide', type: 'blog', content: '<p>x</p>', status: 'published' });
    });
    const comment = (v, text) => v.post('/media/articles/fitting-guide/comments', { name: 'Asha', email: 'asha@example.com', comment: text });

    it('a long comment (past the old 2,000) is saved word for word — it used to be cut', async () => {
      const text = writing(4200);
      const res = await comment(await visitor(), text);
      expect(res.status).toBe(201);
      expect((await ArticleComment.findOne().lean()).comment).toBe(text);
    });

    it('exactly 5,000 is fine; one more is refused with a clear message and nothing is saved', async () => {
      expect((await comment(await visitor(), writing(CUSTOMER_TEXT_MAX))).status).toBe(201);
      await ArticleComment.deleteMany({});
      const res = await comment(await visitor(), writing(CUSTOMER_TEXT_MAX + 1));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/too long.*5,000/);
      expect(await ArticleComment.countDocuments()).toBe(0);
    });
  });

  describe('consultation form', () => {
    const FORM = { name: 'Rahul', whatsapp: '9876543210', email: 'rahul@example.com', city: 'Kochi', makeModel: 'Toyota Hilux' };

    it('long notes (past the old 2,000 box) are saved word for word', async () => {
      const notes = writing(3500);
      const res = await (await visitor()).post('/consultation', { ...FORM, notes });
      expect(res.status).toBe(201);
      expect((await Consultation.findOne().lean()).notes).toBe(notes);
    });

    it.each([
      ['notes over 5,000', { notes: writing(CUSTOMER_TEXT_MAX + 1) }, /notes is too long.*5,000/],
      ['a name over 100', { name: 'x'.repeat(101) }, /name is too long/],
      ['a city over 80', { city: 'x'.repeat(81) }, /city is too long/],
      ['notes that are not text', { notes: { $gt: '' } }, /notes must be text/],
    ])('%s is refused with a clear message, and nothing is saved', async (_label, over, message) => {
      const res = await (await visitor()).post('/consultation', { ...FORM, ...over });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
      expect(await Consultation.countDocuments()).toBe(0);
    });
  });
});
