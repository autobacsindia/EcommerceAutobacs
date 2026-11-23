/** HR audit log (models/hr/HrAuditLog.js): append-only. */
import HrAuditLog from '../../models/hr/HrAuditLog.js';

const hrAuditRepository = {
  /** Insert one row; joins the caller's transaction when `session` is given. */
  append: async (doc, session = null) => {
    const [row] = await HrAuditLog.create([doc], session ? { session } : {});
    return row;
  },
  listForSubject: (subjectId, { limit = 50 } = {}) => HrAuditLog.find({ subject: subjectId })
    .sort({ createdAt: -1, _id: -1 }).limit(Math.min(limit, 200)).lean(),
};

export default hrAuditRepository;
