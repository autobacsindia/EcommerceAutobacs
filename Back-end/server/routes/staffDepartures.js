import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { validateDepartureId, validateDepartureList, validateDepartureCreate, validateDepartureUpdate } from '../validators/staffDeparture.validator.js';
import { recordDeparture, listDepartures, myHandovers, getDeparture, updateDeparture, cancelDeparture } from '../services/staffDepartureService.js';

/** Resignations and handovers (/api/v1/staff/departures). Mounted after routes/staff.js's signed-in gate. */
const router = express.Router();
const v = (...chains) => [...chains.flat(), validateRequest];
// Holds private resignation details: never kept by a browser or proxy.
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', v(validateDepartureList), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listDepartures(req.user, req.query)) });
}));
router.post('/', v(validateDepartureCreate), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, departure: await recordDeparture(req.user, req.body, req) });
}));
router.get('/mine', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await myHandovers(req.user)) });
}));
router.get('/:id', v(validateDepartureId), asyncHandler(async (req, res) => {
  res.json({ success: true, departure: await getDeparture(req.user, req.params.id) });
}));
router.patch('/:id', v(validateDepartureUpdate), asyncHandler(async (req, res) => {
  res.json({ success: true, departure: await updateDeparture(req.user, req.params.id, req.body, req) });
}));
router.post('/:id/cancel', v(validateDepartureId), asyncHandler(async (req, res) => {
  res.json({ success: true, departure: await cancelDeparture(req.user, req.params.id, req) });
}));

export default router;
