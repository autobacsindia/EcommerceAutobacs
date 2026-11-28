/** Employee documents (models/hr/EmployeeDocument.js). The bytes live in the private bucket. */
import EmployeeDocument from '../../models/hr/EmployeeDocument.js';

const documentRepository = {
  /** Live (not soft-deleted) document. */
  findLive: (id) => EmployeeDocument.findOne({ _id: id, deletedAt: null }).lean(),
  create: async (doc, session = null) => {
    const [row] = await EmployeeDocument.create([doc], session ? { session } : {});
    return row.toObject();
  },
  page: (query, { sort, limit, select }) => EmployeeDocument.find(query).select(select).sort(sort).limit(limit).lean(),
  /** Soft delete once: matches only a live row, so a double delete changes nothing. */
  softDelete: (id, actorId, at, session = null) => EmployeeDocument.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: at, deletedBy: actorId } },
    { new: true, session },
  ).lean(),
};

export default documentRepository;
