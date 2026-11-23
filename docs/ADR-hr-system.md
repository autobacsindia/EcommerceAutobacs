# ADR: HR system + Autobacs Team app (replaces Jibble)

Status: accepted by the owner 2026-11-22 ("Yes, build it": name **Autobacs Team**, logo A).
Owner-facing plan: https://claude.ai/artifact/PGqMNBWTiNR4RSp1UScsMK

This file is the **contract** for the build sessions. If a session needs to change
something here, it says so in its PR and the lead updates this file.

## 1. Decisions

| Decision | Rule |
|---|---|
| HR is a staff **team**, not a role | `STAFF_TEAMS.HR = 'hr'`. `User.role` stays customer/staff/admin, so every `role === 'admin'` check keeps its meaning. Admin adds HR from *Admin → Staff* like any team. |
| Employee = staff login + HR profile | Login stays on `User`. HR data is `EmployeeProfile` (`user` optional so onboarding can start before the login exists). App login = the existing staff login (email or company username), `Authorization: Bearer` for the app. |
| Access is server-side, per route | `middleware/hrAuth.js`: `hrOrAdmin`, `adminOnly`, `requireEmployeeAccess(scope)`, `loadSelfEmployee`. Scopes: profile, attendance, leave, salary, documents, face. Self + HR + admin see all scopes; an active **team head** sees only `attendance` and `leave` of their own team. Not allowed = **404**, identical to "doesn't exist". |
| Auth | `routes/hr/index.js` mounts `protect` (token + `sessionVersion` → 401) and `hrRateLimit` (per user, `cf-connecting-ip` fallback). Punch/face routes add `hrPunchRateLimit`. |
| Money | Integer **paise** everywhere (`…Paise`). Server computes every figure. Payslips are snapshots (like orders). |
| Dates | IST `'YYYY-MM-DD'` days, `'YYYY-MM'` months, `Date` for instants. Leave counted in **half-days** (integers). |
| Payouts | One `PaymentRequest` (kind `expense`, category `salary`, team `hr`) per employee per approved month, through the existing approve → pay flow. Description carries the month and payslip number only, never the breakdown. |
| Roav Points / incentives | Read from the **approved** `IncentiveMonth` when `HrSettings.includeIncentives` is on. No second points system. |
| Face matching | Active liveness on the phone (random blink/turn), one frame to **our server**, self-hosted embedding model compares with the enrolled template, frame discarded. No outside face API without the owner's explicit OK. Template = embedding, encrypted (`utils/fieldEncryption.js`), `select: false`. Photo kept **only** when the employee asks HR to review a failed match (`FaceReviewPhoto`, private bucket, deleted after 30 days by cron — object first, then row; not a TTL). Consent versioned; erased on exit. |
| Geofence | Server haversine against the employee's allowed `HrWorkSite`s. Android `mocked` flag → reject + flag. Accuracy worse than `HrSettings.gpsMaxAccuracyM` → reject with "step outside / near a window". Impossible jump (speed) → `pending_review`. |
| Idempotency | Punch: unique `{employee, clientPunchId}`. Leave request / correction: unique `{employee, clientRequestId}`. Ledger/adjustment system rows: unique `key`. A duplicate-key error returns the existing row (200), never a second record. |
| Audit | Every HR write calls `services/hr/audit.js` `recordHrAudit` (masked values; joins the transaction via `session`). `HrAuditLog` has no TTL (wage records are kept for years). |
| Indexes | Every HR model lives in `models/hr/`, every index is **named** `hr_*`. `npm run create-hr-indexes -- --apply` builds all of them from the schemas (loads the whole folder — adding a model needs no script edit). Then `npm run audit-index-drift` (now also loads `models/hr/`). |
| Data access | Services import `repositories/hr/<x>Repository.js`, never models (lint rule). |

## 2. Collections (all in `models/hr/`)

| Model | Owner session | Notes |
|---|---|---|
| EmployeeProfile, EmployeeDocument, HrAuditLog, HrSettings | foundation (lead); documents API → **leave** session | profile CAS on `rev` |
| HrWorkSite, HrShift, AttendancePunch, AttendanceDay, AttendanceCorrection, FaceProfile, FaceReviewPhoto, EmployeeDevice | **attendance** | `AttendanceDay` is a recomputable read model |
| LeaveType, LeaveLedgerEntry, LeaveRequest, HrHoliday | **leave** | ledger append-only; balance = sum |
| SalaryStructure, PayrollRun, Payslip, PayrollAdjustment, ExitCase | **payroll** | run draft → locked → approved (admin) |

A session may add fields/indexes to the models it owns; it must not edit another session's models (ask the lead).

## 3. File ownership (no two sessions edit the same file)

| Session | Owns |
|---|---|
| foundation (lead) | `config/hr.js`, `middleware/hrAuth.js`, `middleware/rate-limit/hrLimiters.js`, `routes/hr/index.js`, `routes/hr/employees.js`, `routes/hr/settings.js`, `services/hr/{audit,settings,employeeService}.js`, `repositories/hr/{employee,hrAudit,hrSettings}Repository.js`, `scripts/create-hr-indexes.js`, this ADR |
| attendance | `routes/hr/attendance.js`, `services/hr/attendance/**`, `services/hr/face/**`, `repositories/hr/attendance*.js`, `repositories/hr/face*.js`, cron jobs for auto-close + photo cleanup (new files; one registration line in `services/cronService.js`), tests `tests/hrAttendance*.test.js`, `tests/hrFace*.test.js` |
| leave | `routes/hr/leave.js`, `services/hr/leave/**`, `services/hr/documents/**`, `repositories/hr/leave*.js`, `repositories/hr/holiday*.js`, `repositories/hr/document*.js`, tests `tests/hrLeave*.test.js`, `tests/hrDocuments*.test.js` |
| payroll | `routes/hr/payroll.js`, `services/hr/payroll/**`, `services/hr/exit/**`, `repositories/hr/payroll*.js`, `repositories/hr/salary*.js`, `repositories/hr/exit*.js`, tests `tests/hrPayroll*.test.js`, `tests/hrExit*.test.js` |
| app | `Mobile/autobacs-team/**` only |
| web panel | `Front-end/web/src/app/hr/**`, `Front-end/web/src/components/hr/**`, `Front-end/web/src/lib/hr/**`, one nav entry in `app/team/TeamLayoutClient.tsx` |

Cross-session reads go through the owner's **exported service functions** listed below, not its repositories.

## 4. API contract (`/api/v1/hr`)

Shapes are JSON; every list is `{ items, nextCursor }` (keyset, `limit` ≤ 50). Errors `{ success:false, message }` with a person-readable message.

**Foundation (built)**
- `GET /me` → `{ employee }` (self). 404 "profile not set up".
- `GET /employees?status=current|all|onboarding|active|notice|exited&team&q&cursor&limit` (HR/admin)
- `POST /employees` (HR/admin) `{ name, user?, designation?, joinDate?, phone?, pan?, aadhaar?, bank?{holderName,accountNumber,ifsc,upi}, … }` → 201 `{ employee }`
- `GET /employees/:employeeId` (scope profile) · `PATCH /employees/:employeeId` (HR/admin, `{ rev, reason?, …fields }`, 409 on stale rev)
- `PUT /employees/:employeeId/onboarding/:key` `{ done }` (HR/admin)
- `GET /settings` · `PATCH /settings` `{ rev, reason?, …}` (HR/admin)

**Attendance (to build)**
- Sites/shifts (HR/admin CRUD): `GET|POST /sites`, `PATCH /sites/:id`, `GET|POST /shifts`, `PATCH /shifts/:id`
- Face: `POST /me/face/consent` `{ version }`, `POST /me/face/enrol` (multipart frames + liveness evidence), `DELETE /me/face` (withdraw), `POST /employees/:id/face/allow-reenrol` (HR), `GET /employees/:id/face` (status only)
- Punch: `POST /me/punches` `{ clientPunchId, type, at, lat, lng, accuracyM, mocked, deviceId, offline }` + frame → `{ punch, day }`; 200 with the existing punch on replay; 422 with a reason code (`outside_fence`, `low_accuracy`, `mocked_location`, `face_no_match`, `liveness_failed`, `not_enrolled`, `sequence`) when refused; `POST /me/punches/:clientPunchId/review` asks HR to approve a failed one (stores the photo).
- `GET /me/attendance?month=` · `GET /employees/:id/attendance?month=` (scope attendance) · `GET /attendance/today` (HR/admin; head = own team)
- Corrections: `POST /me/corrections`, `GET /corrections?status=` (HR), `POST /corrections/:id/decide` `{ decision, note, rev }`
- Review inbox: `GET /punches/review`, `POST /punches/:id/decide`
- Overtime approval: `POST /employees/:id/attendance/:date/overtime` `{ approvedMinutes }`
- Exported for payroll: `services/hr/attendance/index.js` → `monthSummary(employeeId, month)` → `{ daysInMonth, presentDays, halfDays, absentDays, leaveDays, holidayDays, weeklyOffDays, lateMarks, overtimeApprovedMinutes, unresolvedDays }`; `markMonthLocked(month, session)`; `changedAfterLock(month)`.
- Exported for exit: `services/hr/face/index.js` → `eraseFaceData(employeeId, reason, session)`; `services/hr/attendance/devices.js` → `revokeDevices(employeeId, session)`.

**Leave (to build)**
- Types (HR CRUD): `GET|POST /leave-types`, `PATCH /leave-types/:id`
- Holidays: `GET /holidays?year=`, `POST /holidays`, `DELETE /holidays/:id` (HR)
- `GET /me/leave/balances?year=` · `GET /employees/:id/leave/balances` (scope leave)
- `POST /me/leave` `{ clientRequestId, leaveType, from, to, firstHalfOnly?, secondHalfOnly?, reason }` → server computes `halfDays`; `POST /me/leave/:id/cancel`
- `GET /leave/inbox` (head: own team step; HR: HR step) · `POST /leave/:id/decide` `{ decision, note, rev }`
- `POST /employees/:id/leave/adjust` `{ leaveType, year, deltaHalfDays, reason }` (HR)
- Documents: `GET /employees/:id/documents` (scope documents), `POST /employees/:id/documents` (multipart, HR/admin or self for own uploads), `GET /documents/:docId/url` (presigned, 5 min), `DELETE /documents/:docId` (HR/admin, soft)
- Exported: `services/hr/leave/index.js` → `leaveDaysInRange(employeeId, from, to)` (approved leave per date, paid/unpaid), `isHoliday(date, siteIds)`, `yearlyGrant(year)` (idempotent).

**Payroll (to build)**
- Salary: `GET /employees/:id/salary` (scope salary) · `POST /employees/:id/salary` (HR/admin; new effective-dated row + reason)
- Runs: `POST /payroll/:month/prepare` (HR) · `POST /payroll/:month/recompute` · `POST /payroll/:month/lock` (HR) · `POST /payroll/:month/unlock` (HR, reason, only when locked) · `POST /payroll/:month/approve` (**admin**, rev + fingerprint check) · `POST /payroll/:month/reopen` (**admin**, reason) · `POST /payroll/:month/payouts` (creates PaymentRequests, idempotent per payslip) · `GET /payroll/:month` · `GET /payroll?cursor`
- Adjustments: `POST /payroll/:month/adjustments`, `POST /adjustments/:id/cancel`
- Payslips: `GET /me/payslips` · `GET /me/payslips/:month/pdf` (released only) · `GET /employees/:id/payslips` (scope salary)
- Exit: `POST /employees/:id/exit` (resignation), `POST /exits/:id/accept` `{ lastDay, noticeDays }`, `POST /exits/:id/settle` (final settlement payslip), `POST /exits/:id/withdraw`; on settle/last day: `eraseFaceData`, `revokeDevices`, existing staff-access removal, `EmployeeProfile.status = 'exited'`.
- Reports (CSV): payroll register, PF (ECR-style), ESI, PT, attendance month, leave balances, headcount.

## 5. Rules every session follows

1. Tests for every edge, failure and retry case, including: employee A cannot read employee B's attendance / leave / salary / face / documents (404), auth failure never 200, replay → one record.
2. Multi-document writes in a transaction (`mongoose.startSession` + `withTransaction`), audit row inside it.
3. Lists: keyset cursor + `.lean()` + projection. No `skip`.
4. No per-request telemetry in MongoDB. A refused punch is answered, not stored.
5. No TTL on subdocument arrays; any TTL needs a `partialFilterExpression` (prefer cron).
6. Scripts that import models: `mongoose.connect(uri, { autoIndex: false })`.
7. Never real employee data or faces in tests/fixtures; never run scripts against prod; never call an outside face API.
8. Heavy jobs (full jest `--maxWorkers=2`, `git push`, `npm ci`, `next build`, EAS) under the shared lock; at most 2 sessions doing heavy work at once.
9. Feature first, optimization pass separate (measured), then PR. Every HR PR waits for the owner's **"merge it"** — no auto-merge.

## 6. Open owner inputs (defaults until answered)

Sites + radius; who uses the app (staff logins only by default); leave policy (default CL 8 / SL 6 / EL 12, EL carry ≤ 30); shift 10:00–19:00, 10 min grace, 3 lates = ½ day; OT 1.5× HR-approved; PF/ESI registered? PT state; payday 7th; leave = head → HR; payroll approve = admin only; incentives on payslip (off); Apple developer account; Jibble admin export.
