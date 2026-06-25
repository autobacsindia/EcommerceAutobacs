import request from 'supertest';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Article from '../models/Article.js';
import ArticleComment from '../models/ArticleComment.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

/** Extract the XSRF-TOKEN value from a set-cookie header array. */
function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrfCookie = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  if (!xsrfCookie) return '';
  return xsrfCookie.split(';')[0].split('=')[1];
}

describe('GET /media/admin/comments — type filter', () => {
  let agent;

  const testAdmin = {
    name: 'Media Admin',
    email: 'mediaadmin@example.com',
    password: 'password123',
    role: 'admin',
  };

  beforeAll(async () => {
    await dbHandler.connect();
  });

  afterEach(async () => {
    await dbHandler.clearDatabase();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  beforeEach(async () => {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(testAdmin.password, salt);
    await User.create({ name: testAdmin.name, email: testAdmin.email, passwordHash, role: testAdmin.role });

    agent = request.agent(app);
    await agent.get('/ping');
    await agent.post(`${BASE}/auth/login`).send({ email: testAdmin.email, password: testAdmin.password });

    // One blog post + one news article, each with a comment.
    const blog = await Article.create({
      title: 'Blog Post', slug: 'blog-post', type: 'blog', content: '<p>blog</p>', status: 'published',
    });
    const news = await Article.create({
      title: 'News Item', slug: 'news-item', type: 'news', content: '<p>news</p>', status: 'published',
    });
    await ArticleComment.create({ article: blog._id, name: 'B', email: 'b@x.com', comment: 'on blog' });
    await ArticleComment.create({ article: news._id, name: 'N', email: 'n@x.com', comment: 'on news' });
  });

  it('returns only blog comments when type=blog', async () => {
    const res = await agent.get(`${BASE}/media/admin/comments?type=blog`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].comment).toBe('on blog');
    expect(res.body.data[0].article.type).toBe('blog');
  });

  it('returns only news comments when type=news', async () => {
    const res = await agent.get(`${BASE}/media/admin/comments?type=news`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].comment).toBe('on news');
    expect(res.body.data[0].article.type).toBe('news');
  });

  it('returns all comments when no type is given', async () => {
    const res = await agent.get(`${BASE}/media/admin/comments`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });
});
