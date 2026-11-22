/**
 * HR access rules (docs/ADR-hr-system.md §Access). Run AFTER `protect`, which has
 * already verified the token and its sessionVersion (a stale token is a 401
 * there, never a 200 here).
 *
 *   HR      = an ACTIVE staff member of the 'hr' team.
 *   admin   = role 'admin'.
 *   self    = the employee whose profile is linked to the caller's user.
 *   head    = an active team head, for employees of their own team, and only for
 *             the 'attendance' and 'leave' scopes — never salary, face or documents.
 *
 * Every per-employee route goes through `requireEmployeeAccess(scope)`. A caller
 * who may not see an employee gets the SAME 404 as for an employee that doesn't
 * exist, so employee ids can't be probed.
 */
import mongoose from 'mongoose';
import employeeRepository from '../repositories/hr/employeeRepository.js';
import { STAFF_TEAMS } from '../config/staff.js';

export const HR_SCOPES = Object.freeze(['profile', 'attendance', 'leave', 'salary', 'documents', 'face']);
const HEAD_SCOPES = new Set(['attendance', 'leave']);

export const isAdminUser = (user) => user?.role === 'admin';
export const isActiveStaffUser = (user) => user?.role === 'staff' && user.staff?.active === true;
export const isHrUser = (user) => isActiveStaffUser(user) && user.staff.team === STAFF_TEAMS.HR;
export const isHrOrAdmin = (user) => isAdminUser(user) || isHrUser(user);

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * May `actor` see `employee` (a lean EmployeeProfile with user/team) for `scope`?
 * Pure, so it is unit-tested directly and reused by services for list filters.
 */
export function canAccessEmployee(actor, employee, scope) {
  if (!actor || !employee || !HR_SCOPES.includes(scope)) return false;
  if (isHrOrAdmin(actor)) return true;
  if (sameId(employee.user, actor._id)) return true;
  if (HEAD_SCOPES.has(scope) && isActiveStaffUser(actor) && actor.staff.isHead === true
    && employee.team && employee.team === actor.staff.team) {
    return true;
  }
  return false;
}

const notFound = (res) => res.status(404).json({ success: false, message: 'Employee not found' });

/** HR or admin only. */
export const hrOrAdmin = (req, res, next) => {
  if (!isHrOrAdmin(req.user)) {
    return res.status(403).json({ success: false, message: 'Only HR or an administrator can do this' });
  }
  return next();
};

/** Admin only (e.g. final payroll approval). */
export const adminOnly = (req, res, next) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Only an administrator can do this' });
  }
  return next();
};

/**
 * Loads `req.params[param]` as an EmployeeProfile (lean, without encrypted
 * fields) into `req.employee` if the caller may see it for `scope`.
 */
export function requireEmployeeAccess(scope, param = 'employeeId') {
  if (!HR_SCOPES.includes(scope)) throw new Error(`Unknown HR scope: ${scope}`);
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) return notFound(res);
      const employee = await employeeRepository.findById(id);
      if (!employee || !canAccessEmployee(req.user, employee, scope)) return notFound(res);
      req.employee = employee;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * The caller's OWN employee profile into `req.employee` (the app's "me" routes).
 * 404 when the caller has no profile yet (HR hasn't set them up).
 */
export const loadSelfEmployee = async (req, res, next) => {
  try {
    if (!req.user?._id) return res.status(401).json({ success: false, message: 'Not authorized' });
    const employee = await employeeRepository.findByUser(req.user._id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Your HR profile is not set up yet. Please ask HR.' });
    }
    req.employee = employee;
    return next();
  } catch (err) {
    return next(err);
  }
};
