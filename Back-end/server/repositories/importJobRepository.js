import ImportJob from '../models/ImportJob.js';

/**
 * ImportJob data access. Passthrough to the model so query chaining and
 * instance save() on a freshly built job doc work unchanged, while keeping the
 * model import isolated to the repository layer.
 */
class ImportJobRepository {
  create(...args) { return ImportJob.create(...args); }
  find(...args) { return ImportJob.find(...args); }
  findOne(...args) { return ImportJob.findOne(...args); }
  /** Build an unsaved job; caller mutates progress then save()s it. */
  build(data) { return new ImportJob(data); }
}

export default new ImportJobRepository();
