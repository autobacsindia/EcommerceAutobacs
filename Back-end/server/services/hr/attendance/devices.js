/**
 * The phone(s) an employee punches from (models/hr/EmployeeDevice.js).
 *
 *   - The first punch binds the phone.
 *   - A change to a new phone is allowed once; HR sees it in the audit log.
 *   - A SECOND change while the current phone was itself a change made less than
 *     `deviceChangeCooldownDays` ago is refused (`device_blocked`); the phone is
 *     parked as "waiting for HR" and HR approves it from the panel.
 *   - Exit revokes every phone (`revokeDevices`, called by the exit flow).
 *
 * `deviceId` is the app's install id, not a hardware id.
 */
import attendanceDeviceRepository from '../../../repositories/hr/attendanceDeviceRepository.js';
import { recordHrAudit } from '../audit.js';
import { refuse, fail } from './errors.js';
import { withTx } from './tx.js';
import { DAY_MS } from './time.js';

const PLATFORMS = ['ios', 'android'];

export function cleanDevice({ deviceId, platform, deviceModel } = {}) {
  const id = String(deviceId ?? '').trim();
  if (!id || id.length > 100) throw fail('deviceId is required', 400);
  if (!PLATFORMS.includes(platform)) throw fail('platform must be ios or android', 400);
  return { deviceId: id, platform, model: String(deviceModel ?? '').slice(0, 100) };
}

/**
 * Decide whether this phone may punch. Returns { kind, commit(session) } where
 * kind is 'known' | 'first' | 'changed'; `commit` writes the binding inside the
 * punch's transaction. Throws `device_blocked` (after parking the phone for HR).
 */
export async function checkDevice(employee, device, settings, now = new Date()) {
  const devices = await attendanceDeviceRepository.listForEmployee(employee._id);
  const known = devices.find((d) => d.deviceId === device.deviceId);
  if (known?.active) return { kind: 'known', commit: async () => {} };

  const active = devices.filter((d) => d.active);
  const bind = (kind) => ({
    kind,
    commit: async (session, actor = null) => {
      await attendanceDeviceRepository.upsertActive(employee._id, device.deviceId, {
        platform: device.platform, model: device.model, boundAt: now,
      }, session);
      if (active.length) await attendanceDeviceRepository.deactivateOthers(employee._id, device.deviceId, now, session);
      if (kind === 'changed') {
        await recordHrAudit({
          action: 'device.changed', entity: 'EmployeeDevice', subject: employee._id, actor, session,
          changes: [{ field: 'deviceId', from: active[0]?.deviceId || null, to: device.deviceId }],
        });
      }
    },
  });
  if (!active.length) return bind('first');

  const current = active[0];
  const currentWasAChange = devices.some((d) => d.boundAt < current.boundAt);
  const cooldownMs = (settings.deviceChangeCooldownDays || 0) * DAY_MS;
  if (currentWasAChange && !current.approvedBy && now - new Date(current.boundAt) < cooldownMs) {
    await attendanceDeviceRepository.markPending(employee._id, device.deviceId, {
      platform: device.platform, model: device.model, boundAt: now,
    });
    throw refuse('device_blocked', 'You changed phones recently. HR needs to approve this phone before you can punch from it.');
  }
  return bind('changed');
}

export const shapeDevice = (d) => ({
  deviceId: d.deviceId,
  platform: d.platform,
  model: d.model || '',
  active: !!d.active,
  pendingApproval: !!d.pendingApproval,
  boundAt: d.boundAt,
  approvedBy: d.approvedBy ? String(d.approvedBy) : null,
  revokedAt: d.revokedAt || null,
});

export async function listDevices(employeeId) {
  return (await attendanceDeviceRepository.listForEmployee(employeeId)).map(shapeDevice);
}

/** HR: approve a parked phone. It becomes the only active phone. */
export async function approveDevice(actor, employee, deviceId, req = null) {
  const d = await attendanceDeviceRepository.find(employee._id, String(deviceId));
  if (!d || !d.pendingApproval) throw fail('No phone is waiting for approval with that id', 404);
  const now = new Date();
  return withTx(async (session) => {
    const row = await attendanceDeviceRepository.upsertActive(employee._id, d.deviceId, {
      platform: d.platform, model: d.model, boundAt: now, approvedBy: actor._id,
    }, session);
    await attendanceDeviceRepository.deactivateOthers(employee._id, d.deviceId, now, session);
    await recordHrAudit({
      action: 'device.approved', entity: 'EmployeeDevice', entityId: row._id, subject: employee._id, actor, req, session,
      changes: [{ field: 'deviceId', from: null, to: d.deviceId }],
    });
    return shapeDevice(row);
  });
}

/**
 * Exit / lost phone: no phone of this employee can punch any more. Joins the
 * caller's transaction. Idempotent. (Exported for the exit flow.)
 */
export async function revokeDevices(employeeId, session = null, { actor = null, reason = 'exit' } = {}) {
  const res = await attendanceDeviceRepository.revokeAll(employeeId, new Date(), session);
  const n = res.modifiedCount ?? res.nModified ?? 0;
  if (n) {
    await recordHrAudit({
      action: 'device.revoked', entity: 'EmployeeDevice', subject: employeeId, actor, reason, session,
      changes: [{ field: 'devices', from: n, to: 0 }],
    });
  }
  return { revoked: n };
}
