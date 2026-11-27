import ClientError from '../models/ClientError.js';

/**
 * ClientError data access (services/clientErrorService.js). Passthrough so query
 * chaining is preserved while the model import stays in the repository layer.
 */
class ClientErrorRepository {
  find(...args) { return ClientError.find(...args); }
  findOne(...args) { return ClientError.findOne(...args); }
  findOneAndUpdate(...args) { return ClientError.findOneAndUpdate(...args); }
  updateOne(...args) { return ClientError.updateOne(...args); }
  estimatedDocumentCount() { return ClientError.estimatedDocumentCount(); }
}

export default new ClientErrorRepository();
