import { Router } from 'express';
import * as sosController from '../controllers/sos.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/active', authenticate, sosController.getActiveAlerts);
router.post('/trigger', authenticate, sosController.triggerSos);
router.patch('/:alertId/resolve', authenticate, sosController.resolveSos);

export default router;
