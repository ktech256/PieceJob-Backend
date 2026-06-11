import { Router } from 'express';
import * as sosController from '../controllers/sos.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.post('/trigger', sosController.triggerSos);
router.post('/:id/audio', sosController.uploadAudio);
router.post('/:id/photo', sosController.uploadPhoto);
router.get('/status/:id', sosController.getIncidentDetail);

export default router;
