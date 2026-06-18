import BaseRepository from './baseRepository.js';
import Consultation from '../models/Consultation.js';

/**
 * Consultation data access. The generic BaseRepository methods
 * (create / find / count / findById / update / delete) cover every current
 * call site, so no model-specific methods are needed yet.
 */
class ConsultationRepository extends BaseRepository {
  constructor() {
    super(Consultation);
  }
}

export default new ConsultationRepository();
