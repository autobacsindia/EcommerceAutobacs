import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import AuditLog, { normalizeAuditEntry } from '../models/AuditLog.js';
import auditLogRepository from '../repositories/auditLogRepository.js';
import auditLogger from '../services/auditLogger.js';
import { logAudit } from '../middleware/auditMiddleware.js';
import * as dbHandler from './db-handler.js';

/**
 * Regression tests for the audit trail.
 *
 * Audit logging was silently dead for 153 days: the schema required
 * `adminId`/`adminEmail` and a closed `action` enum, while every writer sent
 * `user` and CRUD actions. Every write failed validation and every call site
 * swallowed the error, so the collection sat frozen at 45 rows from one day in
 * March while admins deleted products daily.
 *
 * The tests that matter here are the ones asserting a row is ACTUALLY WRITTEN
 * through each real call path — a unit test of the schema alone would have
 * passed throughout the outage.
 */
describe('AuditLog', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterEach(async () => { await dbHandler.clearDatabase(); });
  afterAll(async () => { await dbHandler.closeDatabase(); });

  const reqFor = (user = null) => ({
    user,
    ip: '203.0.113.7',
    headers: { 'user-agent': 'jest' },
    connection: { remoteAddress: '203.0.113.7' },
    get: (h) => (h === 'user-agent' ? 'jest' : undefined),
    params: {},
  });

  describe('normalizeAuditEntry', () => {
    it('maps the redisMonitor shape (adminId/adminEmail/success)', () => {
      const id = new mongoose.Types.ObjectId();
      const out = normalizeAuditEntry({
        adminId: id, adminEmail: 'a@b.com', action: 'SESSION_REVOKE_ALL',
        success: false, errorMessage: 'denied',
      });
      expect(out.user).toBe(id);
      expect(out.userEmail).toBe('a@b.com');
      expect(out.status).toBe('FAILURE');
      expect(out.errorMessage).toBe('denied');
    });

    it('maps the auditMiddleware shape (resourceType/metadata)', () => {
      const out = normalizeAuditEntry({
        action: 'UPDATE', resourceType: 'Order', metadata: { a: 1 }, status: 'success',
      });
      expect(out.resource).toBe('Order');
      expect(out.details).toEqual({ a: 1 });
      expect(out.status).toBe('SUCCESS');
    });

    it('preserves targetUserId as the resourceId (whose sessions were revoked)', () => {
      const target = new mongoose.Types.ObjectId();
      const out = normalizeAuditEntry({
        action: 'SESSION_REVOKE_ALL', targetUserId: target, targetResourceType: 'User',
      });
      expect(out.resource).toBe('User');
      expect(out.resourceId).toBe(target.toString());
    });

    it('stringifies a non-string resourceId rather than risking a cast error', () => {
      expect(normalizeAuditEntry({ action: 'X', resourceId: 12345 }).resourceId).toBe('12345');
    });
  });

  describe('writes actually land (the 153-day bug)', () => {
    it('records a CRUD action via auditLogger — the path that was dead', async () => {
      const userId = new mongoose.Types.ObjectId();
      await auditLogger.logAction(
        reqFor({ _id: userId, email: 'admin@example.com' }),
        'DELETE', 'Product', 'abc123', { name: 'Widget' }
      );

      const rows = await AuditLog.find({});
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('DELETE');
      expect(rows[0].resource).toBe('Product');
      expect(rows[0].resourceId).toBe('abc123');
      expect(rows[0].user.toString()).toBe(userId.toString());
      expect(rows[0].status).toBe('SUCCESS');
    });

    it('records via the auditMiddleware logAudit path', async () => {
      await logAudit({
        user: new mongoose.Types.ObjectId(), action: 'UPDATE',
        resourceType: 'Order', resourceId: 'ord_1',
      }, reqFor());
      const rows = await AuditLog.find({});
      expect(rows).toHaveLength(1);
      expect(rows[0].resource).toBe('Order');
    });

    it('records via the redisMonitor logAction path', async () => {
      await auditLogRepository.logAction({
        adminId: new mongoose.Types.ObjectId(), adminEmail: 'ops@example.com',
        action: 'SESSION_REVOKE_ALL', ipAddress: '198.51.100.1', success: true,
      });
      const rows = await AuditLog.find({});
      expect(rows).toHaveLength(1);
      expect(rows[0].userEmail).toBe('ops@example.com');
    });

    // The enum was half the reason writes failed. A new action type must never
    // silently stop being recorded.
    it.each(['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'SOME_BRAND_NEW_ACTION'])(
      'accepts action "%s" without an enum rejecting it', async (action) => {
        await auditLogRepository.create({ action, resource: 'Thing' });
        expect(await AuditLog.countDocuments({ action })).toBe(1);
      }
    );

    it('records an anonymous/failed action (no user) — previously discarded', async () => {
      await auditLogger.logAction(reqFor(null), 'LOGIN', 'User', null, {}, 'FAILURE');
      const rows = await AuditLog.find({});
      expect(rows).toHaveLength(1);
      expect(rows[0].user).toBeNull();
      expect(rows[0].status).toBe('FAILURE');
    });
  });

  describe('failure handling', () => {
    it('never throws, and logs loudly when a write fails', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      // `action` is the one required field; omitting it forces a validation error.
      const result = await auditLogRepository.create({ resource: 'Product' });

      expect(result).toBeNull();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('AUDIT WRITE FAILED'));
      spy.mockRestore();
    });

    it('a failed audit write does not reject the caller', async () => {
      await expect(auditLogRepository.create({})).resolves.toBeNull();
    });
  });

  describe('schema shape', () => {
    it('has no vestigial timestamp/adminId fields', () => {
      const paths = Object.keys(AuditLog.schema.paths);
      expect(paths).not.toContain('timestamp');
      expect(paths).not.toContain('adminId');
      expect(paths).toContain('createdAt');
      expect(paths).toContain('user');
    });

    it('indexes only on createdAt — the field documents actually carry', () => {
      for (const [key] of AuditLog.schema.indexes()) {
        expect(Object.keys(key)).not.toContain('timestamp');
      }
    });

    it('retains audit rows for 2 years', () => {
      const ttl = AuditLog.schema.indexes().find(([, o]) => o?.expireAfterSeconds != null);
      expect(ttl).toBeDefined();
      expect(ttl[0]).toEqual({ createdAt: 1 });
      expect(ttl[1].expireAfterSeconds).toBe(730 * 24 * 60 * 60);
    });
  });
});
